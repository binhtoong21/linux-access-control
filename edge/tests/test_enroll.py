"""Enrollment client: CSR, machine facts, pending state across restarts, retries, install and its checks
(D-014, D-017).
"""

import datetime as dt
import os

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.x509.oid import NameOID

from nfc_agent.infra import enroll
from nfc_agent.infra.enroll import (
    Enroller,
    EnrollmentRefused,
    EnrollmentRejected,
    HttpsTransport,
    MachineFacts,
    TransportError,
)
from nfc_agent.infra.identity import IdentityMissing, load_credentials, load_identity

FACTS = MachineFacts("3f9a0c1d2e3b4a5f6e7d8c9b0a1f2e3d", "lab-a-pc07", "52:54:00:12:34:56")
KM = "ab" * 32
REQUEST = "e2b0c442-98fc-4c1c-b934-ca495991b852"


def _ca():
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    return key, cert


CA_KEY, CA_CERT = _ca()


def issue(csr_pem: str, cn: str) -> str:
    """What the server's CA does with our CSR."""
    csr = x509.load_pem_x509_csr(csr_pem.encode())
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)]))
        .issuer_name(CA_CERT.subject)
        .public_key(csr.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=30))
        .sign(CA_KEY, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


class FakeServer:
    """Answers like api.md §6; `script` lists the status replies to give, in order, then fails the test."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.csrs = []

    def request(self, method, path, body=None, bearer=None):
        self.calls.append((method, path, bearer))
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        if method == "POST":
            assert path == "/workstations/enroll"
            self.csrs.append(body["csr_pem"])
            return (
                step
                if isinstance(step, tuple)
                else (201, {"request_id": REQUEST, "fetch_code": "code-1", "poll_interval_sec": 5})
            )
        assert path == f"/workstations/enroll/{REQUEST}/status"
        if step == "approved":
            return 200, approved(self.csrs[-1])
        if isinstance(step, tuple):
            return step
        return 200, {"status": step, "poll_interval_sec": 5}


def approved(csr_pem, cn="ws-07", **change):
    body = {
        "status": "approved",
        "mqtt_identity": "ws-07",
        "key_version": 2,
        "client_cert_pem": issue(csr_pem, cn),
        "k_m": KM,
        "broker": {"host": "lab-server", "port": 8883},
    }
    body.update(change)
    return body


class Stop(Exception):
    pass


@pytest.fixture
def dirs(tmp_path):
    return tmp_path / "state", tmp_path / "identity"


def make(server, dirs, sleeps=None, stop_after=None):
    state, identity = dirs
    record = [] if sleeps is None else sleeps

    def sleep(sec):
        record.append(sec)
        if stop_after is not None and len(record) >= stop_after:
            raise Stop()

    return Enroller(server, state, identity, facts=lambda: FACTS, agent_version="1.0.0", sleep=sleep, rand=lambda: 0.5)


def test_csr_is_ed25519_and_signed_by_the_key():
    key = enroll.new_key()
    csr = x509.load_pem_x509_csr(enroll.make_csr(key).encode())
    assert csr.is_signature_valid
    assert isinstance(csr.public_key(), ed25519.Ed25519PublicKey)
    assert csr.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ) == key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    assert enroll.load_key(enroll.key_pem(key)).public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ) == key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def test_machine_facts_take_the_first_physical_interface(tmp_path):
    net = tmp_path / "net"
    for name, mac, physical in [
        ("lo", "00:00:00:00:00:00", False),
        ("docker0", "02:42:ac:11:00:01", False),
        ("enp0s8", "52:54:00:AA:BB:02", True),
        ("enp0s3", "52:54:00:AA:BB:01", True),
    ]:
        (net / name).mkdir(parents=True)
        (net / name / "address").write_text(mac + "\n")
        if physical:
            (net / name / "device").mkdir()
    machine_id = tmp_path / "machine-id"
    machine_id.write_text("3f9a0c1d2e3b4a5f6e7d8c9b0a1f2e3d\n")
    facts = enroll.read_machine_facts(machine_id, net)
    assert (facts.machine_id, facts.mac_address) == ("3f9a0c1d2e3b4a5f6e7d8c9b0a1f2e3d", "52:54:00:aa:bb:01")
    machine_id.write_text("")
    with pytest.raises(RuntimeError, match="master image"):
        enroll.read_machine_facts(machine_id, net)
    empty = tmp_path / "empty-net"
    empty.mkdir()
    with pytest.raises(RuntimeError, match="no physical"):
        enroll.first_mac(empty)


def test_enrolls_after_approval_and_installs_identity_and_credentials(dirs):
    server = FakeServer(["submit", "pending", "pending", "approved"])
    sleeps = []
    identity = make(server, dirs, sleeps).run()
    assert (identity.mqtt_identity, identity.key_version, identity.km.hex()) == ("ws-07", 2, KM)
    assert sleeps == [5.0, 5.0]
    assert [c[0] for c in server.calls] == ["POST", "GET", "GET", "GET"]
    assert all(c[2] == "code-1" for c in server.calls[1:])
    state, identity_dir = dirs
    assert load_identity(identity_dir) == identity
    creds = load_credentials(identity_dir)
    assert (creds.broker_host, creds.broker_port) == ("lab-server", 8883)
    cert = x509.load_pem_x509_certificate(creds.cert_file.read_bytes())
    key = enroll.load_key(creds.key_file.read_bytes())
    assert cert.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ) == key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    assert not (state / enroll.PENDING_FILE).exists() and not (state / enroll.PENDING_KEY).exists()
    assert not identity_dir.with_name("identity.new").exists()
    if os.name == "posix":
        for f in (identity_dir / "identity.json", creds.key_file, creds.cert_file):
            assert f.stat().st_mode & 0o077 == 0


def test_a_restart_while_pending_continues_the_same_request_with_the_same_key(dirs):
    first = FakeServer(["submit", "pending"])
    with pytest.raises(Stop):
        make(first, dirs, stop_after=1).run()
    state, _ = dirs
    assert (state / enroll.PENDING_FILE).exists()
    second = FakeServer(["approved"])
    second.csrs = list(first.csrs)
    identity = make(second, dirs).run()
    assert identity.mqtt_identity == "ws-07"
    assert [c[0] for c in second.calls] == ["GET"]


def test_a_refused_fetch_code_submits_again_with_the_same_key(dirs):
    server = FakeServer(["submit", (401, {"error": {"code": "INVALID_FETCH_CODE"}}), "submit", "approved"])
    make(server, dirs).run()
    assert [c[0] for c in server.calls] == ["POST", "GET", "POST", "GET"]
    assert len(server.csrs) == 2
    keys = {
        x509.load_pem_x509_csr(c.encode())
        .public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        for c in server.csrs
    }
    assert len(keys) == 1


def test_network_errors_and_rate_limits_back_off_with_jitter(dirs):
    server = FakeServer(
        [TransportError("down"), TransportError("down"), (429, {}), "submit", TransportError("timeout"), "approved"]
    )
    sleeps = []
    make(server, dirs, sleeps).run()
    # rand() = 0.5 gives a factor of exactly 1.0; the counter restarts after the successful submit.
    assert sleeps == [1.0, 2.0, 4.0, 1.0]
    assert [enroll.backoff(n, lambda: 0.0) for n in (0, 3, 10)] == [0.8, 6.4, 48.0]
    assert [enroll.backoff(n, lambda: 1.0) for n in (0, 10)] == pytest.approx([1.2, 72.0])


def test_a_rejected_request_stops_and_forgets_the_key(dirs):
    with pytest.raises(EnrollmentRejected):
        make(FakeServer(["submit", "pending", "rejected"]), dirs).run()
    state, identity_dir = dirs
    assert not (state / enroll.PENDING_FILE).exists() and not (state / enroll.PENDING_KEY).exists()
    assert not identity_dir.exists()


def test_a_refused_request_is_not_retried(dirs):
    with pytest.raises(EnrollmentRefused, match="INVALID_CSR"):
        make(FakeServer([(400, {"error": {"code": "INVALID_CSR"}})]), dirs).run()


@pytest.mark.parametrize(
    "change",
    [
        {"mqtt_identity": "x"},
        {"key_version": 0},
        {"k_m": "short"},
        {"broker": {"host": "lab-server"}},
        {"client_cert_pem": None},
    ],
)
def test_an_approved_reply_that_does_not_fit_is_refused(dirs, change):
    class Bad(FakeServer):
        def request(self, method, path, body=None, bearer=None):
            status, reply = super().request(method, path, body, bearer)
            return (status, {**reply, **change}) if reply.get("status") == "approved" else (status, reply)

    with pytest.raises(EnrollmentRefused):
        make(Bad(["submit", "approved"]), dirs).run()
    assert not dirs[1].exists()


def test_a_certificate_for_another_name_or_key_is_refused(dirs):
    class OtherName(FakeServer):
        def request(self, method, path, body=None, bearer=None):
            if method == "GET":
                return 200, approved(self.csrs[-1], cn="ws-99")
            return super().request(method, path, body, bearer)

    with pytest.raises(EnrollmentRefused, match="name"):
        make(OtherName(["submit", "x"]), dirs).run()

    class OtherKey(FakeServer):
        def request(self, method, path, body=None, bearer=None):
            if method == "GET":
                return 200, approved(enroll.make_csr(enroll.new_key()))
            return super().request(method, path, body, bearer)

    with pytest.raises(EnrollmentRefused, match="key"):
        make(OtherKey(["submit", "x"]), dirs).run()
    assert not dirs[1].exists()


def test_reenroll_keeps_the_old_identity_aside_and_a_second_enrollment_replaces_it(dirs):
    state, identity_dir = dirs
    make(FakeServer(["submit", "approved"]), dirs).run()
    old = enroll.reenroll(identity_dir, state)
    assert old is not None and old.name.startswith("identity.old.") and (old / "identity.json").exists()
    with pytest.raises(IdentityMissing):
        load_identity(identity_dir)
    assert enroll.reenroll(identity_dir, state) is None
    make(FakeServer(["submit", "approved"]), dirs).run()
    assert load_identity(identity_dir).mqtt_identity == "ws-07"


def test_credentials_are_missing_for_a_dev_provisioned_identity(tmp_path):
    from nfc_agent.infra.identity import Identity, write_identity

    write_identity(tmp_path, Identity("ws-dev-01", 1, bytes(32)))
    with pytest.raises(IdentityMissing):
        load_credentials(tmp_path)


def test_https_transport_refuses_plain_http(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_bytes(CA_CERT.public_bytes(serialization.Encoding.PEM))
    with pytest.raises(ValueError, match="https"):
        HttpsTransport("http://lab-server", ca)
    transport = HttpsTransport("https://127.0.0.1:9", ca, timeout=2)
    with pytest.raises(TransportError):
        transport.request("GET", "/system/health")
