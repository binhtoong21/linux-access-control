"""Local store edge.db (ADR-003, 07-data §3, migrations.md). All writes are single BEGIN IMMEDIATE transactions."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import date
from enum import Enum
from pathlib import Path

from ..domain.clock import renew
from ..domain.model import Card, Decision, LeaseState, Profile, Schedule, SnapshotView, User
from . import crypto
from .identity import Identity
from .schema import CONNECTION_PRAGMAS, MIGRATIONS

OUTBOX_LIMIT = 50_000  # deployment.md, Bảng Tham Số


class ApplyResult(str, Enum):
    APPLIED = "applied"
    DUPLICATE = "duplicate"  # same version (retained snapshot delivered again): ignore silently
    REJECTED = "rejected"


@dataclass(frozen=True)
class PendingSession:
    session_id: str
    boot_id: str
    boottime_limit: float


@dataclass(frozen=True)
class SessionRow:
    session_id: str
    entry_id: str
    user_id: str
    card_id: str
    os_username: str
    os_session_id: str | None
    boot_id: str
    decided_at: float
    started_at: float | None
    expires_at: float
    boottime_limit: float
    status: str


@dataclass(frozen=True)
class RecoveryReport:
    quarantined_as: str
    salvaged_outbox_entries: int


class OutboxFull(RuntimeError):
    """Swipes are refused rather than losing audit records (swipe-login.md EF-3)."""


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    for pragma in CONNECTION_PRAGMAS:
        conn.execute(pragma)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for target, ddl in enumerate(MIGRATIONS[current:], start=current + 1):
        conn.execute("BEGIN IMMEDIATE")
        try:
            for statement in filter(None, (s.strip() for s in ddl.split(";"))):
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {target}")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def _salvage_outbox(corrupt: Path) -> list[sqlite3.Row]:
    try:
        old = sqlite3.connect(f"file:{corrupt}?mode=ro", uri=True)
        old.row_factory = sqlite3.Row
        rows = old.execute(
            "SELECT entry_id, occurred_at, event_type, payload_json, created_at FROM audit_outbox ORDER BY outbox_seq"
        ).fetchall()
        old.close()
        return rows
    except sqlite3.DatabaseError:
        return []


class Store:
    def __init__(self, conn: sqlite3.Connection, identity: Identity, clock=time.time):
        self._db = conn
        self._identity = identity
        self._clock = clock

    # ------------------------------------------------------------------ open / recovery (D-017)
    @classmethod
    def open(cls, path: Path, identity: Identity, boot_id: str, clock=time.time) -> tuple[Store, RecoveryReport | None]:
        report = None
        if path.exists() and not cls._healthy(path):
            report = cls._quarantine(path, clock())
        conn = _connect(path)
        _migrate(conn)
        store = cls(conn, identity, clock)
        store._sync_agent_meta(boot_id)
        if report:
            store._restore_salvaged(path.with_name(report.quarantined_as))
            store.record_alert("edge_db_recovered", {"salvaged_outbox_entries": report.salvaged_outbox_entries})
        return store, report

    @staticmethod
    def _healthy(path: Path) -> bool:
        try:
            conn = sqlite3.connect(str(path))
            try:
                return conn.execute("PRAGMA quick_check(1)").fetchone()[0] == "ok"
            finally:
                conn.close()
        except sqlite3.DatabaseError:
            return False

    @staticmethod
    def _quarantine(path: Path, now: float) -> RecoveryReport:
        name = f"{path.name}.corrupt.{int(now)}"
        for suffix in ("", "-wal", "-shm"):
            src = path.with_name(path.name + suffix)
            if src.exists():
                src.rename(path.with_name(name + suffix))
        return RecoveryReport(name, len(_salvage_outbox(path.with_name(name))))

    def _restore_salvaged(self, corrupt: Path) -> None:
        rows = _salvage_outbox(corrupt)
        with self._tx():
            for r in rows:
                self._db.execute(
                    "INSERT OR IGNORE INTO audit_outbox (entry_id, occurred_at, event_type, payload_json, created_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (r["entry_id"], r["occurred_at"], r["event_type"], r["payload_json"], r["created_at"]),
                )

    def _sync_agent_meta(self, boot_id: str) -> None:
        """agent_meta mirrors identity/ on every start, never the other way round (D-017)."""
        with self._tx():
            self._db.execute(
                "INSERT INTO agent_meta (id, mqtt_identity, boot_id, local_key_version, updated_at)"
                " VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mqtt_identity = excluded.mqtt_identity,"
                " boot_id = excluded.boot_id, local_key_version = excluded.local_key_version,"
                " updated_at = excluded.updated_at",
                (self._identity.mqtt_identity, boot_id, self._identity.key_version, self._clock()),
            )

    def close(self) -> None:
        self._db.close()

    # ------------------------------------------------------------------ transactions
    class _Tx:
        def __init__(self, db: sqlite3.Connection):
            self.db = db

        def __enter__(self):
            self.db.execute("BEGIN IMMEDIATE")
            return self.db

        def __exit__(self, exc_type, *_):
            self.db.execute("ROLLBACK" if exc_type else "COMMIT")
            return False

    def _tx(self) -> Store._Tx:
        return Store._Tx(self._db)

    def _outbox_insert(self, event_type: str, payload: dict, occurred_at: float, entry_id: str | None = None) -> str:
        entry_id = entry_id or str(uuid.uuid4())
        self._db.execute(
            "INSERT INTO audit_outbox (entry_id, occurred_at, event_type, payload_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (entry_id, occurred_at, event_type, json.dumps(payload, ensure_ascii=False), self._clock()),
        )
        return entry_id

    # ------------------------------------------------------------------ snapshot & lease
    def meta(self) -> sqlite3.Row:
        return self._db.execute("SELECT * FROM snapshot_meta WHERE id = 1").fetchone()

    def lease(self) -> LeaseState:
        m = self.meta()
        return LeaseState(m["version"] > 0, m["trusted_until"], m["last_sync_local_time"])

    def save_lease(self, lease: LeaseState) -> None:
        """Persist policy (ADR-003 §5) is decided by the caller; trusted_until and the floor are written together."""
        with self._tx():
            self._db.execute(
                "UPDATE snapshot_meta SET trusted_until = ?, last_sync_local_time = ? WHERE id = 1",
                (lease.trusted_until, lease.last_sync_local_time),
            )

    def set_apply_error(self, code: str | None) -> None:
        with self._tx():
            self._db.execute("UPDATE snapshot_meta SET last_apply_error = ? WHERE id = 1", (code,))

    def apply_snapshot(self, raw: bytes, signature: str, received_local: float) -> tuple[ApplyResult, str | None]:
        """Verify on raw bytes, then replace every snapshot table and profile flag atomically (ADR-003 §4, INV-011)."""
        if not crypto.verify(self._identity.km, "snapshot-v1", raw, signature):
            with self._tx():
                self._db.execute("UPDATE snapshot_meta SET last_apply_error = 'signature_invalid' WHERE id = 1")
                self._outbox_insert(
                    "security_alert", {"kind": "snapshot_signature_invalid", "detail": None}, received_local
                )
            return ApplyResult.REJECTED, "signature_invalid"
        try:
            snap = json.loads(raw)
            version, key_version = int(snap["version"]), int(snap["key_version"])
            if snap["schema"] != "snapshot-v1" or snap["workstation_id"] != self._identity.mqtt_identity:
                raise ValueError("wrong schema or workstation")
            params = snap["parameters"]
            rows = self._snapshot_rows(snap)
        except (ValueError, KeyError, TypeError):
            self.set_apply_error("schema_invalid")
            return ApplyResult.REJECTED, "schema_invalid"
        current = self.meta()["version"]
        if key_version != self._identity.key_version:
            self.set_apply_error("key_version_mismatch")
            return ApplyResult.REJECTED, "key_version_mismatch"
        if version == current:
            return ApplyResult.DUPLICATE, None
        if version < current:
            self.set_apply_error("older_version")
            return ApplyResult.REJECTED, "older_version"

        lease = renew(self.lease(), received_local, int(params["lease_duration_sec"]))
        users, groups, cards, schedules, profiles = rows
        with self._tx() as db:
            for table in ("snapshot_cards", "snapshot_user_groups", "snapshot_schedules", "snapshot_users"):
                db.execute(f"DELETE FROM {table}")
            db.executemany("INSERT INTO snapshot_users VALUES (?, ?, ?, ?)", users)
            db.executemany("INSERT INTO snapshot_user_groups VALUES (?, ?)", groups)
            db.executemany("INSERT INTO snapshot_cards VALUES (?, ?, ?, ?)", cards)
            db.executemany("INSERT INTO snapshot_schedules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", schedules)
            db.execute("UPDATE local_workstation_profiles SET in_snapshot = 0, status = 'disabled', is_default = 0")
            db.executemany(
                "INSERT INTO local_workstation_profiles (os_username, in_snapshot, status, is_default)"
                " VALUES (?, 1, ?, ?) ON CONFLICT(os_username) DO UPDATE SET in_snapshot = 1,"
                " status = excluded.status, is_default = excluded.is_default",
                profiles,
            )
            db.execute(
                "UPDATE snapshot_meta SET version = ?, key_version = ?, uid_scheme = ?, snapshot_created_at = ?,"
                " received_at = ?, trusted_until = ?, last_sync_local_time = ?, lease_duration_sec = ?,"
                " warning_before_sec = ?, max_session_duration_sec = ?, hmac_signature = ?, last_apply_error = NULL"
                " WHERE id = 1",
                (
                    version,
                    key_version,
                    snap["uid_scheme"],
                    float(snap["created_at"]),
                    received_local,
                    lease.trusted_until,
                    lease.last_sync_local_time,
                    int(params["lease_duration_sec"]),
                    int(params["warning_before_sec"]),
                    int(params["max_session_duration_sec"]),
                    signature.lower(),
                ),
            )
        return ApplyResult.APPLIED, None

    @staticmethod
    def _snapshot_rows(snap: dict):
        users = [(u["id"], u["external_id"], u["full_name"], u["status"]) for u in snap["users"]]
        groups = [(u["id"], g) for u in snap["users"] for g in u["group_ids"]]
        cards = [(c["match_key"], c["card_id"], c["user_id"], c["status"]) for c in snap["cards"]]
        schedules = [
            (
                s["id"],
                s["subject_type"],
                s["subject_id"],
                s["valid_from"],
                s["valid_to"],
                int(s["days_mask"]),
                int(s["start_minute"]),
                int(s["end_minute"]),
                s["target_os_username"],
            )
            for s in snap["schedules"]
        ]
        profiles = [(p["os_username"], p["status"], int(bool(p["is_default"]))) for p in snap["profiles"]]
        return users, groups, cards, schedules, profiles

    def snapshot_view(self) -> SnapshotView | None:
        m = self.meta()
        if m["version"] == 0:
            return None
        db = self._db
        groups: dict[str, set[str]] = {}
        for r in db.execute("SELECT user_id, group_id FROM snapshot_user_groups"):
            groups.setdefault(r["user_id"], set()).add(r["group_id"])
        users = {
            r["user_id"]: User(
                r["user_id"],
                r["external_id"],
                r["full_name"],
                r["status"] == "active",
                frozenset(groups.get(r["user_id"], ())),
            )
            for r in db.execute("SELECT * FROM snapshot_users")
        }
        cards = {
            r["card_match_key"]: Card(r["card_id"], r["user_id"], r["status"] == "active")
            for r in db.execute("SELECT * FROM snapshot_cards")
        }
        schedules = tuple(
            Schedule(
                r["schedule_id"],
                r["subject_type"],
                r["subject_id"],
                date.fromisoformat(r["valid_from"]),
                date.fromisoformat(r["valid_to"]) if r["valid_to"] else None,
                r["days_mask"],
                r["start_minute"],
                r["end_minute"],
                r["target_os_username"],
            )
            for r in db.execute("SELECT * FROM snapshot_schedules")
        )
        profiles = {
            r["os_username"]: Profile(
                r["os_username"], r["status"] == "enabled", bool(r["is_default"]), bool(r["present_locally"])
            )
            for r in db.execute("SELECT * FROM local_workstation_profiles WHERE in_snapshot = 1")
        }
        return SnapshotView(m["version"], users, cards, schedules, profiles, m["max_session_duration_sec"])

    def set_present_profiles(self, names: list[str]) -> None:
        """Auto-Discovery result (D-009): only touches present_locally, never the server-owned flags."""
        with self._tx() as db:
            db.execute("UPDATE local_workstation_profiles SET present_locally = 0")
            db.executemany(
                "INSERT INTO local_workstation_profiles (os_username, present_locally) VALUES (?, 1)"
                " ON CONFLICT(os_username) DO UPDATE SET present_locally = 1",
                [(n,) for n in names],
            )

    # ------------------------------------------------------------------ swipe decisions (D-005, INV-013, INV-014)
    def outbox_count(self) -> int:
        return self._db.execute("SELECT count(*) FROM audit_outbox").fetchone()[0]

    def record_swipe(
        self,
        decision: Decision,
        *,
        occurred_at: float,
        card_uid: str | None,
        reader_raw: str | None = None,
        data_version: int,
        pending: PendingSession | None = None,
    ) -> str:
        """Audit entry and, when granted, the pending LocalSession in ONE transaction, before answering PAM."""
        if self.outbox_count() >= OUTBOX_LIMIT:
            raise OutboxFull()
        if decision.granted and pending is None:
            raise ValueError("granted decision needs a pending session")
        payload = {
            "outcome": decision.outcome.value,
            "reason": decision.reason,
            "detail": decision.detail,
            "card_uid": card_uid,
            "reader_raw": reader_raw,
            "user": None
            if decision.user is None
            else {
                "id": decision.user.id,
                "external_id": decision.user.external_id,
                "full_name": decision.user.full_name,
            },
            "card": None
            if decision.card is None
            else {"id": decision.card.card_id, "status": "active" if decision.card.active else "disabled"},
            "target_os_username": decision.target_os_username,
            "matched_schedule_ids": list(decision.matched_schedule_ids),
            "data_version": data_version,
        }
        with self._tx() as db:
            entry_id = self._outbox_insert("swipe_decision", payload, occurred_at)
            if decision.granted:
                db.execute(
                    "INSERT INTO local_sessions (session_id, entry_id, user_id, card_id, os_username, boot_id,"
                    " decided_at, expires_at, boottime_limit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
                    (
                        pending.session_id,
                        entry_id,
                        decision.user.id,
                        decision.card.card_id,
                        decision.target_os_username,
                        pending.boot_id,
                        occurred_at,
                        decision.expires_at,
                        pending.boottime_limit,
                    ),
                )
        return entry_id

    def record_alert(self, kind: str, detail: dict | None = None) -> None:
        with self._tx():
            self._outbox_insert("security_alert", {"kind": kind, "detail": detail}, self._clock())

    # ------------------------------------------------------------------ sessions (ADR-008, session-expiry.md)
    def _session(self, where: str, *args) -> SessionRow | None:
        r = self._db.execute(f"SELECT * FROM local_sessions WHERE {where}", args).fetchone()
        return None if r is None else SessionRow(*(r[k] for k in SessionRow.__dataclass_fields__))

    def active_session(self) -> SessionRow | None:
        return self._session("status = 'active'")

    def pending_session(self) -> SessionRow | None:
        return self._session("status = 'pending'")

    def activate_session(self, session_id: str, os_session_id: str, started_at: float) -> None:
        with self._tx() as db:
            s = self._session("session_id = ? AND status = 'pending'", session_id)
            if s is None:
                raise LookupError(session_id)
            db.execute(
                "UPDATE local_sessions SET status = 'active', os_session_id = ?, started_at = ? WHERE session_id = ?",
                (os_session_id, started_at, session_id),
            )
            self._outbox_insert(
                "session_started",
                {
                    "session_id": s.session_id,
                    "decision_entry_id": s.entry_id,
                    "user_id": s.user_id,
                    "card_id": s.card_id,
                    "os_username": s.os_username,
                    "boot_id": s.boot_id,
                    "decided_at": s.decided_at,
                    "started_at": started_at,
                    "expires_at": s.expires_at,
                },
                started_at,
            )

    def end_session(self, session_id: str, status: str, end_reason: str, end_source: str, ended_at: float) -> None:
        """Close an active session and report it; ended_at is never before started_at (INV-007)."""
        with self._tx() as db:
            s = self._session("session_id = ? AND status = 'active'", session_id)
            if s is None:
                raise LookupError(session_id)
            ended_at = max(ended_at, s.started_at or s.decided_at)
            db.execute(
                "UPDATE local_sessions SET status = ?, end_reason = ?, end_source = ?, ended_at = ?"
                " WHERE session_id = ?",
                (status, end_reason, end_source, ended_at, session_id),
            )
            self._outbox_insert(
                "session_ended",
                {
                    "session_id": session_id,
                    "status": status,
                    "end_reason": end_reason,
                    "end_source": end_source,
                    "ended_at": ended_at,
                },
                ended_at,
            )

    def discard_pending(self, session_id: str, at: float) -> None:
        """A pending session never reached the OS: internal only, nothing is reported (session-expiry.md)."""
        with self._tx() as db:
            db.execute(
                "UPDATE local_sessions SET status = 'discarded', ended_at = ? WHERE session_id = ?"
                " AND status = 'pending'",
                (at, session_id),
            )

    # ------------------------------------------------------------------ outbox (ADR-002 §5) & liveness
    def outbox_batch(self, limit: int = 50) -> list[dict]:
        rows = self._db.execute("SELECT * FROM audit_outbox ORDER BY outbox_seq LIMIT ?", (limit,)).fetchall()
        return [
            {
                "entry_id": r["entry_id"],
                "outbox_seq": r["outbox_seq"],
                "occurred_at": r["occurred_at"],
                "event_type": r["event_type"],
                "payload": json.loads(r["payload_json"]),
            }
            for r in rows
        ]

    def ack_outbox(self, acked_seq: int) -> int:
        with self._tx() as db:
            return db.execute("DELETE FROM audit_outbox WHERE outbox_seq <= ?", (acked_seq,)).rowcount

    def previous_liveness(self) -> tuple[str, float] | None:
        r = self._db.execute("SELECT boot_id, last_alive_at FROM local_liveness WHERE id = 1").fetchone()
        return None if r is None else (r["boot_id"], r["last_alive_at"])

    def touch_liveness(self, boot_id: str, now: float) -> None:
        with self._tx():
            self._db.execute(
                "INSERT INTO local_liveness (id, boot_id, last_alive_at) VALUES (1, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET boot_id = excluded.boot_id, last_alive_at = excluded.last_alive_at",
                (boot_id, now),
            )
