"""Zero-touch enrollment (ADR-002 §7, D-014): the agent asks for an identity, an admin approves it on the Dashboard.

The private key is made here and never leaves the machine. The server is reached only over HTTPS checked against the
CA certificate shipped in the master image (D-014.3); nothing in a reply can change that trust anchor.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.x509.oid import NameOID

from .identity import Identity, write_enrollment

log = logging.getLogger("nfc_agent.enroll")

PENDING_FILE = "enroll-pending.json"
PENDING_KEY = "enroll-pending.key"
STOPPED_FILE = "enroll-stopped"  # written by the agent after a rejection; removed by `nfc-agent reenroll`
POLL_DEFAULT_SEC = 5.0
BACKOFF_BASE_SEC = 1.0  # ADR-002 §6
BACKOFF_MAX_SEC = 60.0
MQTT_IDENTITY = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
KM_HEX = re.compile(r"^[0-9a-f]{64}$")


class EnrollmentRejected(RuntimeError):
    """An admin rejected the request: stop asking; a technician runs `nfc-agent reenroll` to try again."""


class EnrollmentRefused(RuntimeError):
    """The server refuses the request itself (400, or an answer that does not fit our key): retrying will not help."""


class TransportError(RuntimeError):
    """Network failure, timeout or 5xx: try again later."""


@dataclass(frozen=True)
class MachineFacts:
    machine_id: str
    hostname: str
    mac_address: str


def first_mac(net_dir: Path = Path("/sys/class/net")) -> str:
    """MAC of the first physical interface by name: stable across reboots, unlike "the interface that is up"."""
    for name in sorted(p.name for p in net_dir.iterdir()):
        iface = net_dir / name
        if name == "lo" or not (iface / "device").exists():  # loopback, bridges, docker, veth
            continue
        addr = (iface / "address").read_text().strip().lower()
        if addr and addr != "00:00:00:00:00:00":
            return addr
    raise RuntimeError(f"no physical network interface with a MAC address in {net_dir}")


def read_machine_facts(
    machine_id_file: Path = Path("/etc/machine-id"), net_dir: Path = Path("/sys/class/net")
) -> MachineFacts:
    machine_id = machine_id_file.read_text().strip()
    if not machine_id:
        raise RuntimeError(f"{machine_id_file} is empty: the master image was not reset (ADR-002 §7)")
    return MachineFacts(machine_id, socket.gethostname(), first_mac(net_dir))


def new_key() -> ed25519.Ed25519PrivateKey:
    return ed25519.Ed25519PrivateKey.generate()


def key_pem(key: ed25519.Ed25519PrivateKey) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )


def load_key(pem: bytes) -> ed25519.Ed25519PrivateKey:
    key = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(key, ed25519.Ed25519PrivateKey):
        raise ValueError("enrollment key must be Ed25519")
    return key


def make_csr(key: ed25519.Ed25519PrivateKey, common_name: str = "ws-temp") -> str:
    """The server ignores the CN of the request and names the certificate itself (ADR-002 §7)."""
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    csr = x509.CertificateSigningRequestBuilder().subject_name(name).sign(key, None)
    return csr.public_bytes(serialization.Encoding.PEM).decode()


def _raw_public(key: ed25519.Ed25519PublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def backoff(attempt: int, rand: Callable[[], float] = random.random) -> float:
    """ADR-002 §6: min(60, 1 * 2^attempt) * [0.8, 1.2]."""
    return min(BACKOFF_MAX_SEC, BACKOFF_BASE_SEC * 2**attempt) * (0.8 + 0.4 * rand())


class Transport(Protocol):
    def request(self, method: str, path: str, body: dict | None = None, bearer: str | None = None) -> tuple[int, dict]:
        """(HTTP status, JSON body) for 2xx and 4xx; raises TransportError for network errors and 5xx."""
        ...


class HttpsTransport:
    """HTTPS to the server's /api/v1, trusting only `ca_file` and checking the host name (D-014.3)."""

    def __init__(self, base_url: str, ca_file: Path, timeout: float = 15.0):
        if not base_url.startswith("https://"):
            raise ValueError("server url must start with https:// (D-014.3)")
        self._base = base_url.rstrip("/") + "/api/v1"
        self._context = ssl.create_default_context(cafile=str(ca_file))  # with cafile, the system CAs are not loaded
        self._timeout = timeout

    def request(self, method: str, path: str, body: dict | None = None, bearer: str | None = None) -> tuple[int, dict]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self._base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self._timeout, context=self._context) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            if err.code >= 500:
                raise TransportError(f"server error {err.code}") from err
            try:
                payload = json.loads(err.read() or b"{}")
            except ValueError:
                payload = {}
            return err.code, payload
        except (urllib.error.URLError, OSError, ValueError) as err:
            raise TransportError(str(err)) from err


@dataclass
class _Pending:
    key: ed25519.Ed25519PrivateKey
    request_id: str | None
    fetch_code: str | None


def _write_private(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)


class Enroller:
    """Runs until the workstation has an identity (or an admin rejects it). Safe to stop and start at any point."""

    def __init__(
        self,
        transport: Transport,
        state_dir: Path,
        identity_dir: Path,
        facts: Callable[[], MachineFacts] = read_machine_facts,
        agent_version: str = "0.1.0",
        sleep: Callable[[float], None] = time.sleep,
        rand: Callable[[], float] = random.random,
    ):
        self._t = transport
        self._state_dir = state_dir
        self._identity_dir = identity_dir
        self._facts = facts
        self._version = agent_version
        self._sleep = sleep
        self._rand = rand

    # ------------------------------------------------------------------ pending request on disk
    def _load_pending(self) -> _Pending:
        key_file = self._state_dir / PENDING_KEY
        if key_file.exists():
            key = load_key(key_file.read_bytes())
        else:
            key = new_key()
            self._state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            _write_private(key_file, key_pem(key))
        request_id = fetch_code = None
        state = self._state_dir / PENDING_FILE
        if state.exists():
            data = json.loads(state.read_text(encoding="utf-8"))
            request_id, fetch_code = data.get("request_id"), data.get("fetch_code")
        return _Pending(key, request_id, fetch_code)

    def _save_request(self, pending: _Pending) -> None:
        body = json.dumps({"request_id": pending.request_id, "fetch_code": pending.fetch_code}).encode()
        _write_private(self._state_dir / PENDING_FILE, body)

    def _forget_request(self) -> None:
        (self._state_dir / PENDING_FILE).unlink(missing_ok=True)

    def _forget_all(self) -> None:
        self._forget_request()
        (self._state_dir / PENDING_KEY).unlink(missing_ok=True)

    # ------------------------------------------------------------------ protocol
    def run(self) -> Identity:
        attempt = 0
        while True:
            pending = self._load_pending()
            try:
                if pending.request_id is None:
                    status, body = self._submit(pending)
                    if status == 201:
                        attempt = 0
                        continue
                    if status == 429:
                        self._sleep(backoff(attempt, self._rand))
                        attempt += 1
                        continue
                    error = (body.get("error") or {}).get("code", status)
                    raise EnrollmentRefused(f"enrollment request refused: {error}")
                status, body = self._t.request(
                    "GET", f"/workstations/enroll/{pending.request_id}/status", None, pending.fetch_code
                )
            except TransportError as err:
                delay = backoff(attempt, self._rand)
                log.warning("enrollment: server not reachable (%s), retrying in %.1fs", err, delay)
                self._sleep(delay)
                attempt += 1
                continue
            if status == 429:
                self._sleep(backoff(attempt, self._rand))
                attempt += 1
                continue
            if status == 401:
                # The fetch code is no longer valid (server data reset, request replaced): ask again with the same key.
                log.warning("enrollment: fetch code refused, submitting a new request")
                self._forget_request()
                continue
            if status != 200:
                raise EnrollmentRefused(f"unexpected status {status} while polling")
            attempt = 0
            state = body.get("status")
            if state == "pending":
                self._sleep(float(body.get("poll_interval_sec") or POLL_DEFAULT_SEC))
            elif state == "rejected":
                self._forget_all()
                raise EnrollmentRejected("an admin rejected this workstation's enrollment request")
            elif state == "approved":
                return self._install(pending, body)
            else:
                raise EnrollmentRefused(f"unknown enrollment status {state!r}")

    def _submit(self, pending: _Pending) -> tuple[int, dict]:
        facts = self._facts()
        status, body = self._t.request(
            "POST",
            "/workstations/enroll",
            {
                "machine_id": facts.machine_id,
                "hostname": facts.hostname,
                "mac_address": facts.mac_address,
                "csr_pem": make_csr(pending.key),
                "agent_version": self._version,
            },
        )
        if status == 201:
            pending.request_id, pending.fetch_code = str(body["request_id"]), str(body["fetch_code"])
            self._save_request(pending)
            log.info("enrollment requested (%s); waiting for an admin to approve it", pending.request_id)
        return status, body

    def _install(self, pending: _Pending, body: dict) -> Identity:
        name = body.get("mqtt_identity")
        key_version = body.get("key_version")
        km_hex = body.get("k_m")
        cert_pem = body.get("client_cert_pem")
        broker = body.get("broker") or {}
        if not isinstance(name, str) or not MQTT_IDENTITY.match(name):
            raise EnrollmentRefused("approved reply has no valid mqtt_identity")
        if (
            not isinstance(key_version, int)
            or key_version < 1
            or not isinstance(km_hex, str)
            or not KM_HEX.match(km_hex)
        ):
            raise EnrollmentRefused("approved reply has no valid key_version / k_m")
        if (
            not isinstance(cert_pem, str)
            or not isinstance(broker.get("host"), str)
            or not isinstance(broker.get("port"), int)
        ):
            raise EnrollmentRefused("approved reply has no certificate or broker address")
        cert = x509.load_pem_x509_certificate(cert_pem.encode())
        cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if not cn or cn[0].value != name:
            raise EnrollmentRefused("certificate is not issued to the approved name")
        public = cert.public_key()
        if not isinstance(public, ed25519.Ed25519PublicKey) or _raw_public(public) != _raw_public(
            pending.key.public_key()
        ):
            raise EnrollmentRefused("certificate does not belong to this workstation's key")
        identity = Identity(name, key_version, bytes.fromhex(km_hex))
        write_enrollment(self._identity_dir, identity, cert_pem, key_pem(pending.key), broker["host"], broker["port"])
        self._forget_all()
        log.info("enrolled as %s (key version %d)", name, key_version)
        return identity


def reenroll(identity_dir: Path, state_dir: Path) -> Path | None:
    """`nfc-agent reenroll` (D-014.6): keep the old identity aside, forget any pending request.

    `edge.db` is not touched: unsent audit records go out once the workstation has its new certificate.
    Returns where the old identity was moved, or None when there was none.
    """
    for name in (PENDING_FILE, PENDING_KEY, STOPPED_FILE):
        (state_dir / name).unlink(missing_ok=True)
    if not identity_dir.exists():
        return None
    old = identity_dir.with_name(f"{identity_dir.name}.old.{int(time.time())}")
    identity_dir.rename(old)
    return old
