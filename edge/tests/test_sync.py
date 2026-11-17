"""SyncClient: what the agent sends and how it treats what the server sends (ADR-002 §2-§5, D-018, INV-013)."""

import json

import jsonschema
import pytest
from test_store import IDENT, KM, NOW, signed, snapshot_bytes

from nfc_agent.app.sync import Outgoing, SyncClient
from nfc_agent.infra import crypto
from nfc_agent.infra.store import ApplyResult, Store

BOOT = "9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47"
P = "lab/workstation/ws-01/"


class Clock:
    """`now` drives both clocks; `jump` moves only the wall clock (NTP correction, RTC set by hand)."""

    def __init__(self):
        self.now = NOW
        self.jump = 0.0

    def wall(self):
        return self.now + self.jump


@pytest.fixture
def env(tmp_path, contracts_dir):
    clock = Clock()
    store, _ = Store.open(tmp_path / "edge.db", IDENT, BOOT, clock=clock.wall)
    sent: list[Outgoing] = []
    counter = iter(range(10_000))
    batches = iter(range(10_000))
    client = SyncClient(
        store,
        IDENT,
        BOOT,
        publish=lambda m: sent.append(m) or True,
        profiles=lambda: ["student", "labuser"],
        wall=clock.wall,
        monotonic=lambda: clock.now,
        agent_version="1.0.0",
        new_nonce=lambda: f"{next(counter):032x}",
        new_batch_id=lambda: f"batch-{next(batches)}",
    )
    schemas = {
        name: json.loads((contracts_dir / "schemas" / f"{name}.schema.json").read_text(encoding="utf-8"))
        for name in ("hello-v1", "heartbeat-v1", "outbox-v1", "ack-v1")
    }
    yield client, store, clock, sent, schemas
    store.close()


def body(message: Outgoing) -> dict:
    return json.loads(message.payload)


def lease(version=13, nonce="00000000000000000000000000000000", workstation="ws-01", server_time=None, duration=86400):
    raw = json.dumps(
        {
            "schema": "lease-v1",
            "workstation_id": workstation,
            "desired_version": version,
            "server_time": NOW if server_time is None else server_time,
            "lease_duration_sec": duration,
            "nonce": nonce,
        }
    ).encode()
    return raw, crypto.sign(KM, "lease-v1", raw)


def ack(seq, batch_id, workstation="ws-01"):
    raw = json.dumps(
        {
            "schema": "ack-v1",
            "command": "ack_outbox",
            "workstation_id": workstation,
            "batch_id": batch_id,
            "acked_seq": seq,
        }
    ).encode()
    return raw, crypto.sign(KM, "ack-v1", raw)


def test_nothing_is_sent_before_the_connection(env):
    client, _, clock, sent, _ = env
    client.tick()
    client.heartbeat()
    client.push_outbox()
    assert sent == []


def test_hello_on_connect_matches_the_contract(env):
    client, store, _, sent, schemas = env
    store.record_alert("edge_db_recovered", {"lost_outbox_entries": 1})
    client.on_connected()
    hello, batch = sent
    assert (hello.topic, hello.qos, hello.retain) == (P + "hello", 1, False)
    jsonschema.validate(body(hello), schemas["hello-v1"])
    assert body(hello) == {
        "schema": "hello-v1",
        "workstation_id": "ws-01",
        "boot_id": BOOT,
        "agent_version": "1.0.0",
        "snapshot_version": 0,
        "key_version": 2,
        "lease_nonce": "0" * 32,
        "pending_outbox_count": 1,
        "profiles": ["labuser", "student"],
        "local_time": NOW,
    }
    assert batch.topic == P + "outbox"


def test_a_new_snapshot_is_applied_and_answered_with_a_heartbeat_at_once(env):
    client, store, _, sent, schemas = env
    client.on_connected()
    sent.clear()
    assert client.on_message(P + "snapshot", *signed(snapshot_bytes(13))) is None
    assert store.meta()["version"] == 13
    (hb,) = sent
    assert (hb.topic, hb.qos) == (P + "heartbeat", 0)
    jsonschema.validate(body(hb), schemas["heartbeat-v1"])
    assert body(hb) | {"lease_nonce": None} == {
        "schema": "heartbeat-v1",
        "workstation_id": "ws-01",
        "boot_id": BOOT,
        "snapshot_version": 13,
        "lease_nonce": None,
        "trust_state": "Fresh",
        "local_time": NOW,
        "clock_skew_detected": False,
        "last_apply_error": None,
        "active_session_id": None,
        "profiles": ["labuser", "student"],
    }
    # The retained snapshot delivered again on reconnect: no heartbeat, nothing changes.
    assert client.on_snapshot(*signed(snapshot_bytes(13))) is ApplyResult.DUPLICATE
    assert len(sent) == 1


def test_a_snapshot_with_a_bad_or_missing_signature_is_rejected_and_alerted(env):
    client, store, _, sent, _ = env
    client.on_connected()
    raw, _ = signed(snapshot_bytes(13))
    assert client.on_snapshot(raw, "00" * 32) is ApplyResult.REJECTED
    assert client.on_snapshot(raw, None) is ApplyResult.REJECTED
    assert store.meta()["version"] == 0
    kinds = [r["payload"]["kind"] for r in store.outbox_batch() if r["event_type"] == "security_alert"]
    assert kinds == ["snapshot_signature_invalid", "snapshot_signature_invalid"]


def test_a_lease_renews_only_for_our_version_and_a_recent_nonce(env):
    client, store, clock, sent, _ = env
    client.on_snapshot(*signed(snapshot_bytes(13)))
    client.on_connected()  # Hello with nonce 0
    before = store.lease().trusted_until
    clock.now += 600
    for raw, sig in [
        lease(version=12),
        lease(nonce="f" * 32),
        lease(workstation="ws-02"),
        lease(duration=10),
        (lease()[0], "00" * 32),
        (lease()[0], None),
    ]:
        assert client.on_lease(raw, sig) is False
    assert store.lease().trusted_until == before
    assert client.on_lease(*lease()) is True
    assert store.lease().trusted_until == clock.now + 86400
    assert store.lease().last_sync_local_time == clock.now


def test_lease_nonce_dies_on_disconnect_and_is_single_use(env):
    client, store, clock, sent, _ = env
    client.on_snapshot(*signed(snapshot_bytes(13)))
    client.on_connected()
    hello_nonce = body(sent[0])["lease_nonce"]
    before = store.lease().trusted_until

    # Disconnect invalidates the pre-disconnect nonce
    client.on_disconnected()
    client.on_connected()
    reconnect_hello = [m for m in sent if m.topic.endswith("hello")][-1]
    new_nonce = body(reconnect_hello)["lease_nonce"]
    assert new_nonce != hello_nonce

    # A lease answering a nonce sent before a disconnect is rejected after reconnect (and lease on disk unchanged)
    assert client.on_lease(*lease(nonce=hello_nonce)) is False
    assert store.lease().trusted_until == before

    # A lease answering the new Hello's nonce after reconnect is accepted
    clock.now += 600
    assert client.on_lease(*lease(nonce=new_nonce)) is True
    assert store.lease().trusted_until == clock.now + 86400

    # The same signed lease delivered twice renews once (second call returns False)
    assert client.on_lease(*lease(nonce=new_nonce)) is False


def test_a_lease_is_written_to_disk_only_when_it_moved_forward_five_minutes(env):
    client, store, clock, _, _ = env
    client.on_snapshot(*signed(snapshot_bytes(13)))
    client.on_connected()
    stored = store.lease().trusted_until
    clock.now += 30
    assert client.on_lease(*lease()) is True
    assert store.lease().trusted_until == stored
    clock.now += 300
    client.tick()
    assert client.on_lease(*lease(nonce=f"{1:032x}")) is True
    assert store.lease().trusted_until == clock.now + 86400


def test_only_the_last_three_nonces_are_accepted(env):
    client, _, clock, _, _ = env
    client.on_snapshot(*signed(snapshot_bytes(13)))  # heartbeat: nonce 0 is only used when connected
    client.on_connected()  # hello: nonce 0
    for _ in range(3):
        clock.now += 30
        client.tick()  # heartbeats: nonces 1, 2, 3
    assert client.on_lease(*lease(nonce=f"{0:032x}")) is False
    assert client.on_lease(*lease(nonce=f"{1:032x}")) is True
    assert client.on_lease(*lease(nonce=f"{3:032x}")) is True


def test_a_server_clock_far_off_is_reported_in_heartbeats(env):
    client, _, clock, sent, _ = env
    client.on_snapshot(*signed(snapshot_bytes(13)))
    client.on_connected()
    assert client.on_lease(*lease(server_time=NOW + 120)) is True
    clock.now += 30
    client.tick()
    assert body(sent[-1])["clock_skew_detected"] is True
    assert client.on_lease(*lease(nonce=f"{1:032x}", server_time=clock.now + 5)) is True
    clock.now += 30
    client.tick()
    assert body(sent[-1])["clock_skew_detected"] is False


def test_heartbeats_every_thirty_seconds_while_connected(env):
    client, _, clock, sent, _ = env
    client.on_connected()
    client.tick()
    beats = [m for m in sent if m.topic.endswith("heartbeat")]
    assert len(beats) == 1
    clock.now += 29
    client.tick()
    assert len([m for m in sent if m.topic.endswith("heartbeat")]) == 1
    clock.now += 1
    client.tick()
    assert len([m for m in sent if m.topic.endswith("heartbeat")]) == 2
    client.on_disconnected()
    clock.now += 60
    client.tick()
    assert len([m for m in sent if m.topic.endswith("heartbeat")]) == 2


def test_outbox_goes_in_batches_of_fifty_one_at_a_time_and_ack_deletes(env):
    client, store, clock, sent, schemas = env
    for i in range(60):
        store.record_alert("edge_db_recovered", {"lost_outbox_entries": i})
    client.on_connected()
    batches = [m for m in sent if m.topic.endswith("outbox")]
    assert len(batches) == 1
    first = body(batches[0])
    jsonschema.validate(first, schemas["outbox-v1"])
    assert (len(first["records"]), first["from_seq"], first["to_seq"]) == (50, 1, 50)
    assert batches[0].qos == 1
    client.tick()
    assert len([m for m in sent if m.topic.endswith("outbox")]) == 1  # still waiting for the ACK

    bid = first["batch_id"]
    # Unsigned, wrongly signed or foreign ACKs change nothing.
    assert client.on_ack(ack(50, bid)[0], None) == 0
    assert client.on_ack(ack(50, bid)[0], "00" * 32) == 0
    assert client.on_ack(*ack(50, bid, workstation="ws-02")) == 0
    assert store.outbox_count() == 60

    assert client.on_ack(*ack(50, bid)) == 50
    assert store.outbox_count() == 10
    second = body([m for m in sent if m.topic.endswith("outbox")][-1])
    assert (second["from_seq"], second["to_seq"], len(second["records"])) == (51, 60, 10)
    # A repeated old ACK is harmless and does not resend.
    assert client.on_ack(*ack(50, bid)) == 0
    assert len([m for m in sent if m.topic.endswith("outbox")]) == 2
    second_bid = second["batch_id"]
    assert client.on_message(P + "command/ack", *ack(60, second_bid)) is None
    assert store.outbox_count() == 0


def test_a_batch_without_ack_is_sent_again_after_a_minute_and_on_reconnect(env):
    client, store, clock, sent, _ = env
    store.record_alert("edge_db_recovered", None)
    client.on_connected()
    count = lambda: len([m for m in sent if m.topic.endswith("outbox")])  # noqa: E731
    assert count() == 1
    clock.now += 59
    client.tick()
    assert count() == 1
    clock.now += 1
    client.tick()
    assert count() == 2
    client.on_disconnected()
    client.on_connected()
    assert count() == 3


def test_an_outbox_batch_is_signed_and_its_ack_must_name_it(env):
    client, store, clock, sent, schemas = env
    jsonschema.validate(json.loads(ack(1, "b")[0]), schemas["ack-v1"])
    for i in range(3):
        store.record_alert("edge_db_recovered", {"lost_outbox_entries": i})
    client.on_connected()
    out = [m for m in sent if m.topic.endswith("outbox")][-1]
    jsonschema.validate(body(out), schemas["outbox-v1"])
    assert crypto.verify(KM, "outbox-v1", out.payload, out.signature)
    bid = body(out)["batch_id"]
    assert client.on_ack(*ack(3, "batch-other")) == 0
    assert client.on_ack(*ack(10**6, bid)) == 3  # never past the batch in flight
    assert store.outbox_count() == 0


def test_an_ack_from_before_a_reconnect_deletes_nothing(env):
    client, store, clock, sent, _ = env
    store.record_alert("edge_db_recovered", None)
    client.on_connected()
    old = body([m for m in sent if m.topic.endswith("outbox")][-1])["batch_id"]
    client.on_disconnected()
    client.on_connected()  # resent under a new batch_id
    new = body([m for m in sent if m.topic.endswith("outbox")][-1])["batch_id"]
    assert new != old
    assert client.on_ack(*ack(1, old)) == 0 and store.outbox_count() == 1
    assert client.on_ack(*ack(1, new)) == 1


def test_a_failing_publish_never_raises_and_is_retried(env):
    client, store, clock, _, _ = env
    store.record_alert("edge_db_recovered", None)
    attempts = []

    def broken(message):
        attempts.append(message.topic)
        raise OSError("socket closed")

    client._publish = broken
    client.on_connected()
    clock.now += 1
    client.tick()
    assert attempts.count(P + "outbox") == 2  # not marked in flight, so tried again on the next tick


def test_messages_for_other_workstations_or_unknown_topics_are_ignored(env):
    client, store, _, _, _ = env
    client.on_message("lab/workstation/ws-02/snapshot", *signed(snapshot_bytes(13)))
    client.on_message(P + "command/reboot", b"{}", None)
    assert store.meta()["version"] == 0


DAY = 86400.0


def _synced_ahead(env, ahead=3 * DAY):
    """Snapshot applied while the RTC was `ahead` seconds fast, then NTP corrected the clock."""
    client, store, clock, sent, _ = env
    clock.jump = ahead
    client.on_snapshot(*signed(snapshot_bytes(13)))
    clock.jump = 0.0
    return client, store, clock, sent


def test_clock_corrected_backwards_is_reanchored_by_a_fresh_lease(env):
    client, store, clock, sent = _synced_ahead(env)
    from nfc_agent.domain.clock import trust_state
    from nfc_agent.domain.model import TrustState

    assert trust_state(clock.wall(), store.lease()) is TrustState.CLOCK_INVALID
    client.on_connected()
    nonce = body(sent[0])["lease_nonce"]
    assert client.on_lease(*lease(nonce=nonce, server_time=clock.wall())) is True
    assert store.lease().last_sync_local_time == clock.wall()
    assert store.lease().trusted_until == clock.wall() + 86400
    assert trust_state(clock.wall(), store.lease()) is TrustState.FRESH


def test_no_reanchor_when_server_time_disagrees(env):
    client, store, clock, sent = _synced_ahead(env)
    floor = store.lease().last_sync_local_time
    client.on_connected()
    nonce = body(sent[0])["lease_nonce"]
    assert client.on_lease(*lease(nonce=nonce, server_time=clock.wall() + 3 * DAY)) is True
    assert store.lease().last_sync_local_time == floor


def test_no_reanchor_with_an_old_nonce(env):
    client, store, clock, sent = _synced_ahead(env)
    floor = store.lease().last_sync_local_time
    client.on_connected()
    nonce = body(sent[0])["lease_nonce"]
    clock.now += 121  # monotonic age of the nonce > NONCE_MAX_AGE (no tick: still among the kept nonces)
    assert client.on_lease(*lease(nonce=nonce, server_time=clock.wall())) is True
    assert store.lease().last_sync_local_time == floor


def test_a_snapshot_never_lowers_the_floor(env):
    client, store, clock, _ = _synced_ahead(env)
    floor = store.lease().last_sync_local_time
    client.on_snapshot(*signed(snapshot_bytes(14)))
    assert store.lease().last_sync_local_time == floor


def test_heartbeats_continue_after_the_wall_clock_jumps_back(env):
    client, _, clock, sent, _ = env
    client.on_connected()
    client.tick()
    clock.jump = -3 * DAY
    clock.now += 30
    client.tick()
    assert len([m for m in sent if m.topic.endswith("heartbeat")]) == 2
