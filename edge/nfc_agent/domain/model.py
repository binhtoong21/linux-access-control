"""Domain types for the edge (03-domain/domain-model.md, Edge context). Immutable value objects only."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class Outcome(str, Enum):
    GRANTED = "granted"
    DENIED = "denied"
    NOOP = "noop"
    ERROR = "error"


class TrustState(str, Enum):
    NO_DATA = "NoData"
    FRESH = "Fresh"
    EXPIRED = "Expired"
    CLOCK_INVALID = "ClockInvalid"


@dataclass(frozen=True)
class User:
    id: str
    external_id: str
    full_name: str
    active: bool
    group_ids: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Card:
    card_id: str
    user_id: str
    active: bool  # False = disabled; unbound cards are never in a snapshot


@dataclass(frozen=True)
class Schedule:
    id: str
    subject_type: str  # "user" | "group"
    subject_id: str
    valid_from: date
    valid_to: date | None
    days_mask: int  # Mon=1, Tue=2, ... Sun=64
    start_minute: int  # [start, end) in deployment local time (BR-012)
    end_minute: int
    target_os_username: str | None  # None = workstation default profile

    def applies_to(self, user: User) -> bool:
        if self.subject_type == "user":
            return self.subject_id == user.id
        return self.subject_id in user.group_ids


@dataclass(frozen=True)
class Profile:
    os_username: str
    enabled: bool
    is_default: bool
    present_locally: bool  # Auto-Discovery saw the account on this machine

    @property
    def usable(self) -> bool:
        """INV-018 / D-009: in snapshot (implied by existence here), enabled and really present."""
        return self.enabled and self.present_locally


@dataclass(frozen=True)
class SnapshotView:
    """What CR-001 needs from the current LocalSnapshot."""

    version: int
    users: dict[str, User]
    cards: dict[str, Card]  # keyed by CardMatchKey
    schedules: tuple[Schedule, ...]
    profiles: dict[str, Profile]
    max_session_sec: int

    @property
    def default_profile(self) -> str | None:
        return next((p.os_username for p in self.profiles.values() if p.is_default), None)


@dataclass(frozen=True)
class LeaseState:
    """Persisted trust bookkeeping (snapshot_meta), all on the workstation clock (D-018)."""

    has_snapshot: bool
    trusted_until: float
    last_sync_local_time: float


@dataclass(frozen=True)
class CurrentSession:
    """The LocalSession `active` on this machine, if any, plus whether logind still sees its GUI session."""

    session_id: str
    user_id: str
    expires_at: float
    os_session_alive: bool


@dataclass(frozen=True)
class Decision:
    """LoginDecision (domain-model.md). `replaces` tells the session layer what to do with the old session."""

    outcome: Outcome
    reason: str
    detail: str | None = None
    user: User | None = None
    card: Card | None = None
    target_os_username: str | None = None
    matched_schedule_ids: tuple[str, ...] = field(default_factory=tuple)
    expires_at: float | None = None
    replaces: str | None = None  # "superseded" | "os_session_lost" | None

    @property
    def granted(self) -> bool:
        return self.outcome is Outcome.GRANTED
