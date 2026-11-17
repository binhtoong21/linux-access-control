"""One swipe end to end inside the agent: write-ahead before teardown, then permission, then greeter (D-005)."""

import json

import pytest
from test_sessions import Clock, FakeOS
from test_store import IDENT, NOW, UID, signed, snapshot_bytes

from nfc_agent.app.agent import Agent
from nfc_agent.app.sessions import PENDING_TIMEOUT, SessionManager
from nfc_agent.domain.model import Outcome
from nfc_agent.infra import crypto
from nfc_agent.infra.ipc import AuthGate
from nfc_agent.infra.logind import OsSession
from nfc_agent.infra.reader import SwipeError
from nfc_agent.infra.store import Store

OTHER_UID = "04A32B1C5D6E80"


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
    snapshot = json.loads(snapshot_bytes())
    snapshot["users"].append(
        {**snapshot["users"][0], "id": "other-user", "external_id": "SV002", "full_name": "Other User"}
    )
    snapshot["cards"].append(
        {
            **snapshot["cards"][0],
            "match_key": crypto.card_match_key(IDENT.km, OTHER_UID),
            "card_id": "other-card",
            "user_id": "other-user",
        }
    )
    store.apply_snapshot(*signed(json.dumps(snapshot).encode()), NOW)
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
    d = a.handle_swipe("unknown")
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


@pytest.mark.parametrize(
    ("uid", "outcome", "reason"),
    [(UID, Outcome.NOOP, "already_active"), (OTHER_UID, Outcome.DENIED, "workstation_busy")],
)
def test_swipe_during_consumed_login_keeps_pending_until_gui_appears(agent, uid, outcome, reason):
    a, os_, clock, _ = agent
    a.handle_swipe(UID)
    pending = a.store.pending_session()
    assert a.gate.consume("student") == (True, "student")
    clock.advance(2)

    for _ in range(2):
        d = a.handle_swipe(uid)
        assert (d.outcome, d.reason) == (outcome, reason)
        assert a.store.pending_session() == pending
        assert a.gate.pending_entry is None
    assert a.store.active_session() is None

    os_.sessions["student"] = OsSession("c12", "student", clock.wall)
    a.sessions.tick()
    active = a.store.active_session()
    assert active.session_id == pending.session_id and active.os_session_id == "c12"
    assert active.expires_at == pending.expires_at
    assert a.store.pending_session() is None


@pytest.mark.parametrize("consumed", [False, True])
@pytest.mark.parametrize("uid,reason", [(UID, "already_active"), (OTHER_UID, "workstation_busy")])
def test_swipe_reconciles_gui_before_evaluation(agent, consumed, uid, reason):
    a, os_, clock, _ = agent
    a.handle_swipe(UID)
    pending = a.store.pending_session()
    if consumed:
        a.gate.consume("student")
    clock.advance(2)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall)

    d = a.handle_swipe(uid)

    assert d.reason == reason
    assert a.store.pending_session() is None
    assert a.store.active_session().session_id == pending.session_id
    events = [r["event_type"] for r in a.store.outbox_batch()]
    assert events[-2:] == ["session_started", "swipe_decision"]


def test_swipe_replaces_unconsumed_pending_login(agent):
    a, _, clock, _ = agent
    a.handle_swipe(UID)
    pending = a.store.pending_session()
    clock.advance(2)

    assert a.handle_swipe(OTHER_UID).granted
    assert a.store.pending_session().session_id != pending.session_id
    assert a.store._session("session_id = ?", pending.session_id).status == "discarded"
    assert a.gate.consume("student") == (True, "student")


@pytest.mark.parametrize("end", ["timeout", "expiry", "restart"])
def test_consumed_login_does_not_block_after_its_lifecycle_ends(agent, end):
    a, _, clock, _ = agent
    a.handle_swipe(UID)
    pending = a.store.pending_session()
    a.gate.consume("student")
    if end == "timeout":
        clock.advance(PENDING_TIMEOUT + 1)
        a.sessions.tick()
    elif end == "expiry":
        clock.boot = pending.boottime_limit + 1
        a.sessions.tick()
    else:
        a.gate = AuthGate()
        a.sessions.recover("boot-1", ("boot-1", clock.wall), ["student"])

    assert a.store.pending_session() is None
    assert a.handle_swipe(OTHER_UID).granted
    # The remembered old entry cannot make this new, unused permission busy.
    assert a.handle_swipe(UID).granted


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


def test_run_forever_returns_when_stopping_is_set(agent):
    a, _, _, _ = agent
    a.stopping.set()
    a.run_forever()


def test_run_forever_returns_on_call_event_setting_stopping(agent):
    a, _, _, _ = agent
    called = []

    def set_stopping():
        called.append(True)
        a.stopping.set()

    a.events.put(("call", set_stopping))
    a.run_forever()
    assert called == [True]
    assert a.stopping.is_set()
