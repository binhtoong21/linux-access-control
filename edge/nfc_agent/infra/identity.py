"""Workstation identity (/var/lib/nfc-agent/identity/), the source of truth outside edge.db (D-017, ADR-003 §1)."""

from __future__ import annotations

import json
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

IDENTITY_FILE = "identity.json"
KEY_FILE = "client.key"
CERT_FILE = "client.crt"


@dataclass(frozen=True)
class Identity:
    mqtt_identity: str
    key_version: int
    km: bytes

    def __repr__(self) -> str:  # never print K_m
        return f"Identity(mqtt_identity={self.mqtt_identity!r}, key_version={self.key_version})"


@dataclass(frozen=True)
class Credentials:
    """What the MQTT client needs (ADR-002 §1): the workstation's certificate, its key and where the broker is."""

    cert_file: Path
    key_file: Path
    broker_host: str
    broker_port: int


class IdentityMissing(RuntimeError):
    """The machine is not enrolled (or identity/ was lost): run enrollment / `nfc-agent reenroll`."""


def load_identity(identity_dir: Path) -> Identity:
    path = identity_dir / IDENTITY_FILE
    if not path.exists():
        raise IdentityMissing(str(path))
    data = json.loads(path.read_text(encoding="utf-8"))
    km = bytes.fromhex(data["k_m"])
    if len(km) != 32:
        raise ValueError("K_m must be 32 bytes")
    return Identity(data["mqtt_identity"], int(data["key_version"]), km)


def write_identity(identity_dir: Path, identity: Identity) -> None:
    """Write via temp file + rename + directory fsync (S5 finding), mode 0600."""
    identity_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = identity_dir / (IDENTITY_FILE + ".tmp")
    body = json.dumps(
        {"mqtt_identity": identity.mqtt_identity, "key_version": identity.key_version, "k_m": identity.km.hex()}
    )
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, body.encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, identity_dir / IDENTITY_FILE)
    if hasattr(os, "O_DIRECTORY"):
        dfd = os.open(identity_dir, os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)


def _write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(path: Path) -> None:
    if hasattr(os, "O_DIRECTORY"):
        dfd = os.open(path, os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)


def write_enrollment(
    identity_dir: Path, identity: Identity, cert_pem: str, key_pem: bytes, broker_host: str, broker_port: int
) -> Path | None:
    """D-017: K_m, key version, name, certificate and key land together.

    Everything is written into a sibling temp directory that is renamed into place, so a crash leaves either the old
    identity or the new one. An existing identity directory is kept as `<name>.old.<unix_ts>`; its path is returned.
    """
    tmp = identity_dir.with_name(identity_dir.name + ".new")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(mode=0o700, parents=True)
    body = {
        "mqtt_identity": identity.mqtt_identity,
        "key_version": identity.key_version,
        "k_m": identity.km.hex(),
        "broker_host": broker_host,
        "broker_port": broker_port,
    }
    _write_private(tmp / IDENTITY_FILE, json.dumps(body).encode())
    _write_private(tmp / KEY_FILE, key_pem)
    _write_private(tmp / CERT_FILE, cert_pem.encode())
    _fsync_dir(tmp)
    old = None
    if identity_dir.exists():
        old = identity_dir.with_name(f"{identity_dir.name}.old.{int(time.time())}")
        identity_dir.rename(old)
    tmp.rename(identity_dir)
    _fsync_dir(identity_dir.parent)
    return old


def load_credentials(identity_dir: Path) -> Credentials:
    """The MQTT credentials of an enrolled workstation; IdentityMissing when it was provisioned without them."""
    data = json.loads((identity_dir / IDENTITY_FILE).read_text(encoding="utf-8"))
    cert, key = identity_dir / CERT_FILE, identity_dir / KEY_FILE
    if not cert.exists() or not key.exists() or "broker_host" not in data:
        raise IdentityMissing(f"{identity_dir} has no MQTT credentials: enroll the workstation")
    return Credentials(cert, key, str(data["broker_host"]), int(data["broker_port"]))
