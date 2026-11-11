"""One-time login permission (swipe-login.md principle 4) and the local sockets (Linux only)."""

import json
import os
import socket
import sys
import time

import pytest

from nfc_agent.infra.ipc import LOGIN_PERMISSION_TTL, AuthGate


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_permission_is_single_use():
    gate = AuthGate()
    gate.stage("e1", "student")
    assert gate.consume("student") == (True, "student")
    assert gate.consume("student") == (False, "no_pending_login")


def test_permission_expires():
    clock = FakeClock()
    gate = AuthGate(clock)
    gate.stage("e1", "student")
    clock.t += LOGIN_PERMISSION_TTL + 0.1
    assert gate.consume("student") == (False, "expired")


def test_pam_user_must_match_target_profile():
    """ADR-005: PAM_USER must equal the profile the decision resolved; a mismatch does not burn the permission."""
    gate = AuthGate()
    gate.stage("e1", "student")
    assert gate.consume("labadmin") == (False, "user_mismatch")
    assert gate.consume("student") == (True, "student")


def test_empty_pam_user_gets_target_profile():
    gate = AuthGate()
    gate.stage("e1", "student")
    assert gate.consume("") == (True, "student")


linux_only = pytest.mark.skipif(sys.platform != "linux", reason="AF_UNIX + SO_PEERCRED")


@linux_only
def test_pam_channel_end_to_end(tmp_path):
    from nfc_agent.infra.ipc import PamServer

    gate = AuthGate()
    consumed = []
    server = PamServer(gate, tmp_path / "pam.sock", on_consumed=consumed.append)
    server.start()

    def ask(user):
        with socket.socket(socket.AF_UNIX) as s:
            s.connect(str(tmp_path / "pam.sock"))
            s.sendall(f"AUTH {user}\n".encode())
            return s.recv(256).decode().strip()

    expected_root = os.geteuid() == 0
    gate.stage("e1", "student")
    reply = ask("student")
    if expected_root:
        assert reply == "GRANTED student" and consumed == ["student"]
    else:
        assert reply == "DENIED not_root"  # non-root peers are refused (SO_PEERCRED)


@linux_only
def test_greeter_hub_pushes_after_ready(tmp_path):
    import grp

    from nfc_agent.infra.ipc import GreeterHub

    group = grp.getgrgid(os.getgid()).gr_name
    if os.geteuid() != 0:
        pytest.skip("chown to a group needs root/CAP_CHOWN")
    hub = GreeterHub(tmp_path / "push.sock", group)
    hub.start()
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(str(tmp_path / "push.sock"))
        s.sendall(b'{"action": "greeter_ready"}\n')
        assert hub.ready.wait(2)
        assert hub.push({"event": "card_granted", "os_username": "student"})
        s.settimeout(2)
        assert json.loads(s.recv(256))["event"] == "card_granted"
    time.sleep(0.1)
