"""Agent orchestration (containers.md: NFC Edge Agent Daemon).

One swipe, in order (swipe-login.md, D-005):
  evaluate CR-001 -> persist audit (+ pending session if granted) -> tear down the replaced session
  -> stage the one-time permission -> push the result to the greeter -> PAM consumes the permission.
Everything runs on one worker thread fed by a queue, so decisions never interleave (BR-007c "not processing
another swipe"); the reader, PAM and control sockets only enqueue.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ..domain.evaluation import evaluate
from ..domain.model import Decision, Outcome
from ..infra import crypto
from ..infra.identity import Identity
from ..infra.ipc import AuthGate, GreeterHub, PamServer, _bind_unix, peer_uid
from ..infra.reader import CardSwiped, ReaderUnavailable, SwipeDetector, SwipeError
from ..infra.store import OutboxFull, PendingSession, Store
from .sessions import SessionManager

log = logging.getLogger("nfc_agent")

CONTROL_SOCKET = Path("/run/nfc-control.sock")
PROFILE_GROUP = "labstudent"
LIVENESS_EVERY = 300.0  # last_alive_at (deployment.md, Bảng Tham Số)
DISCOVERY_EVERY = 60.0


@dataclass
class AgentConfig:
    db_path: Path = Path("/var/lib/nfc-agent/edge.db")
    identity_dir: Path = Path("/var/lib/nfc-agent/identity")
    control_socket: Path = CONTROL_SOCKET
    reader: str = "pcsc"  # "pcsc" | "sim"
    extra: dict = field(default_factory=dict)


def read_boot_id() -> str:
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def discover_profiles(group: str = PROFILE_GROUP) -> list[str]:
    """Auto-Discovery (D-009, INV-018): members of the restricted group with UID >= 1000."""
    import grp  # Linux only
    import pwd

    try:
        g = grp.getgrnam(group)
    except KeyError:
        return []
    names = set(g.gr_mem) | {p.pw_name for p in pwd.getpwall() if p.pw_gid == g.gr_gid}
    return sorted(n for n in names if pwd.getpwnam(n).pw_uid >= 1000)


class Agent:
    def __init__(
        self,
        store: Store,
        identity: Identity,
        sessions: SessionManager,
        gate: AuthGate,
        greeter: GreeterHub | None,
        boot_id: str,
        wall=time.time,
    ):
        self.store, self.identity, self.sessions, self.gate = store, identity, sessions, gate
        self.greeter, self.boot_id, self.wall = greeter, boot_id, wall
        self.events: queue.Queue = queue.Queue()

    # ------------------------------------------------------------------ one swipe
    def handle_swipe(self, uid: str) -> Decision:
        self.gate.clear()  # a new swipe supersedes any permission not yet used by PAM
        now = self.wall()
        decision = evaluate(
            crypto.card_match_key(self.identity.km, uid),
            now,
            self.store.snapshot_view(),
            self.store.lease(),
            self.sessions.current(),
        )
        version = self.store.meta()["version"]
        pending = None
        if decision.granted:
            pending = PendingSession(
                str(uuid.uuid4()), self.boot_id, self.sessions.boottime_limit_for(decision.expires_at)
            )
        try:
            entry_id = self.store.record_swipe(
                decision, occurred_at=now, card_uid=uid, data_version=version, pending=pending
            )
        except OutboxFull:
            log.error("audit outbox full: refusing swipes until the server acknowledges")
            self._push({"event": "card_denied", "reason": "internal_error"})
            return decision
        log.info("swipe %s -> %s/%s", uid, decision.outcome.value, decision.reason)

        if decision.outcome is Outcome.NOOP:
            self.sessions.remind_remaining(decision)
        elif not decision.granted:
            self._push({"event": "card_denied", "reason": decision.reason, "detail": decision.detail})
        elif not self.sessions.make_room(decision):  # stuck teardown: the audit stays "granted" (D-005)
            self.store.discard_pending(pending.session_id, self.wall())
        else:
            self.gate.stage(entry_id, decision.target_os_username)
            self._push(
                {
                    "event": "card_granted",
                    "os_username": decision.target_os_username,
                    "display_name": f"{decision.user.full_name} ({decision.user.external_id})",
                }
            )
        return decision

    def handle_error(self, err: SwipeError) -> None:
        d = Decision(Outcome.ERROR, err.reason)
        self.store.record_swipe(
            d,
            occurred_at=self.wall(),
            card_uid=None,
            reader_raw=err.reader_raw,
            data_version=self.store.meta()["version"],
        )
        self._push({"event": "card_denied", "reason": err.reason})

    def _push(self, event: dict) -> None:
        if self.greeter is not None:
            self.greeter.push(event)

    # ------------------------------------------------------------------ loop
    def run_forever(self) -> None:
        next_tick = next_alive = next_discovery = 0.0
        while True:
            try:
                kind, payload = self.events.get(timeout=1.0)
            except queue.Empty:
                kind = None
            try:
                if kind == "uid":
                    self.handle_swipe(payload)
                elif kind == "error":
                    self.handle_error(payload)
                elif kind == "call":
                    payload()
            except Exception:  # never let one event kill the agent; PAM would fall back to passwords
                log.exception("event %s failed", kind)
            now = time.monotonic()
            if now >= next_tick:
                self._safe(self.sessions.tick)
                next_tick = now + 1.0
            if now >= next_alive:
                self._safe(lambda: self.store.touch_liveness(self.boot_id, self.wall()))
                next_alive = now + LIVENESS_EVERY
            if now >= next_discovery:
                self._safe(lambda: self.store.set_present_profiles(discover_profiles()))
                next_discovery = now + DISCOVERY_EVERY

    @staticmethod
    def _safe(fn) -> None:
        try:
            fn()
        except Exception:
            log.exception("periodic task failed")

    def start_reader(self, detector: SwipeDetector) -> None:
        def loop():
            for ev in detector.events():
                if isinstance(ev, CardSwiped):
                    self.events.put(("uid", ev.uid))
                elif isinstance(ev, SwipeError):
                    self.events.put(("error", ev))
                elif isinstance(ev, ReaderUnavailable):
                    log.warning("card reader unavailable: %s", ev.detail)

        threading.Thread(target=loop, daemon=True, name="reader").start()

    def start_control(self, path: Path) -> None:
        """Root-only local admin channel (ADR-005 §2.3): simulate-swipe, apply-snapshot, status."""
        srv = _bind_unix(path, 0o770)

        def serve():
            while True:
                conn, _ = srv.accept()
                with conn:
                    try:
                        reply = self._control(conn)
                    except Exception as exc:  # noqa: BLE001 - report to the operator
                        reply = {"ok": False, "error": str(exc)}
                    conn.sendall((json.dumps(reply, ensure_ascii=False) + "\n").encode())

        threading.Thread(target=serve, daemon=True, name="control").start()

    def _control(self, conn: socket.socket) -> dict:
        if peer_uid(conn) != 0:
            return {"ok": False, "error": "root only"}
        conn.settimeout(5)
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = conn.recv(1 << 20)
            if not chunk:
                break
            buf += chunk
        req = json.loads(buf)
        done: queue.Queue = queue.Queue()
        if req["cmd"] == "simulate_swipe":
            self.events.put(("call", lambda: done.put(self.handle_swipe(req["uid"]))))
            d = done.get(timeout=10)
            return {"ok": True, "outcome": d.outcome.value, "reason": d.reason, "detail": d.detail}
        if req["cmd"] == "apply_snapshot":
            raw = bytes.fromhex(req["payload_hex"])
            self.events.put(("call", lambda: done.put(self.store.apply_snapshot(raw, req["signature"], self.wall()))))
            result, error = done.get(timeout=10)
            return {"ok": error is None, "result": result.value, "error": error}
        if req["cmd"] == "status":
            m, s = self.store.meta(), self.store.active_session()
            return {
                "ok": True,
                "identity": self.identity.mqtt_identity,
                "snapshot_version": m["version"],
                "trusted_until": m["trusted_until"],
                "last_apply_error": m["last_apply_error"],
                "outbox": self.store.outbox_count(),
                "active_session": s and s.session_id,
                "profiles": discover_profiles(),
            }
        return {"ok": False, "error": f"unknown cmd {req['cmd']}"}


def build(config: AgentConfig) -> Agent:
    from ..infra import logind
    from ..infra.identity import load_identity
    from ..infra.reader import PcscBackend, SimulatedBackend

    identity = load_identity(config.identity_dir)
    boot_id = read_boot_id()
    previous = None
    store, report = Store.open(config.db_path, identity, boot_id)
    if report:
        log.error("edge.db was corrupt, quarantined as %s", report.quarantined_as)
    previous = store.previous_liveness()
    os.makedirs("/run/nfc", mode=0o755, exist_ok=True)
    gate = AuthGate()
    greeter = GreeterHub()
    greeter.start()
    os_port = logind.Logind()
    sessions = SessionManager(
        store,
        os_port,
        wall=time.time,
        boottime=logind.boottime,
        push=greeter.push,
        warning_before_sec=lambda: store.meta()["warning_before_sec"],
    )
    agent = Agent(store, identity, sessions, gate, greeter, boot_id)
    store.set_present_profiles(discover_profiles())
    sessions.recover(boot_id, previous, discover_profiles())  # before accepting any swipe (reboot.md)
    store.touch_liveness(boot_id, time.time())
    PamServer(gate).start()
    agent.start_control(config.control_socket)
    backend = SimulatedBackend() if config.reader == "sim" else PcscBackend()
    agent.start_reader(SwipeDetector(backend))
    return agent
