"""Local IPC (ADR-005 §2): PAM channel, greeter push channel, and the one-time login permission between them.

PAM channel  /run/nfc-agent.sock         0660 root:root, peer must be UID 0 (SO_PEERCRED).
             request  "AUTH <pam_user>\\n"  ->  "GRANTED <os_username>\\n" | "DENIED <reason>\\n"
             (line protocol so the C module needs no JSON parsing)
Greeter      /run/nfc/greeter-push.sock  0770 root:lightdm (needs CAP_CHOWN, S11); JSON lines both ways.
             greeter -> agent: {"action": "greeter_ready"}
             agent -> greeter: {"event": "card_granted" | "card_denied" | "teardown_wait" | "teardown_failed" | ...}
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import struct
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

LOGIN_PERMISSION_TTL = 30.0  # seconds from granted to PAM asking (deployment.md, Bảng Tham Số)
PAM_SOCKET = Path("/run/nfc-agent.sock")
GREETER_SOCKET = Path("/run/nfc/greeter-push.sock")


@dataclass
class _Staged:
    entry_id: str
    os_username: str
    deadline: float


class AuthGate:
    """One-time permission bound to one decision (swipe-login.md principle 4). Thread-safe, monotonic clock."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._lock = threading.Lock()
        self._staged: _Staged | None = None
        self._clock = clock

    def stage(self, entry_id: str, os_username: str) -> None:
        with self._lock:
            self._staged = _Staged(entry_id, os_username, self._clock() + LOGIN_PERMISSION_TTL)

    def clear(self) -> None:
        with self._lock:
            self._staged = None

    def consume(self, pam_user: str) -> tuple[bool, str]:
        """Return (granted, os_username|reason). Consumed on success; a mismatching user does not consume it."""
        with self._lock:
            s = self._staged
            if s is None:
                return False, "no_pending_login"
            if self._clock() > s.deadline:
                self._staged = None
                return False, "expired"
            if pam_user and pam_user != s.os_username:
                return False, "user_mismatch"
            self._staged = None
            return True, s.os_username

    @property
    def pending_entry(self) -> str | None:
        with self._lock:
            return None if self._staged is None else self._staged.entry_id


def _bind_unix(path: Path, mode: int, group: str | None = None) -> socket.socket:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(str(path))
    if group:
        shutil.chown(path, user="root", group=group)
    os.chmod(path, mode)
    srv.listen(8)
    return srv


def peer_uid(conn: socket.socket) -> int:
    _pid, uid, _gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
    return uid


class PamServer(threading.Thread):
    """Answers pam_nfc.so. Only root may ask (the display manager); anything else is refused (ADR-005)."""

    def __init__(self, gate: AuthGate, path: Path = PAM_SOCKET, on_consumed: Callable[[str], None] | None = None):
        super().__init__(daemon=True, name="pam-server")
        self._gate, self._path, self._on_consumed = gate, path, on_consumed
        self._srv = _bind_unix(path, 0o660)

    def run(self) -> None:
        while True:
            conn, _ = self._srv.accept()
            with conn:
                conn.settimeout(2.0)
                try:
                    reply = self._handle(conn)
                except (OSError, ValueError):
                    reply = "DENIED bad_request"
                try:
                    conn.sendall((reply + "\n").encode())
                except OSError:
                    pass

    def _handle(self, conn: socket.socket) -> str:
        if peer_uid(conn) != 0:
            return "DENIED not_root"
        line = conn.recv(256).decode("ascii", "strict").strip()
        verb, _, user = line.partition(" ")
        if verb != "AUTH":
            return "DENIED bad_request"
        granted, value = self._gate.consume(user.strip())
        if granted and self._on_consumed:
            self._on_consumed(value)
        return f"GRANTED {value}" if granted else f"DENIED {value}"


class GreeterHub(threading.Thread):
    """Keeps the connection of the greeter that said greeter_ready; push() sends one JSON event to it."""

    def __init__(self, path: Path = GREETER_SOCKET, group: str = "lightdm"):
        super().__init__(daemon=True, name="greeter-hub")
        self._srv = _bind_unix(path, 0o770, group)
        self._lock = threading.Lock()
        self._conn: socket.socket | None = None
        self.ready = threading.Event()

    def run(self) -> None:
        while True:
            conn, _ = self._srv.accept()
            threading.Thread(target=self._client, args=(conn,), daemon=True).start()

    def _client(self, conn: socket.socket) -> None:
        buf = b""
        try:
            while chunk := conn.recv(1024):
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.strip() and json.loads(line).get("action") == "greeter_ready":
                        with self._lock:
                            self._conn = conn
                        self.ready.set()
        except (OSError, ValueError):
            pass
        finally:
            with self._lock:
                if self._conn is conn:
                    self._conn, _ = None, self.ready.clear()
            conn.close()

    def push(self, event: dict) -> bool:
        with self._lock:
            conn = self._conn
        if conn is None:
            return False
        try:
            conn.sendall((json.dumps(event, ensure_ascii=False) + "\n").encode())
            return True
        except OSError:
            return False
