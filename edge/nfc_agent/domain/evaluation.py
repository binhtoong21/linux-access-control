"""CR-001: login evaluation at the workstation (business-rules.md). Pure function, no I/O.

The caller supplies `now` exactly once for the whole evaluation (lease-expiration.md principle 6) and has already
turned the raw UID into a CardMatchKey; reader errors and invalid UIDs never reach this module.
"""

from __future__ import annotations

from datetime import date

from .clock import STALE_DETAIL, local_datetime, local_midnight_utc, trust_state
from .model import CurrentSession, Decision, LeaseState, Outcome, Schedule, SnapshotView, TrustState, User


def _valid_on(s: Schedule, day: date) -> bool:
    return (
        s.valid_from <= day and (s.valid_to is None or day <= s.valid_to) and bool(s.days_mask & (1 << day.weekday()))
    )


def _session_end(now_utc: float, day: date, chain: list[Schedule], max_session_sec: int) -> float:
    """End of the continuous run of windows (same day, same profile) that contains `now`, capped (CR-001 step 7)."""
    midnight = local_midnight_utc(day)
    windows = sorted((midnight + s.start_minute * 60, midnight + s.end_minute * 60) for s in chain)
    end = now_utc
    for start, stop in windows:
        if start <= end:
            end = max(end, stop)
    return min(end, now_utc + max_session_sec)


def evaluate(
    match_key: str,
    now_utc: float,
    snapshot: SnapshotView | None,
    lease: LeaseState,
    current: CurrentSession | None,
) -> Decision:
    # Step 1: data and clock (BR-006, BR-012, D-018)
    trust = trust_state(now_utc, lease)
    if trust is not TrustState.FRESH or snapshot is None:
        detail = STALE_DETAIL.get(trust, "no_data")
        return Decision(Outcome.DENIED, "data_stale", detail)

    # Step 2: card (XINV-002)
    card = snapshot.cards.get(match_key)
    user: User | None = snapshot.users.get(card.user_id) if card else None
    if card is None or user is None:
        return Decision(Outcome.DENIED, "unknown_card")
    if not card.active:
        return Decision(Outcome.DENIED, "card_disabled", user=user, card=card)

    # Step 3: owner (BR-003)
    if not user.active:
        return Decision(Outcome.DENIED, "user_inactive", user=user, card=card)

    # Step 4: schedules for this subject (target is implied: the snapshot only holds this machine's schedules)
    mine = [s for s in snapshot.schedules if s.applies_to(user)]
    if not mine:
        return Decision(Outcome.DENIED, "no_schedule", user=user, card=card)

    # Step 5: time window [start, end) on the local day (D-011)
    local = local_datetime(now_utc)
    day, second_of_day = local.date(), local.hour * 3600 + local.minute * 60 + local.second + local.microsecond / 1e6
    today = [s for s in mine if _valid_on(s, day)]
    active = [s for s in today if s.start_minute * 60 <= second_of_day < s.end_minute * 60]
    if not active:
        return Decision(Outcome.DENIED, "out_of_schedule", user=user, card=card)
    matched = tuple(sorted(s.id for s in active))

    # Step 6: target profile, no ambiguity (BR-016, D-009, INV-018)
    default = snapshot.default_profile
    targets = {s.target_os_username or default for s in active}
    if len(targets) > 1:
        return Decision(Outcome.DENIED, "ambiguous_profile", user=user, card=card, matched_schedule_ids=matched)
    target = targets.pop()
    profile = snapshot.profiles.get(target) if target else None
    if profile is None or not profile.present_locally:
        return Decision(
            Outcome.DENIED,
            "profile_not_found",
            user=user,
            card=card,
            target_os_username=target,
            matched_schedule_ids=matched,
        )
    if not profile.enabled:
        return Decision(
            Outcome.DENIED,
            "profile_disabled",
            user=user,
            card=card,
            target_os_username=target,
            matched_schedule_ids=matched,
        )

    # Step 7: session deadline from the chain of today's windows resolving to the same profile
    chain = [s for s in today if (s.target_os_username or default) == target]
    expires_at = _session_end(now_utc, day, chain, snapshot.max_session_sec)

    # Step 8: current session on the machine (BR-008, D-006.1)
    base = dict(user=user, card=card, target_os_username=target, matched_schedule_ids=matched)
    replaces = None
    if current is not None:
        if now_utc < current.expires_at:
            if current.user_id == user.id:
                return Decision(Outcome.NOOP, "already_active", **base)
            if current.os_session_alive:
                return Decision(Outcome.DENIED, "workstation_busy", **base)
            replaces = "os_session_lost"
        else:
            replaces = "superseded"
    return Decision(Outcome.GRANTED, "granted", detail=replaces, expires_at=expires_at, replaces=replaces, **base)
