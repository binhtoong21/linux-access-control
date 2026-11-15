"""Agent side of the MQTT protocol (ADR-002 §2-§5, events.md §3-§4): bytes in, messages out, no MQTT library.

Order of priorities (reconnect.md): get back to accepting cards first (Hello -> lease or snapshot), push the log after.
Every message from the server is checked on its raw bytes with K_m before anything is parsed (ADR-003 §4).
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from ..domain.clock import renew, trust_state
from ..infra import crypto
from ..infra.identity import Identity
from ..infra.store import ApplyResult, Store

log = logging.getLogger("nfc_agent.sync")

HEARTBEAT_EVERY = 30.0  # ADR-002
ACK_TIMEOUT = 60.0  # resend the batch in flight after this long without an ACK
BATCH_SIZE = 50  # ADR-002 §5
NONCES_KEPT = 3  # D-018
CLOCK_SKEW_WARN = 60.0  # deployment.md "Bảng Tham Số" (warning only)
LEASE_PERSIST_STEP = 300.0  # ADR-003 §5: write the lease when trusted_until moved forward by >= 5 minutes


@dataclass(frozen=True)
class Outgoing:
    topic: str
    payload: bytes
    qos: int
    retain: bool = False


def _json(body: dict) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()


class SyncClient:
    """Not thread-safe: the agent calls it from its single worker thread, like every other use of the store."""

    def __init__(
        self,
        store: Store,
        identity: Identity,
        boot_id: str,
        publish: Callable[[Outgoing], bool],
        profiles: Callable[[], list[str]],
        wall: Callable[[], float] = time.time,
        agent_version: str = "0.1.0",
        new_nonce: Callable[[], str] = lambda: secrets.token_hex(16),
    ):
        self._store = store
        self._id = identity
        self._boot_id = boot_id
        self._publish = publish
        self._profiles = profiles
        self._wall = wall
        self._version = agent_version
        self._new_nonce = new_nonce
        self._prefix = f"lab/workstation/{identity.mqtt_identity}/"
        self._nonces: deque[str] = deque(maxlen=NONCES_KEPT)
        self._connected = False
        self._last_heartbeat = float("-inf")
        self._inflight: tuple[int, float] | None = None  # (to_seq, sent at)
        self._skew = False

    # ------------------------------------------------------------------ connection
    @property
    def connected(self) -> bool:
        return self._connected

    def on_connected(self) -> None:
        self._nonces.clear()
        self._connected = True
        self._inflight = None  # whatever was in flight is resent: the server drops duplicates (XINV-006)
        self._send(Outgoing(self._prefix + "hello", _json(self._hello()), qos=1))
        self.push_outbox()

    def on_disconnected(self) -> None:
        self._connected = False
        self._inflight = None
        self._nonces.clear()

    def tick(self) -> None:
        if not self._connected:
            return
        now = self._wall()
        if now - self._last_heartbeat >= HEARTBEAT_EVERY:
            self.heartbeat()
        if self._inflight is not None and now - self._inflight[1] >= ACK_TIMEOUT:
            log.warning("no ACK for outbox batch up to %d, sending it again", self._inflight[0])
            self._inflight = None
        self.push_outbox()

    # ------------------------------------------------------------------ messages to the server
    def _nonce(self) -> str:
        nonce = self._new_nonce()
        self._nonces.append(nonce)
        return nonce

    def _send(self, message: Outgoing) -> bool:
        try:
            return bool(self._publish(message))
        except Exception:  # a broken link must never break the agent's worker thread
            log.exception("publish to %s failed", message.topic)
            return False

    def _hello(self) -> dict:
        return {
            "schema": "hello-v1",
            "workstation_id": self._id.mqtt_identity,
            "boot_id": self._boot_id,
            "agent_version": self._version,
            "snapshot_version": int(self._store.meta()["version"]),
            "key_version": self._id.key_version,
            "lease_nonce": self._nonce(),
            "pending_outbox_count": self._store.outbox_count(),
            "profiles": sorted(self._profiles()),
            "local_time": self._wall(),
        }

    def heartbeat(self) -> None:
        if not self._connected:
            return
        meta = self._store.meta()
        now = self._wall()
        active = self._store.active_session()
        body = {
            "schema": "heartbeat-v1",
            "workstation_id": self._id.mqtt_identity,
            "boot_id": self._boot_id,
            "snapshot_version": int(meta["version"]),
            "lease_nonce": self._nonce(),
            "trust_state": trust_state(now, self._store.lease()).value,
            "local_time": now,
            "clock_skew_detected": self._skew,
            "last_apply_error": meta["last_apply_error"],
            "active_session_id": active.session_id if active else None,
            "profiles": sorted(self._profiles()),
        }
        self._last_heartbeat = now
        self._send(Outgoing(self._prefix + "heartbeat", _json(body), qos=0))

    def push_outbox(self) -> None:
        """One batch waiting for its ACK at a time, in outbox_seq order (ADR-002 §5)."""
        if not self._connected or self._inflight is not None:
            return
        records = self._store.outbox_batch(BATCH_SIZE)
        if not records:
            return
        first, last = records[0]["outbox_seq"], records[-1]["outbox_seq"]
        body = {
            "schema": "outbox-v1",
            "workstation_id": self._id.mqtt_identity,
            "batch_id": f"b-{first}-{last}",
            "from_seq": first,
            "to_seq": last,
            "records": records,
        }
        if self._send(Outgoing(self._prefix + "outbox", _json(body), qos=1)):
            self._inflight = (last, self._wall())

    # ------------------------------------------------------------------ messages from the server
    def on_message(self, topic: str, payload: bytes, signature: str | None) -> None:
        if not topic.startswith(self._prefix):
            return
        leaf = topic[len(self._prefix) :]
        if leaf == "snapshot":
            self.on_snapshot(payload, signature)
        elif leaf == "lease":
            self.on_lease(payload, signature)
        elif leaf == "command/ack":
            self.on_ack(payload, signature)

    def on_snapshot(self, payload: bytes, signature: str | None) -> ApplyResult:
        result, error = self._store.apply_snapshot(payload, signature or "", self._wall())
        if result is ApplyResult.APPLIED:
            log.info("snapshot v%d applied", self._store.meta()["version"])
            self.heartbeat()  # tells the server at once (replaces SnapshotApplied)
        elif result is ApplyResult.REJECTED:
            log.warning("snapshot rejected: %s", error)
        return result

    def _verified(self, tag: str, payload: bytes, signature: str | None) -> dict | None:
        if not signature or not crypto.verify(self._id.km, tag, payload, signature):
            log.warning("%s with a missing or wrong signature ignored", tag)
            return None
        try:
            body = json.loads(payload)
        except ValueError:
            return None
        if not isinstance(body, dict) or body.get("workstation_id") != self._id.mqtt_identity:
            return None
        return body

    def on_lease(self, payload: bytes, signature: str | None) -> bool:
        """D-018: renews only this version, only in answer to one of our own recent nonces."""
        body = self._verified("lease-v1", payload, signature)
        if body is None or body.get("schema") != "lease-v1":
            return False
        version = int(self._store.meta()["version"])
        duration = body.get("lease_duration_sec")
        nonce = body.get("nonce")
        if body.get("desired_version") != version or version < 1 or nonce not in self._nonces:
            return False
        if not isinstance(duration, int) or duration < 60:
            return False
        self._nonces.remove(nonce)
        now = self._wall()
        server_time = body.get("server_time")
        if isinstance(server_time, (int, float)):
            self._skew = abs(server_time - now) > CLOCK_SKEW_WARN
        old = self._store.lease()
        new = renew(old, now, duration)
        if new.trusted_until - old.trusted_until >= LEASE_PERSIST_STEP:
            self._store.save_lease(new)
        return True

    def on_ack(self, payload: bytes, signature: str | None) -> int:
        """INV-013: deletes up to acked_seq. Returns how many records were deleted."""
        body = self._verified("ack-v1", payload, signature)
        if body is None or body.get("command") != "ack_outbox" or not isinstance(body.get("acked_seq"), int):
            return 0
        acked = body["acked_seq"]
        deleted = self._store.ack_outbox(acked)
        if self._inflight is not None and acked >= self._inflight[0]:
            self._inflight = None
        self.push_outbox()
        return deleted
