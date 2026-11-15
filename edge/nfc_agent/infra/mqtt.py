"""MQTT 5 link to the broker over mTLS (ADR-002 §1-§3, §6). It only carries bytes: SyncClient decides what they mean.

paho runs its own network thread; every callback here only hands work on (the agent enqueues it for its worker thread).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

from .identity import Credentials, Identity

log = logging.getLogger("nfc_agent.mqtt")

KEEPALIVE_SEC = 60
SESSION_EXPIRY_SEC = 3600  # ADR-002 §3: queued QoS 1 messages survive a short outage, not a night switched off
RECONNECT_MIN_SEC = 1  # ADR-002 §6
RECONNECT_MAX_SEC = 60
ONLINE = b'{"status":"online"}'
LAST_WILL = b'{"status":"offline","reason":"connection_lost"}'
SHUTDOWN = b'{"status":"offline","reason":"shutdown"}'


def _client(identity: Identity) -> Any:
    return mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=identity.mqtt_identity,
        protocol=mqtt.MQTTv5,
    )


class MqttLink:
    def __init__(
        self,
        identity: Identity,
        credentials: Credentials,
        ca_file: Path,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[], None],
        on_message: Callable[[str, bytes, str | None], None],
        client_factory: Callable[[Identity], Any] = _client,
    ):
        self._prefix = f"lab/workstation/{identity.mqtt_identity}/"
        self._credentials = credentials
        self._on_connected = on_connected
        self._on_disconnected = on_disconnected
        self._on_message = on_message
        self._connected = False
        client = client_factory(identity)
        # Only the server's CA is trusted and the broker's host name is checked (tls_insecure stays off).
        client.tls_set(ca_certs=str(ca_file), certfile=str(credentials.cert_file), keyfile=str(credentials.key_file))
        client.will_set(self._prefix + "status", LAST_WILL, qos=1, retain=True)
        client.reconnect_delay_set(min_delay=RECONNECT_MIN_SEC, max_delay=RECONNECT_MAX_SEC)
        client.on_connect = self._handle_connect
        client.on_disconnect = self._handle_disconnect
        client.on_message = self._handle_message
        self._client = client

    @property
    def connected(self) -> bool:
        return self._connected

    def start(self) -> None:
        properties = Properties(PacketTypes.CONNECT)
        properties.SessionExpiryInterval = SESSION_EXPIRY_SEC
        self._client.connect_async(
            self._credentials.broker_host,
            self._credentials.broker_port,
            keepalive=KEEPALIVE_SEC,
            clean_start=False,
            properties=properties,
        )
        self._client.loop_start()  # connects, and reconnects with backoff, on paho's thread

    def stop(self) -> None:
        """Planned shutdown: say so (the Last Will is only for connections that break), then disconnect."""
        if self._connected:
            self._client.publish(self._prefix + "status", SHUTDOWN, qos=1, retain=True)
        self._client.disconnect()
        self._client.loop_stop()

    def publish(self, message: Any) -> bool:
        """`message` has topic, payload, qos, retain (sync.Outgoing). False when not connected: nothing is queued."""
        if not self._connected:
            return False
        info = self._client.publish(message.topic, message.payload, qos=message.qos, retain=message.retain)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    # ------------------------------------------------------------------ paho callbacks (paho's thread)
    def _handle_connect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        if reason_code.is_failure:
            log.error("broker refused the connection: %s", reason_code)
            return
        self._connected = True
        log.info("connected to the broker")
        # Subscribe before the Hello goes out: the broker handles packets of one connection in order, so the
        # retained snapshot and the answer to the Hello can never be missed.
        client.subscribe([(self._prefix + "snapshot", 1), (self._prefix + "lease", 1), (self._prefix + "command/#", 1)])
        client.publish(self._prefix + "status", ONLINE, qos=1, retain=True)
        self._on_connected()

    def _handle_disconnect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        was = self._connected
        self._connected = False
        if was:
            log.warning("disconnected from the broker: %s", reason_code)
            self._on_disconnected()

    def _handle_message(self, client: Any, userdata: Any, message: Any) -> None:
        signature = None
        for key, value in getattr(getattr(message, "properties", None), "UserProperty", None) or []:
            if key == "signature":
                signature = value
        self._on_message(message.topic, bytes(message.payload), signature)
