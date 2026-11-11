"""Trust state and lease renewal (BR-006, D-018)."""

from nfc_agent.domain.clock import local_datetime, renew, trust_state
from nfc_agent.domain.model import LeaseState, TrustState

T = 1_793_049_300.0


def test_deployment_time_is_utc_plus_7():
    assert local_datetime(0).hour == 7


def test_states():
    assert trust_state(T, LeaseState(False, 0, 0)) is TrustState.NO_DATA
    assert trust_state(T, LeaseState(True, T + 10, T)) is TrustState.FRESH
    assert trust_state(T, LeaseState(True, T, T - 100)) is TrustState.EXPIRED
    assert trust_state(T, LeaseState(True, T + 10, T + 61)) is TrustState.CLOCK_INVALID


def test_renew_moves_forward_only():
    lease = LeaseState(True, T + 86_400, T)
    later = renew(lease, T + 30, 86_400)
    assert later.trusted_until == T + 30 + 86_400 and later.last_sync_local_time == T + 30
    # a renewal received with an earlier local clock (e.g. NTP stepped back) never shortens anything
    earlier = renew(later, T - 500, 86_400)
    assert earlier == later


def test_first_snapshot_starts_lease():
    lease = renew(LeaseState(False, 0, 0), T, 3600)
    assert lease.has_snapshot and trust_state(T + 10, lease) is TrustState.FRESH
