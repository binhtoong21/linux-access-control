"""Session lifecycle on a real edge.db with a fake OS (ADR-008, session-expiry.md, recovery table)."""

import pytest
from test_store import IDENT, KM, NOW, UID, signed, snapshot_bytes

from nfc_agent.app.sessions import PENDING_TIMEOUT, SessionManager
from nfc_agent.domain.evaluation import evaluate
from nfc_agent.domain.model import Decision, Outcome
from nfc_agent.infra import crypto
from nfc_agent.infra.logind import OsSession, TeardownResult
from nfc_agent.infra.store import PendingSession, Store


class Clock:
    def __init__(self):
        self.wall, self.boot = NOW, 1000.0

    def advance(self, s):
        self.wall += s
        self.boot += s


class FakeOS:
    def __init__(self):
        self.sessions: dict[str, OsSession] = {}
        self.teardowns: list[str] = []
        self.notes: list[tuple[str, str]] = []
        self.stuck = False

    def gui_session(self, username):
        return self.sessions.get(username)

    def teardown(self, username, on_stuck=None):
        self.teardowns.append(username)
        if self.stuck:
            if on_stuck:
                on_stuck()
            return TeardownResult(False, True, 5.0)
        self.sessions.pop(username, None)
        return TeardownResult(True, True, 2.2)

    def notify(self, username, title, body):
        self.notes.append((username, title))


@pytest.fixture
def env(tmp_path):
    clock, os_ = Clock(), FakeOS()
    store, _ = Store.open(tmp_path / "edge.db", IDENT, "boot-1", clock=lambda: clock.wall)
    store.apply_snapshot(*signed(snapshot_bytes()), NOW)
    store.set_present_profiles(["student"])
    pushed = []
    mgr = SessionManager(store, os_, wall=lambda: clock.wall, boottime=lambda: clock.boot, push=pushed.append)
    yield store, os_, clock, mgr, pushed
    store.close()


def grant(store, mgr, clock, session_id="sess-1"):
    d = evaluate(crypto.card_match_key(KM, UID), clock.wall, store.snapshot_view(), store.lease(), mgr.current())
    assert d.granted, d
    store.record_swipe(
        d,
        occurred_at=clock.wall,
        card_uid=UID,
        data_version=13,
        pending=PendingSession(session_id, "boot-1", mgr.boottime_limit_for(d.expires_at)),
    )
    return d


def events(store):
    return [r["event_type"] for r in store.outbox_batch()]


def test_pending_becomes_active_when_desktop_appears(env):
    store, os_, clock, mgr, _ = env
    grant(store, mgr, clock)
    clock.advance(5)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall - 1)
    mgr.tick()
    assert store.active_session().os_session_id == "c12"
    assert events(store)[-1] == "session_started"


def test_leftover_older_session_is_not_promoted(env):
    """P1-2: an OS session created before the decision belongs to the previous user."""
    store, os_, clock, mgr, _ = env
    os_.sessions["student"] = OsSession("c9", "student", clock.wall - 120)
    grant(store, mgr, clock)
    mgr.tick()
    assert store.active_session() is None and store.pending_session() is not None
    clock.advance(PENDING_TIMEOUT + 1)
    mgr.tick()
    assert store.pending_session() is None and "session_started" not in events(store)


def _active(env):
    store, os_, clock, mgr, _ = env
    grant(store, mgr, clock)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall + 1)
    clock.advance(2)
    mgr.tick()
    return store.active_session()


def test_logout_completes_session(env):
    store, os_, clock, mgr, _ = env
    _active(env)
    del os_.sessions["student"]
    mgr.tick()
    assert store.active_session() is None
    assert store.outbox_batch()[-1]["payload"]["end_reason"] == "user_logout"


def test_warning_once_then_forced_logout_at_deadline(env):
    store, os_, clock, mgr, _ = env
    s = _active(env)
    clock.wall = s.expires_at - 200  # inside W = 300 s
    clock.boot = s.boottime_limit - 200
    mgr.tick()
    mgr.tick()
    assert os_.notes == [("student", "Sắp hết giờ")]
    clock.advance(201)
    mgr.tick()
    assert os_.teardowns == ["student"] and store.active_session() is None
    assert store.outbox_batch()[-1]["payload"]["end_reason"] == "schedule_expired"


def test_wall_clock_rollback_cannot_extend_session(env):
    """INV-015 / D-012: CLOCK_BOOTTIME deadline still fires if someone sets the clock back."""
    store, os_, clock, mgr, _ = env
    s = _active(env)
    clock.boot = s.boottime_limit + 1
    clock.wall = s.expires_at - 3 * 3600  # clock moved back three hours
    mgr.tick()
    assert store.active_session() is None and os_.teardowns == ["student"]


def test_stuck_teardown_keeps_session_active(env):
    """INV-017: never mark ended while the user is still in the OS session."""
    store, os_, clock, mgr, _ = env
    s = _active(env)
    os_.stuck = True
    clock.wall, clock.boot = s.expires_at + 1, s.boottime_limit + 1
    mgr.tick()
    assert store.active_session() is not None


@pytest.mark.parametrize("stuck", [False, True])
def test_expired_pending_desktop_is_tracked_until_teardown_succeeds(env, stuck):
    store, os_, clock, mgr, _ = env
    grant(store, mgr, clock)
    pending = store.pending_session()
    clock.advance(2)
    os_.sessions["student"] = OsSession("c12", "student", clock.wall)
    clock.boot = pending.boottime_limit + 1
    os_.stuck = stuck

    mgr.tick()

    assert store.pending_session() is None
    assert os_.teardowns == ["student"]
    if stuck:
        assert store.active_session().session_id == pending.session_id
        os_.stuck = False
        mgr.tick()
    assert store.active_session() is None
    assert os_.gui_session("student") is None
    assert store.outbox_batch()[-1]["payload"]["end_reason"] == "schedule_expired"


class TestReplacement:
    def test_make_room_superseded(self, env):
        store, os_, clock, mgr, _ = env
        _active(env)
        from nfc_agent.domain.model import Decision, Outcome

        assert mgr.make_room(Decision(Outcome.GRANTED, "granted", detail="superseded", replaces="superseded"))
        assert os_.teardowns == ["student"] and store.active_session() is None
        assert store.outbox_batch()[-1]["payload"]["end_reason"] == "superseded"

    def test_make_room_stuck_blocks_new_login(self, env):
        store, os_, clock, mgr, pushed = env
        _active(env)
        os_.stuck = True
        from nfc_agent.domain.model import Decision, Outcome

        assert not mgr.make_room(Decision(Outcome.GRANTED, "granted", replaces="superseded"))
        assert {"event": "teardown_wait"} in pushed and {"event": "teardown_failed"} in pushed
        assert store.outbox_batch()[-1]["payload"]["kind"] == "teardown_failed_stuck_resource"
        assert store.active_session() is not None


class TestRecovery:
    def test_reboot_closes_active_as_reconstructed(self, env):
        store, os_, clock, mgr, _ = env
        s = _active(env)
        grant_pending = store.pending_session()
        assert grant_pending is None
        mgr.recover("boot-2", ("boot-1", s.started_at - 999), ["student"])
        end = store.outbox_batch()[-1]["payload"]
        assert (end["end_reason"], end["end_source"]) == ("workstation_rebooted", "reconstructed")
        assert end["ended_at"] == s.started_at  # max(started_at, last_alive_at)

    def test_agent_restart_with_os_session_gone(self, env):
        store, os_, clock, mgr, _ = env
        _active(env)
        del os_.sessions["student"]
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        assert store.outbox_batch()[-1]["payload"]["end_reason"] == "os_session_lost"

    def test_agent_restart_keeps_live_session(self, env):
        store, os_, clock, mgr, _ = env
        _active(env)
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        assert store.active_session() is not None and os_.teardowns == []

    def test_orphan_os_session_is_ended(self, env):
        """D-017: an OS session with no LocalSession (e.g. edge.db rebuilt) has no deadline, so it is ended."""
        store, os_, clock, mgr, _ = env
        os_.sessions["student"] = OsSession("c30", "student", clock.wall - 50)
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        assert os_.teardowns == ["student"]

    def test_orphan_is_ended_when_liveness_is_missing(self, env):
        """A2: edge.db rebuilt during a running desktop -> previous is None, the desktop must still be ended."""
        store, os_, clock, mgr, _ = env
        os_.sessions["student"] = OsSession("c31", "student", clock.wall - 50)
        mgr.recover("boot-1", None, ["student"])
        assert os_.teardowns == ["student"] and os_.gui_session("student") is None

    def test_orphan_teardown_is_retried_on_tick(self, env):
        store, os_, clock, mgr, _ = env
        os_.sessions["student"] = OsSession("c32", "student", clock.wall - 50)
        os_.stuck = True
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        assert os_.teardowns == ["student"] and os_.gui_session("student") is not None
        os_.stuck = False
        mgr.tick()
        assert os_.gui_session("student") is None
        mgr.tick()
        assert os_.teardowns == ["student", "student"]  # gone: no further attempt

    def test_stale_pending_desktop_is_ended_once(self, env):
        """A desktop older than the pending decision is not promoted; it is ended as an orphan exactly once."""
        store, os_, clock, mgr, _ = env
        grant(store, mgr, clock)
        os_.sessions["student"] = OsSession("c33", "student", clock.wall - 500)
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        assert store.pending_session() is None and store.active_session() is None
        assert os_.teardowns == ["student"]

    def test_tracked_session_is_not_an_orphan(self, env):
        store, os_, clock, mgr, _ = env
        _active(env)
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        mgr.tick()
        assert os_.teardowns == [] and store.active_session() is not None

    def test_agent_has_no_planned_shutdown(self, env):
        """A1: stopping the agent must not end the session (the restarted agent would log the student out)."""
        _, _, _, mgr, _ = env
        assert not hasattr(mgr, "planned_shutdown")

    def test_orphan_retry_never_ends_a_new_desktop_of_the_same_profile(self, env):
        store, os_, clock, mgr, _ = env
        os_.sessions["student"] = OsSession("old", "student", clock.wall - 50)
        os_.stuck = True
        mgr.recover("boot-1", ("boot-1", clock.wall), ["student"])
        os_.stuck = False
        del os_.sessions["student"]  # the old desktop finally exits on its own
        grant(store, mgr, clock)
        clock.advance(2)
        os_.sessions["student"] = OsSession("new", "student", clock.wall)
        mgr.tick()  # promotes "new", then retries orphans
        assert store.active_session().os_session_id == "new"
        assert os_.gui_session("student") is not None
        assert os_.teardowns == ["student"]  # only the first, failed attempt on "old"


def test_extension_shifts_both_deadlines_and_is_audited(env):
    store, os_, clock, mgr, _ = env
    s = _active(env)
    delta = 3600.0
    d = Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at + delta)
    ext = mgr.extension_for(d)
    assert ext is not None
    assert ext.expires_at - s.expires_at == pytest.approx(delta)
    assert ext.boottime_limit - s.boottime_limit == pytest.approx(delta)
    store.record_swipe(d, occurred_at=clock.wall, card_uid=UID, data_version=13, extension=ext)
    active = store.active_session()
    assert active.expires_at == pytest.approx(ext.expires_at)
    assert active.boottime_limit == pytest.approx(ext.boottime_limit)
    last_batch = store.outbox_batch()[-1]
    assert last_batch["event_type"] == "swipe_decision"
    payload = last_batch["payload"]
    assert payload["detail"] == "extended"
    assert payload["session_extension"]["session_id"] == s.session_id


def test_no_extension_when_decision_has_no_deadline(env):
    _, _, _, mgr, _ = env
    _active(env)
    assert mgr.extension_for(Decision(Outcome.NOOP, "already_active")) is None


def test_no_extension_when_not_later(env):
    _, _, _, mgr, _ = env
    s = _active(env)
    assert mgr.extension_for(Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at - 10)) is None
    assert mgr.extension_for(Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at + 30)) is None


def test_clock_set_back_grants_no_extension(env):
    """D-033: with the wall clock set back the effective deadline is earlier; that gap is not an extension."""
    _, _, clock, mgr, _ = env
    s = _active(env)
    clock.advance(3600)
    clock.wall -= 300
    # The schedule did not change: the recomputed end is the stored deadline.
    assert mgr.extension_for(Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at)) is None
    ext = mgr.extension_for(Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at + 1800))
    assert ext.expires_at == pytest.approx(s.expires_at + 1800)
    assert ext.boottime_limit == pytest.approx(s.boottime_limit + 1800)


def test_warning_fires_again_after_extension(env):
    store, os_, clock, mgr, _ = env
    s = _active(env)
    clock.wall = s.expires_at - 240
    clock.boot = s.boottime_limit - 240
    mgr.tick()
    assert os_.notes == [("student", "Sắp hết giờ")]

    d = Decision(Outcome.NOOP, "already_active", expires_at=s.expires_at + 3600)
    ext = mgr.extension_for(d)
    assert ext is not None
    store.record_swipe(d, occurred_at=clock.wall, card_uid=UID, data_version=13, extension=ext)
    mgr.extended(ext)

    clock.wall = ext.expires_at - 240
    clock.boot = ext.boottime_limit - 240
    mgr.tick()
    assert os_.notes == [("student", "Sắp hết giờ"), ("student", "Sắp hết giờ")]


def test_noop_without_extension_payload_unchanged(env):
    store, _, clock, _, _ = env
    store.record_swipe(Decision(Outcome.NOOP, "already_active"), occurred_at=clock.wall, card_uid=UID, data_version=13)
    payload = store.outbox_batch()[-1]["payload"]
    assert payload["detail"] is None
    assert "session_extension" not in payload
