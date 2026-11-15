"""MqttLink with a fake paho client: connection options, subscribe-before-Hello, user property, no queueing offline."""

from types import SimpleNamespace

import pytest

from nfc_agent.infra import mqtt as link_module
from nfc_agent.infra.identity import Credentials, Identity
from nfc_agent.infra.mqtt import MqttLink

IDENT = Identity("ws-07", 2, bytes(32))
P = "lab/workstation/ws-07/"


class FakeClient:
    def __init__(self):
        self.calls = []
        self.published = []
        self.rc = 0

    def tls_set(self, **kw):
        self.calls.append(("tls_set", kw))

    def will_set(self, topic, payload, qos, retain):
        self.calls.append(("will_set", topic, payload, qos, retain))

    def reconnect_delay_set(self, min_delay, max_delay):
        self.calls.append(("reconnect_delay_set", min_delay, max_delay))

    def connect_async(self, host, port, keepalive, clean_start, properties):
        self.calls.append(("connect_async", host, port, keepalive, clean_start, properties.SessionExpiryInterval))

    def loop_start(self):
        self.calls.append(("loop_start",))

    def loop_stop(self):
        self.calls.append(("loop_stop",))

    def disconnect(self):
        self.calls.append(("disconnect",))

    def subscribe(self, topics):
        self.calls.append(("subscribe", topics))

    def publish(self, topic, payload, qos, retain):
        self.published.append((topic, payload, qos, retain))
        return SimpleNamespace(rc=self.rc)


@pytest.fixture
def env(tmp_path):
    fake = FakeClient()
    events = []
    creds = Credentials(tmp_path / "client.crt", tmp_path / "client.key", "lab-server", 8883)
    link = MqttLink(
        IDENT,
        creds,
        tmp_path / "ca.pem",
        on_connected=lambda: events.append(("connected", list(fake.calls))),
        on_disconnected=lambda: events.append(("disconnected",)),
        on_message=lambda topic, payload, sig: events.append(("message", topic, payload, sig)),
        client_factory=lambda identity: fake,
    )
    return link, fake, events, tmp_path


OK = SimpleNamespace(is_failure=False)
REFUSED = SimpleNamespace(is_failure=True)


def test_connects_with_mtls_last_will_and_a_persistent_one_hour_session(env):
    link, fake, _, tmp = env
    link.start()
    names = [c[0] for c in fake.calls]
    assert names == ["tls_set", "will_set", "reconnect_delay_set", "connect_async", "loop_start"]
    assert fake.calls[0][1] == {
        "ca_certs": str(tmp / "ca.pem"),
        "certfile": str(tmp / "client.crt"),
        "keyfile": str(tmp / "client.key"),
    }
    assert fake.calls[1] == ("will_set", P + "status", link_module.LAST_WILL, 1, True)
    assert fake.calls[2] == ("reconnect_delay_set", 1, 60)
    assert fake.calls[3] == ("connect_async", "lab-server", 8883, 60, False, 3600)


def test_on_connect_subscribes_and_announces_online_before_reporting(env):
    link, fake, events, _ = env
    assert link.publish(SimpleNamespace(topic=P + "hello", payload=b"{}", qos=1, retain=False)) is False
    assert fake.published == []
    link._handle_connect(fake, None, None, OK, None)
    assert link.connected
    ((_, calls_at_report),) = events
    assert ("subscribe", [(P + "snapshot", 1), (P + "lease", 1), (P + "command/#", 1)]) in calls_at_report
    assert fake.published == [(P + "status", link_module.ONLINE, 1, True)]
    assert link.publish(SimpleNamespace(topic=P + "hello", payload=b"{}", qos=1, retain=False)) is True
    fake.rc = 4
    assert link.publish(SimpleNamespace(topic=P + "heartbeat", payload=b"{}", qos=0, retain=False)) is False


def test_a_refused_connection_is_not_reported(env):
    link, fake, events, _ = env
    link._handle_connect(fake, None, None, REFUSED, None)
    assert not link.connected and events == [] and fake.published == []


def test_disconnect_is_reported_once(env):
    link, fake, events, _ = env
    link._handle_connect(fake, None, None, OK, None)
    link._handle_disconnect(fake, None, None, OK, None)
    link._handle_disconnect(fake, None, None, OK, None)
    assert [e[0] for e in events] == ["connected", "disconnected"]
    assert not link.connected


def test_messages_carry_the_signature_user_property(env):
    link, _, events, _ = env
    signed = SimpleNamespace(
        topic=P + "lease",
        payload=b"raw",
        properties=SimpleNamespace(UserProperty=[("x", "1"), ("signature", "ab" * 32)]),
    )
    unsigned = SimpleNamespace(
        topic=P + "snapshot", payload=bytearray(b"raw2"), properties=SimpleNamespace(UserProperty=None)
    )
    bare = SimpleNamespace(topic=P + "command/ack", payload=b"raw3")
    for message in (signed, unsigned, bare):
        link._handle_message(None, None, message)
    assert events == [
        ("message", P + "lease", b"raw", "ab" * 32),
        ("message", P + "snapshot", b"raw2", None),
        ("message", P + "command/ack", b"raw3", None),
    ]


def test_stop_says_shutdown_when_connected(env):
    link, fake, _, _ = env
    link._handle_connect(fake, None, None, OK, None)
    fake.published.clear()
    link.stop()
    assert fake.published == [(P + "status", link_module.SHUTDOWN, 1, True)]
    assert [c[0] for c in fake.calls][-2:] == ["disconnect", "loop_stop"]


def test_the_real_paho_client_accepts_these_options(tmp_path):
    client = link_module._client(IDENT)
    assert client._client_id == b"ws-07"
    assert client._protocol == link_module.mqtt.MQTTv5
