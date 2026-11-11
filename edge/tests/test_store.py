"""edge.db store: snapshot apply rules, atomic write-ahead, sessions, outbox, recovery (ADR-003, D-005, D-017)."""

import json
import sqlite3
from datetime import datetime

import pytest

from nfc_agent.domain.clock import DEPLOYMENT_TZ
from nfc_agent.domain.evaluation import evaluate
from nfc_agent.domain.model import Outcome
from nfc_agent.infra import crypto
from nfc_agent.infra.identity import Identity
from nfc_agent.infra.store import ApplyResult, PendingSession, Store

KM = bytes(range(32))
IDENT = Identity("ws-01", 2, KM)
NOW = datetime(2026, 11, 11, 8, 0, tzinfo=DEPLOYMENT_TZ).timestamp()
U, C, G, S = (
    "6f1c2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b",
    "0b7e4d21-3c4b-4a5d-9e6f-7a8b9c0d1e2f",
    "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d",
    "3a9d5e10-2b4c-4d6e-8f10-1a2b3c4d5e6f",
)
UID = "1F0820CF"


def snapshot_bytes(version=13, key_version=2, workstation="ws-01", card_status="active") -> bytes:
    snap = {
        "schema": "snapshot-v1",
        "workstation_id": workstation,
        "version": version,
        "key_version": key_version,
        "uid_scheme": "hmac-sha256-v1",
        "created_at": NOW - 60,
        "parameters": {"lease_duration_sec": 86400, "warning_before_sec": 300, "max_session_duration_sec": 43200},
        "users": [{"id": U, "external_id": "SV001", "full_name": "Nguyễn Văn A", "status": "active", "group_ids": [G]}],
        "cards": [{"match_key": crypto.card_match_key(KM, UID), "card_id": C, "user_id": U, "status": card_status}],
        "schedules": [
            {
                "id": S,
                "subject_type": "group",
                "subject_id": G,
                "valid_from": "2026-09-01",
                "valid_to": None,
                "days_mask": 127,
                "start_minute": 420,
                "end_minute": 690,
                "target_os_username": None,
            }
        ],
        "profiles": [{"os_username": "student", "status": "enabled", "is_default": True}],
    }
    return json.dumps(snap, ensure_ascii=False).encode()


def signed(raw: bytes) -> tuple[bytes, str]:
    return raw, crypto.sign(KM, "snapshot-v1", raw)


@pytest.fixture
def store(tmp_path):
    s, report = Store.open(tmp_path / "edge.db", IDENT, "boot-1", clock=lambda: NOW)
    assert report is None
    yield s
    s.close()


def test_fresh_store_has_no_data_and_mirrors_identity(store):
    assert not store.lease().has_snapshot and store.snapshot_view() is None
    meta = store._db.execute("SELECT * FROM agent_meta").fetchone()
    assert (meta["mqtt_identity"], meta["local_key_version"], meta["boot_id"]) == ("ws-01", 2, "boot-1")
    assert store._db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert store._db.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL


class TestApplySnapshot:
    def test_applied_then_duplicate_then_older(self, store):
        assert store.apply_snapshot(*signed(snapshot_bytes(13)), NOW) == (ApplyResult.APPLIED, None)
        assert store.apply_snapshot(*signed(snapshot_bytes(13)), NOW + 5) == (ApplyResult.DUPLICATE, None)
        assert store.apply_snapshot(*signed(snapshot_bytes(12)), NOW + 6) == (ApplyResult.REJECTED, "older_version")
        lease = store.lease()
        assert lease.trusted_until == NOW + 86400 and lease.last_sync_local_time == NOW  # duplicate did not renew

    def test_bad_signature_is_rejected_and_alerted(self, store):
        raw, sig = signed(snapshot_bytes())
        result = store.apply_snapshot(raw.replace(b'"active"', b'"inactive"', 1), sig, NOW)
        assert result == (ApplyResult.REJECTED, "signature_invalid")
        assert store.snapshot_view() is None
        alert = store.outbox_batch()[0]
        assert alert["event_type"] == "security_alert" and alert["payload"]["kind"] == "snapshot_signature_invalid"

    def test_key_version_mismatch(self, store):
        assert store.apply_snapshot(*signed(snapshot_bytes(key_version=1)), NOW)[1] == "key_version_mismatch"

    def test_other_workstation(self, store):
        assert store.apply_snapshot(*signed(snapshot_bytes(workstation="ws-02")), NOW)[1] == "schema_invalid"

    def test_profiles_need_local_presence(self, store):
        """D-009: the snapshot enables 'student', but it is unusable until Auto-Discovery saw the account."""
        store.apply_snapshot(*signed(snapshot_bytes()), NOW)
        key = crypto.card_match_key(KM, UID)
        assert evaluate(key, NOW, store.snapshot_view(), store.lease(), None).reason == "profile_not_found"
        store.set_present_profiles(["student"])
        assert evaluate(key, NOW, store.snapshot_view(), store.lease(), None).granted

    def test_discovery_does_not_override_server_flags(self, store):
        store.set_present_profiles(["student", "labuser"])
        store.apply_snapshot(*signed(snapshot_bytes()), NOW)
        store.set_present_profiles(["student", "labuser"])
        profiles = store.snapshot_view().profiles
        assert set(profiles) == {"student"}  # labuser is local only, not in the snapshot
        assert profiles["student"].enabled and profiles["student"].is_default


def _granted(store):
    store.apply_snapshot(*signed(snapshot_bytes()), NOW)
    store.set_present_profiles(["student"])
    key = crypto.card_match_key(KM, UID)
    d = evaluate(key, NOW, store.snapshot_view(), store.lease(), None)
    assert d.outcome is Outcome.GRANTED
    return d


class TestWriteAhead:
    def test_granted_writes_audit_and_pending_together(self, store):
        d = _granted(store)
        entry = store.record_swipe(
            d, occurred_at=NOW, card_uid=UID, data_version=13, pending=PendingSession("sess-1", "boot-1", 1000.0)
        )
        pending = store.pending_session()
        assert pending.entry_id == entry and pending.status == "pending" and pending.expires_at == d.expires_at
        rec = store.outbox_batch()[-1]
        assert rec["event_type"] == "swipe_decision" and rec["payload"]["card_uid"] == UID
        assert rec["payload"]["user"]["external_id"] == "SV001"

    def test_failed_session_insert_rolls_back_audit(self, store):
        """INV-014 + D-005: a second pending session is impossible, and its audit entry must not survive alone."""
        d = _granted(store)
        store.record_swipe(
            d, occurred_at=NOW, card_uid=UID, data_version=13, pending=PendingSession("sess-1", "boot-1", 1000.0)
        )
        before = store.outbox_count()
        with pytest.raises(sqlite3.IntegrityError):
            store.record_swipe(
                d,
                occurred_at=NOW + 1,
                card_uid=UID,
                data_version=13,
                pending=PendingSession("sess-2", "boot-1", 1001.0),
            )
        assert store.outbox_count() == before

    def test_session_lifecycle_reports_events(self, store):
        d = _granted(store)
        store.record_swipe(
            d, occurred_at=NOW, card_uid=UID, data_version=13, pending=PendingSession("sess-1", "boot-1", 1000.0)
        )
        store.activate_session("sess-1", "c12", NOW + 5)
        assert store.active_session().os_session_id == "c12" and store.pending_session() is None
        store.end_session("sess-1", "forced_logout", "schedule_expired", "reported", NOW + 100)
        types = [r["event_type"] for r in store.outbox_batch()]
        assert types[-2:] == ["session_started", "session_ended"]
        assert store.active_session() is None

    def test_reconstructed_end_never_before_start(self, store):
        """reboot.md / INV-007: ended_at = max(started_at, last_alive_at)."""
        d = _granted(store)
        store.record_swipe(
            d, occurred_at=NOW, card_uid=UID, data_version=13, pending=PendingSession("sess-1", "boot-1", 1000.0)
        )
        store.activate_session("sess-1", "c12", NOW + 5)
        store.end_session("sess-1", "abandoned", "workstation_rebooted", "reconstructed", NOW - 300)
        assert store.outbox_batch()[-1]["payload"]["ended_at"] == NOW + 5

    def test_cumulative_ack(self, store):
        store.record_alert("edge_db_recovered", {"n": 1})
        store.record_alert("edge_db_recovered", {"n": 2})
        first, second = store.outbox_batch()
        assert store.ack_outbox(first["outbox_seq"]) == 1
        assert [r["entry_id"] for r in store.outbox_batch()] == [second["entry_id"]]
        assert store.ack_outbox(first["outbox_seq"]) == 0  # replayed ACK is harmless


def test_corrupt_db_is_quarantined_and_identity_restored(tmp_path):
    """D-017: rebuilding edge.db must take key_version from identity/, otherwise every snapshot is rejected."""
    path = tmp_path / "edge.db"
    path.write_bytes(b"this is not a sqlite database" * 100)
    s, report = Store.open(path, IDENT, "boot-9", clock=lambda: NOW)
    try:
        assert report is not None and (tmp_path / report.quarantined_as).exists()
        assert s._db.execute("SELECT local_key_version FROM agent_meta").fetchone()[0] == 2
        assert s.outbox_batch()[0]["payload"]["kind"] == "edge_db_recovered"
        assert s.apply_snapshot(*signed(snapshot_bytes(key_version=2)), NOW)[0] is ApplyResult.APPLIED
    finally:
        s.close()
