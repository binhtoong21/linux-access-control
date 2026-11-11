"""Card reader: what counts as one swipe (BR-007c) on top of PC/SC (S1).

`SwipeDetector` holds the rules and is backend-agnostic; `PcscBackend` talks to pcscd through pyscard; the simulator
feeds UIDs for multi-user test scenarios (only one physical card is available).
"""

from __future__ import annotations

import queue
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Protocol

from ..domain.uid import InvalidUid, normalize_uid_bytes

CONNECT_RETRIES = 3  # S1 follow-up: 3/8 connects failed right after the card touched the field
CONNECT_RETRY_DELAY = 0.1


@dataclass(frozen=True)
class CardSwiped:
    uid: str  # normalized (VR-007)


@dataclass(frozen=True)
class SwipeError:
    reason: str  # "invalid_uid" | "reader_error"
    reader_raw: str | None = None


@dataclass(frozen=True)
class ReaderUnavailable:
    detail: str


ReaderEvent = CardSwiped | SwipeError | ReaderUnavailable


class CardUnresponsive(Exception):
    """Card is in the field but the connection/APDU failed."""


class ReaderMissing(Exception):
    """No reader attached (unplugged) or pcscd unavailable."""


class Backend(Protocol):
    def wait_change(self, timeout_s: float) -> bool | None:
        """Block until the card state changes or timeout. Return True = card present, False = absent, None = timeout.
        Raise ReaderMissing when there is no reader."""

    def present(self) -> bool: ...

    def read_uid(self) -> bytes:
        """GET UID APDU (FF CA 00 00 00). Raise CardUnresponsive on failure."""


class SwipeDetector:
    def __init__(self, backend: Backend, sleep: Callable[[float], None] = time.sleep):
        self._b = backend
        self._sleep = sleep
        self._present = False
        self._reader_ok = True

    def poll(self, timeout_s: float = 1.0) -> ReaderEvent | None:
        """One step: returns at most one event. A card resting on the reader produces exactly one event."""
        try:
            state = self._b.wait_change(timeout_s)
        except ReaderMissing as exc:
            self._present = False
            if self._reader_ok:
                self._reader_ok = False
                return ReaderUnavailable(str(exc))
            self._sleep(timeout_s)  # without a device pcscd returns at once: do not spin (live test on vm2)
            return None
        self._reader_ok = True
        if state is None or state == self._present:
            return None
        self._present = state
        if not state:
            return None  # card removed
        return self._read_new_card()

    def _read_new_card(self) -> ReaderEvent | None:
        last_error: Exception | None = None
        for _ in range(CONNECT_RETRIES):
            try:
                data = self._b.read_uid()
            except CardUnresponsive as exc:
                last_error = exc
                self._sleep(CONNECT_RETRY_DELAY)
                if not self._b.present():
                    self._present = False
                    return None  # brushed past the reader: not a swipe
                continue
            try:
                return CardSwiped(normalize_uid_bytes(data))
            except InvalidUid:
                return SwipeError("invalid_uid", data.hex().upper()[:128])
        return SwipeError("reader_error", str(last_error)[:128] if last_error else None)

    def events(self) -> Iterator[ReaderEvent]:
        while True:
            event = self.poll()
            if event is not None:
                yield event


class SimulatedBackend:
    """Test/demo backend: `swipe(uid_hex)` places a card and removes it again."""

    def __init__(self) -> None:
        self._q: queue.Queue[bytes | None] = queue.Queue()
        self._current: bytes | None = None

    def swipe(self, uid_hex: str) -> None:
        self._q.put(bytes.fromhex(uid_hex.replace(":", "").replace(" ", "")))
        self._q.put(None)

    def wait_change(self, timeout_s: float) -> bool | None:
        try:
            self._current = self._q.get(timeout=timeout_s)
        except queue.Empty:
            return None
        return self._current is not None

    def present(self) -> bool:
        return self._current is not None

    def read_uid(self) -> bytes:
        if self._current is None:
            raise CardUnresponsive("no card")
        return self._current


class PcscBackend:
    """pcscd via pyscard (Ubuntu: python3-pyscard). Uses SCardGetStatusChange, not polling (S1 follow-up)."""

    GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]

    def __init__(self) -> None:
        from smartcard import scard  # imported lazily: only available on the workstation

        self._scard = scard
        hr, self._ctx = scard.SCardEstablishContext(scard.SCARD_SCOPE_USER)
        if hr != scard.SCARD_S_SUCCESS:
            raise ReaderMissing(scard.SCardGetErrorMessage(hr))
        self._reader: str | None = None
        self._state = scard.SCARD_STATE_UNAWARE

    def _ensure_reader(self) -> str:
        if self._reader is None:
            hr, readers = self._scard.SCardListReaders(self._ctx, [])
            if hr != self._scard.SCARD_S_SUCCESS or not readers:
                raise ReaderMissing("no PC/SC reader")
            self._reader, self._state = readers[0], self._scard.SCARD_STATE_UNAWARE
        return self._reader

    def wait_change(self, timeout_s: float) -> bool | None:
        s = self._scard
        reader = self._ensure_reader()
        hr, states = s.SCardGetStatusChange(self._ctx, int(timeout_s * 1000), [(reader, self._state)])
        if hr == s.SCARD_E_TIMEOUT:
            return None
        if hr != s.SCARD_S_SUCCESS:
            self._reader = None
            raise ReaderMissing(s.SCardGetErrorMessage(hr))
        _, event_state, _ = states[0]
        if event_state & (s.SCARD_STATE_UNKNOWN | s.SCARD_STATE_UNAVAILABLE):
            self._reader = None
            raise ReaderMissing("reader removed")
        self._state = event_state & ~s.SCARD_STATE_CHANGED
        return bool(event_state & s.SCARD_STATE_PRESENT)

    def present(self) -> bool:
        """Ask the reader now (zero timeout); the cached state is stale while retrying a connect (live test)."""
        s = self._scard
        hr, states = s.SCardGetStatusChange(self._ctx, 0, [(self._ensure_reader(), s.SCARD_STATE_UNAWARE)])
        if hr != s.SCARD_S_SUCCESS:
            return False
        _, event_state, _ = states[0]
        self._state = event_state & ~s.SCARD_STATE_CHANGED
        return bool(event_state & s.SCARD_STATE_PRESENT)

    def read_uid(self) -> bytes:
        s = self._scard
        hr, card, protocol = s.SCardConnect(
            self._ctx, self._ensure_reader(), s.SCARD_SHARE_SHARED, s.SCARD_PROTOCOL_T0 | s.SCARD_PROTOCOL_T1
        )
        if hr != s.SCARD_S_SUCCESS:
            raise CardUnresponsive(s.SCardGetErrorMessage(hr))
        try:
            pci = s.SCARD_PCI_T0 if protocol == s.SCARD_PROTOCOL_T0 else s.SCARD_PCI_T1
            hr, resp = s.SCardTransmit(card, pci, self.GET_UID)
            if hr != s.SCARD_S_SUCCESS or len(resp) < 2 or resp[-2:] != [0x90, 0x00]:
                raise CardUnresponsive(f"GET UID failed: hr={hr} resp={resp}")
            return bytes(resp[:-2])
        finally:
            s.SCardDisconnect(card, s.SCARD_LEAVE_CARD)
