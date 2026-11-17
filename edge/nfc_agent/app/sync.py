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

from ..domain.clock import reanchor, renew, trust_state
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
NONCE_MAX_AGE = 120.0  # D-029: a lease may re-anchor the clock floor only in answer to a nonce this recent (monotonic)


@dataclass(frozen=True)
class Outgoing:
    topic: str
    payload: bytes
    qos: int
    retain: bool = False
    signature: str | None = None  # MQTT 5 user property "signature" (outbox-v1)


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
        monotonic: Callable[[], float] = time.monotonic,
        agent_version: str = "0.1.0",
        new_nonce: Callable[[], str] = lambda: secrets.token_hex(16),
        new_batch_id: Callable[[], str] = lambda: secrets.token_hex(16),
    ):
        self._store = store
        self._id = identity
        self._boot_id = boot_id
        self._publish = publish
        self._profiles = profiles
        self._wall = wall
        self._mono = monotonic
        self._version = agent_version
        self._new_nonce = new_nonce
        self._new_batch_id = new_batch_id
        self._prefix = f"lab/workstation/{identity.mqtt_identity}/"
        self._nonces: deque[tuple[str, float]] = deque(maxlen=NONCES_KEPT)  # (nonce, issued at, monotonic)
        self._connected = False
        self._last_heartbeat = float("-inf")
        self._inflight: tuple[int, float, str] | None = None  # (to_seq, sent at, batch_id)
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
        now = self._mono()
        if now - self._last_heartbeat >= HEARTBEAT_EVERY:
            self.heartbeat()
        if self._inflight is not None and now - self._inflight[1] >= ACK_TIMEOUT:
            log.warning("no ACK for outbox batch up to %d, sending it again", self._inflight[0])
            self._inflight = None
        self.push_outbox()

    # ------------------------------------------------------------------ messages to the server
    def _nonce(self) -> str:
        nonce = self._new_nonce()
        self._nonces.append((nonce, self._mono()))
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
        self._last_heartbeat = self._mono()
        self._send(Outgoing(self._prefix + "heartbeat", _json(body), qos=0))

    def push_outbox(self) -> None:
        """One batch waiting for its ACK at a time, in outbox_seq order (ADR-002 §5)."""
        if not self._connected or self._inflight is not None:
            return
        records = self._store.outbox_batch(BATCH_SIZE)
        if not records:
            return
        first, last = records[0]["outbox_seq"], records[-1]["outbox_seq"]
        batch_id = self._new_batch_id()  # new for every send: an ACK for an older send can never match (D-030)
        body = {
            "schema": "outbox-v1",
            "workstation_id": self._id.mqtt_identity,
            "batch_id": batch_id,
            "from_seq": first,
            "to_seq": last,
            "records": records,
        }
        raw = _json(body)
        message = Outgoing(self._prefix + "outbox", raw, qos=1, signature=crypto.sign(self._id.km, "outbox-v1", raw))
        if self._send(message):
            self._inflight = (last, self._mono(), batch_id)

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
        """D-018: renews only this version, only in answer to one of our own recent nonces. D-029: may re-anchor."""
        body = self._verified("lease-v1", payload, signature)
        if body is None or body.get("schema") != "lease-v1":
            return False
        version = int(self._store.meta()["version"])
        duration = body.get("lease_duration_sec")
        nonce = body.get("nonce")
        issued = next((entry for entry in self._nonces if entry[0] == nonce), None)
        if body.get("desired_version") != version or version < 1 or issued is None:
            return False
        if not isinstance(duration, int) or duration < 60:
            return False
        self._nonces.remove(issued)
        now = self._wall()
        server_time = body.get("server_time")
        in_step = isinstance(server_time, (int, float)) and abs(server_time - now) <= CLOCK_SKEW_WARN
        if isinstance(server_time, (int, float)):
            self._skew = not in_step
        old = self._store.lease()
        fresh = self._mono() - issued[1] <= NONCE_MAX_AGE
        if in_step and fresh and now < old.last_sync_local_time:
            log.warning(
                "clock is %.0f s behind the last sync and agrees with the server: re-anchoring trust (D-029)",
                old.last_sync_local_time - now,
            )
            self._store.save_lease(reanchor(now, duration))
            return True
        new = renew(old, now, duration)
        if new.trusted_until - old.trusted_until >= LEASE_PERSIST_STEP:
            self._store.save_lease(new)
        return True

    def on_ack(self, payload: bytes, signature: str | None) -> int:
        """INV-013 + D-030: only an ACK naming the batch in flight deletes, and never past that batch."""
        body = self._verified("ack-v1", payload, signature)
        if body is None or body.get("command") != "ack_outbox" or not isinstance(body.get("acked_seq"), int):
            return 0
        if self._inflight is None or body.get("batch_id") != self._inflight[2]:
            return 0  # late, replayed or from before a reconnect / an edge.db recovery
        deleted = self._store.ack_outbox(min(body["acked_seq"], self._inflight[0]))
        self._inflight = None
        self.push_outbox()
        return deleted
