"""systemd-logind adapter and Two-Phase Teardown (ADR-008, S7/S7b).

Teardown: disable-linger -> terminate-user (SIGTERM, up to 2.0 s) -> kill-user SIGKILL (up to 3.0 s total)
-> report "stuck" so the caller can show the yellow banner and retry up to 5.0 s, then give up.
The user is "gone" when user-<UID>.slice is inactive, /run/user/<UID> is gone and no process of the user remains.
"""

from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass

GRACE_TIMEOUT = 2.0
TOTAL_TEARDOWN_TIMEOUT = 3.0
STUCK_RETRY_UNTIL = 5.0
POLL = 0.05


@dataclass(frozen=True)
class OsSession:
    session_id: str
    username: str
    created_at: float  # UTC, derived from TimestampMonotonic (immune to wall-clock changes)


@dataclass(frozen=True)
class TeardownResult:
    clean: bool
    used_sigkill: bool
    seconds: float


Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=10)


class Logind:
    def __init__(self, run: Runner = _run, sleep=time.sleep, monotonic=time.monotonic, wall=time.time):
        self._run, self._sleep, self._mono, self._wall = run, sleep, monotonic, wall

    # ------------------------------------------------------------ sessions on seat0
    def gui_session(self, username: str) -> OsSession | None:
        """The graphical user session of `username` on seat0, if logind has one that is not closing."""
        listing = self._run(["loginctl", "list-sessions", "--no-legend"]).stdout.splitlines()
        for line in listing:
            parts = line.split()
            if len(parts) < 3 or parts[2] != username:
                continue
            props = self._props(parts[0])
            if (
                props.get("Seat") == "seat0"
                and props.get("Class") == "user"
                and props.get("State") != "closing"
                and props.get("Type") in ("x11", "wayland")
            ):
                created = self._wall() - (self._mono() - int(props.get("TimestampMonotonic", "0")) / 1e6)
                return OsSession(parts[0], username, created)
        return None

    def _props(self, session_id: str) -> dict[str, str]:
        out = self._run(
            [
                "loginctl",
                "show-session",
                session_id,
                "-p",
                "Seat",
                "-p",
                "Class",
                "-p",
                "State",
                "-p",
                "Type",
                "-p",
                "TimestampMonotonic",
            ]
        ).stdout
        return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)

    # ------------------------------------------------------------ teardown
    def user_gone(self, username: str) -> bool:
        import pwd  # Linux only

        uid = pwd.getpwnam(username).pw_uid
        slice_active = self._run(["systemctl", "is-active", f"user-{uid}.slice"]).stdout.strip() == "active"
        procs = self._run(["pgrep", "-u", username]).stdout.strip()
        return not slice_active and not os.path.exists(f"/run/user/{uid}") and not procs

    def _wait_gone(self, username: str, until: float) -> bool:
        while self._mono() < until:
            if self.user_gone(username):
                return True
            self._sleep(POLL)
        return self.user_gone(username)

    def teardown(self, username: str, on_stuck: Callable[[], None] | None = None) -> TeardownResult:
        start = self._mono()
        if self.user_gone(username):
            return TeardownResult(True, False, 0.0)
        self._run(["loginctl", "disable-linger", username])
        self._run(["loginctl", "terminate-user", username])
        if self._wait_gone(username, start + GRACE_TIMEOUT):
            return TeardownResult(True, False, self._mono() - start)
        self._run(["loginctl", "kill-user", username, "-s", "SIGKILL"])
        if self._wait_gone(username, start + TOTAL_TEARDOWN_TIMEOUT):
            return TeardownResult(True, True, self._mono() - start)
        if on_stuck:
            on_stuck()  # yellow banner (ADR-008 §2.4)
        while self._mono() < start + STUCK_RETRY_UNTIL:
            self._run(["loginctl", "kill-user", username, "-s", "SIGKILL"])
            if self._wait_gone(username, min(self._mono() + 1.0, start + STUCK_RETRY_UNTIL)):
                return TeardownResult(True, True, self._mono() - start)
        return TeardownResult(False, True, self._mono() - start)

    # ------------------------------------------------------------ desktop notification (ADR-005 / FR-012)
    def notify(self, username: str, title: str, body: str) -> None:
        """Send a desktop notification into the user's session bus (root -> user via runuser)."""
        import pwd  # Linux only

        uid = pwd.getpwnam(username).pw_uid
        self._run(
            [
                "runuser",
                "-u",
                username,
                "--",
                "env",
                f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus",
                "notify-send",
                "-u",
                "critical",
                "-a",
                "Phòng Lab",
                title,
                body,
            ]
        )


def boottime() -> float:
    """CLOCK_BOOTTIME: counts suspend too, immune to clock changes (D-012, INV-015)."""
    return time.clock_gettime(time.CLOCK_BOOTTIME)
