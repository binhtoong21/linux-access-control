"""One swipe end to end inside the agent: write-ahead before teardown, then permission, then greeter (D-005)."""

import pytest
from test_sessions import Clock, FakeOS
from test_store import IDENT, NOW, UID, signed, snapshot_bytes

from nfc_agent.app.agent import Agent
from nfc_agent.app.sessions import SessionManager
from nfc_agent.infra.ipc import AuthGate
from nfc_agent.infra.logind import OsSession
from nfc_agent.infra.reader import SwipeError
from nfc_agent.infra.store import Store


class Greeter:
    def __init__(self):
        self.events = []

    def push(self, event):
        self.events.append(event)
        return True


@pytest.fixture
def agent(tmp_path):
    clock, os_ = Clock(), FakeOS()
    store, _ = Store.open(tmp_path / "edge.db", IDENT, "boot-1", clock=lambda: clock.wall)
    store.apply_snapshot(*signed(snapshot_bytes()), NOW)
    store.set_present_profiles(["student"])
    greeter = Greeter()
    sessions = SessionManager(store, os_, wall=lambda: clock.wall, boottime=lambda: clock.boot, push=greeter.push)
    a = Agent(store, IDENT, sessions, AuthGate(), greeter, "boot-1", wall=lambda: clock.wall)
    yield a, os_, clock, greeter
    store.close()


def test_granted_swipe_stages_permission_and_tells_greeter(agent):
    a, _, _, greeter = agent
    d = a.handle_swipe(UID)
    assert d.granted
    assert a.store.pending_session() is not None
    assert a.gate.consume("student") == (True, "student")
    assert greeter.events[-1]["event"] == "card_granted" and "SV001" in greeter.events[-1]["display_name"]


def test_unknown_card_is_denied_and_audited(agent):
    a, _, _, greeter = agent
    d = a.handle_swipe("04A32B1C5D6E80")
    assert d.reason == "unknown_card" and greeter.events[-1] == {
        "event": "card_denied",
        "reason": "unknown_card",
        "detail": None,
    }
    assert a.store.outbox_batch()[-1]["payload"]["outcome"] == "denied"
    assert a.gate.pending_entry is None


def test_same_user_again_is_noop_with_reminder(agent):
    a, os_, clock, _ = agent
    a.handle_swipe(UID)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall + 1)
    clock.advance(2)
    a.sessions.tick()
    d = a.handle_swipe(UID)
    assert d.reason == "already_active" and os_.notes[-1][1] == "Bạn đang trong phiên của mình"


def test_stuck_teardown_keeps_audit_but_drops_login(agent):
    """D-005 + ADR-008: the decision is persisted before teardown; if teardown is stuck, no login happens."""
    a, os_, clock, greeter = agent
    a.handle_swipe(UID)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall + 1)
    clock.advance(2)
    a.sessions.tick()
    s = a.store.active_session()
    clock.wall, clock.boot = s.expires_at - 1, s.boottime_limit - 1
    os_.stuck = True
    clock.wall = s.expires_at + 1  # previous session overdue (UTC) -> next swipe supersedes it
    clock.boot = s.boottime_limit + 1
    clock.wall = NOW + 3600  # back inside today's window for the evaluation
    d = a.handle_swipe(UID)
    assert d.granted and d.replaces == "superseded"
    assert a.store.outbox_batch()[-1]["payload"]["kind"] == "teardown_failed_stuck_resource"
    assert a.store.pending_session() is None and a.gate.pending_entry is None
    assert {"event": "teardown_failed"} in greeter.events


def test_reader_error_is_audited_without_uid(agent):
    a, _, _, greeter = agent
    a.handle_error(SwipeError("reader_error", "Card is unresponsive."))
    rec = a.store.outbox_batch()[-1]["payload"]
    assert (rec["outcome"], rec["reason"], rec["card_uid"]) == ("error", "reader_error", None)
    assert greeter.events[-1]["reason"] == "reader_error"
