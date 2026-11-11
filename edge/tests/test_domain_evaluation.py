"""CR-001 table tests. Each case names the rule it protects (business-rules.md, D-xxx)."""

from datetime import date, datetime

import pytest

from nfc_agent.domain.clock import DEPLOYMENT_TZ
from nfc_agent.domain.evaluation import evaluate
from nfc_agent.domain.model import Card, CurrentSession, LeaseState, Outcome, Profile, Schedule, SnapshotView, User

WED, MON_WED_FRI = 4, 1 | 4 | 16  # 2026-11-11 is a Wednesday


def at(text: str) -> float:
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=DEPLOYMENT_TZ).timestamp()


def sched(sid, subject, start, end, *, kind="group", days=MON_WED_FRI, target=None, valid_to=None):
    sh, sm = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    return Schedule(sid, kind, subject, date(2026, 9, 1), valid_to, days, sh * 60 + sm, eh * 60 + em, target)


ALICE = User("u-alice", "SV001", "Alice", True, frozenset({"g-k20"}))
BOB = User("u-bob", "SV002", "Bob", True, frozenset({"g-k20"}))
CAROL = User("u-carol", "SV003", "Carol", False, frozenset({"g-k20"}))  # inactive
DAVE = User("u-dave", "SV004", "Dave", True, frozenset())  # no schedule

BASE_SCHEDULES = (
    sched("s-morning", "g-k20", "07:30", "09:30"),
    sched("s-late", "g-k20", "09:30", "11:30"),  # contiguous with s-morning -> one chain
    sched("s-afternoon", "g-k20", "13:00", "15:00"),
)


def snapshot(schedules=BASE_SCHEDULES, profiles=None, max_session_sec=12 * 3600):
    profiles = profiles or {
        "student": Profile("student", True, True, True),
        "labuser": Profile("labuser", True, False, True),
    }
    users = {u.id: u for u in (ALICE, BOB, CAROL, DAVE)}
    cards = {
        "mk-alice": Card("c-alice", ALICE.id, True),
        "mk-alice-old": Card("c-alice-old", ALICE.id, False),
        "mk-bob": Card("c-bob", BOB.id, True),
        "mk-carol": Card("c-carol", CAROL.id, True),
        "mk-dave": Card("c-dave", DAVE.id, True),
    }
    return SnapshotView(13, users, cards, tuple(schedules), profiles, max_session_sec)


NOW = at("2026-11-11 08:00")
FRESH = LeaseState(True, NOW + 24 * 3600, NOW - 600)


def run(key="mk-alice", now=NOW, snap=None, lease=FRESH, current=None):
    return evaluate(key, now, snap if snap is not None else snapshot(), lease, current)


@pytest.mark.parametrize(
    ("rule", "kwargs", "reason", "detail"),
    [
        ("BR-006 no snapshot", dict(lease=LeaseState(False, 0, 0)), "data_stale", "no_data"),
        ("BR-006 lease expired", dict(lease=LeaseState(True, NOW - 1, NOW - 3600)), "data_stale", "lease_expired"),
        (
            "D-018 clock rolled back below floor",
            dict(lease=LeaseState(True, NOW + 9e4, NOW + 61)),
            "data_stale",
            "clock_invalid",
        ),
        ("CR-001/2 unknown card", dict(key="mk-nobody"), "unknown_card", None),
        ("BR-002 disabled card", dict(key="mk-alice-old"), "card_disabled", None),
        ("BR-003 inactive user", dict(key="mk-carol"), "user_inactive", None),
        ("CR-001/4 no schedule for subject", dict(key="mk-dave"), "no_schedule", None),
        ("CR-001/5 outside window (lunch)", dict(now=at("2026-11-11 12:00")), "out_of_schedule", None),
        ("D-011 window end is exclusive", dict(now=at("2026-11-11 15:00")), "out_of_schedule", None),
        (
            "CR-001/5 wrong weekday (Tuesday)",
            dict(now=at("2026-11-10 08:00"), lease=LeaseState(True, at("2026-11-11 08:00"), at("2026-11-10 07:50"))),
            "out_of_schedule",
            None,
        ),
    ],
)
def test_denials(rule, kwargs, reason, detail):
    d = run(**kwargs)
    assert d.outcome is Outcome.DENIED, rule
    assert (d.reason, d.detail) == (reason, detail), rule


def test_clock_within_tolerance_is_trusted():
    """D-018: a clock up to 60 s behind the last sync is still fine."""
    assert run(lease=LeaseState(True, NOW + 9e4, NOW + 59)).granted


def test_clock_skew_versus_server_does_not_matter():
    """D-018: the floor uses the workstation's own clock, so a machine running behind the server still works."""
    lease = LeaseState(True, NOW + 24 * 3600, NOW - 5)  # last sync recorded on the (slow) local clock
    assert run(lease=lease).granted


def test_validity_dates():
    expired = sched("s-old", "g-k20", "07:30", "09:30", valid_to=date(2026, 11, 10))
    assert run(snap=snapshot(schedules=(expired,))).reason == "out_of_schedule"


def test_direct_user_schedule():
    """BR-001: subject may be a user, not only a group."""
    only_dave = sched("s-dave", DAVE.id, "07:00", "09:00", kind="user", days=WED)
    d = run(key="mk-dave", snap=snapshot(schedules=BASE_SCHEDULES + (only_dave,)))
    assert d.granted and d.matched_schedule_ids == ("s-dave",)


class TestGranted:
    def test_grant_uses_default_profile(self):
        d = run()
        assert d.granted and d.reason == "granted" and d.target_os_username == "student"
        assert d.matched_schedule_ids == ("s-morning",)

    def test_deadline_follows_contiguous_chain(self):
        """CR-001/7: 07:30-09:30 + 09:30-11:30 is one chain; 13:00 is a gap, so the session ends 11:30."""
        assert run().expires_at == at("2026-11-11 11:30")

    def test_deadline_capped_by_max_session(self):
        assert run(snap=snapshot(max_session_sec=3600)).expires_at == NOW + 3600

    def test_union_of_matching_schedules_same_profile(self):
        """BR-016: several matching schedules with the same profile are fine."""
        dup = sched("s-dup", "g-k20", "07:00", "10:00", target="student")
        d = run(snap=snapshot(schedules=BASE_SCHEDULES + (dup,)))
        assert d.granted and d.matched_schedule_ids == ("s-dup", "s-morning")
        assert d.expires_at == at("2026-11-11 11:30")


class TestProfiles:
    def test_ambiguous_profile(self):
        """BR-016 / D-009.3: two matching schedules pointing to different profiles are refused."""
        other = sched("s-lab", "g-k20", "07:00", "10:00", target="labuser")
        assert run(snap=snapshot(schedules=BASE_SCHEDULES + (other,))).reason == "ambiguous_profile"

    def test_explicit_profile(self):
        lab = sched("s-lab", "g-k20", "07:00", "10:00", target="labuser")
        d = run(snap=snapshot(schedules=(lab,)))
        assert d.granted and d.target_os_username == "labuser"

    def test_disabled_profile(self):
        profiles = {"student": Profile("student", False, True, True)}
        assert run(snap=snapshot(profiles=profiles)).reason == "profile_disabled"

    def test_profile_not_present_locally(self):
        """D-009 / INV-018: a profile is usable only if it also exists on this machine."""
        profiles = {"student": Profile("student", True, True, False)}
        assert run(snap=snapshot(profiles=profiles)).reason == "profile_not_found"

    def test_no_default_profile(self):
        profiles = {"labuser": Profile("labuser", True, False, True)}
        assert run(snap=snapshot(profiles=profiles)).reason == "profile_not_found"


class TestCurrentSession:
    """BR-008 / D-006.1: evaluated only after card, schedule and profile checks pass."""

    def test_same_user_noop(self):
        cur = CurrentSession("sess-1", ALICE.id, at("2026-11-11 11:30"), True)
        d = run(current=cur)
        assert (d.outcome, d.reason) == (Outcome.NOOP, "already_active")

    def test_other_user_busy(self):
        cur = CurrentSession("sess-1", BOB.id, at("2026-11-11 11:30"), True)
        assert run(current=cur).reason == "workstation_busy"

    def test_other_user_os_session_gone(self):
        cur = CurrentSession("sess-1", BOB.id, at("2026-11-11 11:30"), False)
        d = run(current=cur)
        assert d.granted and d.replaces == "os_session_lost"

    def test_previous_session_expired_is_superseded(self):
        cur = CurrentSession("sess-1", BOB.id, NOW - 1, True)
        d = run(current=cur)
        assert d.granted and d.replaces == "superseded"

    def test_busy_machine_still_reports_card_problems_first(self):
        """P1-1: a disabled card is reported as such even if the machine is busy."""
        cur = CurrentSession("sess-1", BOB.id, at("2026-11-11 11:30"), True)
        assert run(key="mk-alice-old", current=cur).reason == "card_disabled"
