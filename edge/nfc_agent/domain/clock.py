"""Deployment-local time and trust state (BR-006, BR-012, D-011, D-018).

Asia/Ho_Chi_Minh is fixed UTC+7 with no daylight saving, so a constant offset is exact and avoids depending
on tzdata on the workstation.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .model import LeaseState, TrustState

DEPLOYMENT_TZ = timezone(timedelta(hours=7), "Asia/Ho_Chi_Minh")
CLOCK_FLOOR_TOLERANCE = 60.0  # seconds (deployment.md, Bảng Tham Số)


def local_datetime(now_utc: float) -> datetime:
    return datetime.fromtimestamp(now_utc, DEPLOYMENT_TZ)


def local_midnight_utc(day: date) -> float:
    return datetime(day.year, day.month, day.day, tzinfo=DEPLOYMENT_TZ).timestamp()


def trust_state(now_utc: float, lease: LeaseState) -> TrustState:
    """Clock check before lease check: a clock rolled back below the floor makes `trusted_until` meaningless."""
    if not lease.has_snapshot:
        return TrustState.NO_DATA
    if now_utc < lease.last_sync_local_time - CLOCK_FLOOR_TOLERANCE:
        return TrustState.CLOCK_INVALID
    if now_utc >= lease.trusted_until:
        return TrustState.EXPIRED
    return TrustState.FRESH


STALE_DETAIL = {
    TrustState.NO_DATA: "no_data",
    TrustState.EXPIRED: "lease_expired",
    TrustState.CLOCK_INVALID: "clock_invalid",
}


def renew(lease: LeaseState, received_local: float, lease_duration_sec: int) -> LeaseState:
    """Apply a new snapshot or a valid lease renewal: values only move forward (D-018)."""
    return LeaseState(
        has_snapshot=True,
        trusted_until=max(lease.trusted_until, received_local + lease_duration_sec),
        last_sync_local_time=max(lease.last_sync_local_time, received_local),
    )
