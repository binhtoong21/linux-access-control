"""LocalSession lifecycle (ADR-008, session-expiry.md, swipe-login.md recovery table, INV-014/015/017).

A session only ends in the store once the OS session is really gone (INV-017). Deadlines use both the UTC
`expires_at` and the CLOCK_BOOTTIME `boottime_limit`; whichever comes first wins (INV-015).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from ..domain.model import CurrentSession, Decision
from ..infra.logind import OsSession, TeardownResult
from ..infra.store import SessionRow, Store

PENDING_TIMEOUT = 60.0  # pending session never shown up on seat0 -> discarded
CREATED_AFTER_TOLERANCE = 0.5  # monotonic->UTC conversion slack when comparing with decided_at


class OsPort(Protocol):
    def gui_session(self, username: str) -> OsSession | None: ...

    def teardown(self, username: str, on_stuck: Callable[[], None] | None = None) -> TeardownResult: ...

    def notify(self, username: str, title: str, body: str) -> None: ...


class SessionManager:
    def __init__(
        self,
        store: Store,
        os_port: OsPort,
        *,
        wall: Callable[[], float],
        boottime: Callable[[], float],
        push: Callable[[dict], object] = lambda event: None,
        warning_before_sec: Callable[[], int] = lambda: 300,
    ):
        self._store, self._os, self._wall, self._boot, self._push = store, os_port, wall, boottime, push
        self._warning_before = warning_before_sec
        self._warned: set[str] = set()

    # ------------------------------------------------------------------ queries
    def current(self) -> CurrentSession | None:
        s = self._store.active_session()
        if s is None:
            return None
        return CurrentSession(
            s.session_id, s.user_id, self._deadline_utc(s), self._os.gui_session(s.os_username) is not None
        )

    def _deadline_utc(self, s: SessionRow) -> float:
        """Earlier of the two deadlines, expressed in UTC for CR-001 step 8."""
        return min(s.expires_at, self._wall() + (s.boottime_limit - self._boot()))

    def _expired(self, s: SessionRow) -> bool:
        return self._wall() >= s.expires_at or self._boot() >= s.boottime_limit

    def boottime_limit_for(self, expires_at: float) -> float:
        return self._boot() + (expires_at - self._wall())

    # ------------------------------------------------------------------ before granting a new login
    def make_room(self, decision: Decision) -> bool:
        """Close the previous session the decision replaces. False = teardown stuck, the new login must not go on."""
        old = self._store.active_session()
        if decision.replaces is None or old is None:
            return True
        if decision.replaces == "superseded":
            result = self._os.teardown(old.os_username, on_stuck=lambda: self._push({"event": "teardown_wait"}))
            if not result.clean:
                self._store.record_alert("teardown_failed_stuck_resource", {"session_id": old.session_id})
                self._push({"event": "teardown_failed"})
                return False
        self._store.end_session(old.session_id, "abandoned", decision.replaces, "reported", self._wall())
        return True

    # ------------------------------------------------------------------ periodic watch (every ~1 s)
    def tick(self) -> None:
        self._watch_pending()
        self._watch_active()

    def _watch_pending(self) -> None:
        p = self._store.pending_session()
        if p is None:
            return
        gui = self._os.gui_session(p.os_username)
        if self._expired(p):  # the window closed before the desktop came up (session-expiry EF-5)
            if gui is not None:
                self._os.teardown(p.os_username)
            self._store.discard_pending(p.session_id, self._wall())
        elif gui is not None and gui.created_at > p.decided_at - CREATED_AFTER_TOLERANCE:
            self._store.activate_session(p.session_id, gui.session_id, gui.created_at)
            self._maybe_warn(self._store.active_session())
        elif self._wall() > p.decided_at + PENDING_TIMEOUT:
            self._store.discard_pending(p.session_id, self._wall())

    def _watch_active(self) -> None:
        s = self._store.active_session()
        if s is None:
            return
        gui = self._os.gui_session(s.os_username)
        if gui is None or gui.session_id != s.os_session_id:
            self._store.end_session(s.session_id, "completed", "user_logout", "reported", self._wall())
            self._warned.discard(s.session_id)
            return
        if self._expired(s):
            result = self._os.teardown(s.os_username)
            if result.clean:  # INV-017: only record the end once the OS session is really gone
                self._store.end_session(s.session_id, "forced_logout", "schedule_expired", "reported", self._wall())
                self._warned.discard(s.session_id)
            return
        self._maybe_warn(s)

    def _maybe_warn(self, s: SessionRow | None) -> None:
        if s is None or s.session_id in self._warned:
            return
        remaining = self._deadline_utc(s) - self._wall()
        if remaining <= self._warning_before():
            self._warned.add(s.session_id)
            minutes = max(1, round(remaining / 60))
            self._os.notify(
                s.os_username, "Sắp hết giờ", f"Phiên sẽ tự đăng xuất sau khoảng {minutes} phút. Hãy lưu bài."
            )

    def remind_remaining(self, decision: Decision) -> None:
        """noop(already_active): tell the user how long is left (BR-008a)."""
        s = self._store.active_session()
        if s is not None:
            minutes = max(0, round((self._deadline_utc(s) - self._wall()) / 60))
            self._os.notify(s.os_username, "Bạn đang trong phiên của mình", f"Còn khoảng {minutes} phút.")

    # ------------------------------------------------------------------ startup recovery & planned shutdown
    def recover(self, boot_id: str, previous: tuple[str, float] | None, profiles: list[str]) -> None:
        """swipe-login.md 'Recovery khi Agent khởi động lại' + D-017 (OS session with no LocalSession)."""
        now = self._wall()
        active, pending = self._store.active_session(), self._store.pending_session()
        rebooted = previous is None or previous[0] != boot_id
        if rebooted:
            last_alive = previous[1] if previous else now
            if active:
                self._store.end_session(
                    active.session_id, "abandoned", "workstation_rebooted", "reconstructed", last_alive
                )
            if pending:
                self._store.discard_pending(pending.session_id, now)
            return
        if active:
            gui = self._os.gui_session(active.os_username)
            if gui is None:
                self._store.end_session(active.session_id, "abandoned", "os_session_lost", "reported", now)
            elif self._expired(active) and self._os.teardown(active.os_username).clean:
                self._store.end_session(active.session_id, "forced_logout", "schedule_expired", "reported", now)
        if pending:
            gui = self._os.gui_session(pending.os_username)
            fresh = gui is not None and gui.created_at > pending.decided_at - CREATED_AFTER_TOLERANCE
            if fresh and not self._expired(pending) and self._store.active_session() is None:
                self._store.activate_session(pending.session_id, gui.session_id, gui.created_at)
            else:
                if gui is not None and not fresh:
                    self._os.teardown(pending.os_username)
                self._store.discard_pending(pending.session_id, now)
        if self._store.active_session() is None:
            for name in profiles:  # an OS session nobody is accounting for has no deadline: end it (D-017)
                if self._os.gui_session(name) is not None:
                    self._os.teardown(name)

    def planned_shutdown(self) -> None:
        s = self._store.active_session()
        if s is not None:
            self._store.end_session(s.session_id, "abandoned", "workstation_rebooted", "reported", self._wall())
