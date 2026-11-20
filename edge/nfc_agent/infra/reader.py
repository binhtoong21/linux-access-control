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


@dataclass(frozen=True)
class ReaderAvailable:
    pass


ReaderEvent = CardSwiped | SwipeError | ReaderUnavailable | ReaderAvailable


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
        """GET UID APDU (FF CA 00 00 00). Raise CardUnresponsive or ReaderMissing on failure."""


class SwipeDetector:
    def __init__(self, backend: Backend, sleep: Callable[[float], None] = time.sleep):
        self._b = backend
        self._sleep = sleep
        self._present = False
        self._reader_ok = True
        self._pending_state: bool | None = None

    def poll(self, timeout_s: float = 1.0) -> ReaderEvent | None:
        """One step: returns at most one event. A card resting on the reader produces exactly one event."""
        try:
            if self._pending_state is not None:
                state, self._pending_state = self._pending_state, None
            else:
                state = self._b.wait_change(timeout_s)
            if not self._reader_ok:
                self._reader_ok = True
                # Report recovery first without losing a card already in the field.
                self._pending_state = state
                return ReaderAvailable()
            if state is None or state == self._present:
                return None
            self._present = state
            if not state:
                return None  # card removed
            try:
                return self._read_new_card()
            except ReaderMissing:
                # This placement produced no event; read it again after recovery.
                self._present = False
                raise
        except ReaderMissing as exc:
            if self._reader_ok:
                self._reader_ok = False
                return ReaderUnavailable(str(exc))
            self._sleep(timeout_s)  # without a device pcscd returns at once: do not spin (live test on vm2)
            return None

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
        self._ctx: int | None = None
        self._reader: str | None = None
        self._state = scard.SCARD_STATE_UNAWARE

    def _ensure_context(self) -> None:
        if self._ctx is None:
            s = self._scard
            hr, ctx = s.SCardEstablishContext(s.SCARD_SCOPE_USER)
            if hr != s.SCARD_S_SUCCESS:
                raise ReaderMissing(s.SCardGetErrorMessage(hr))
            self._ctx = ctx

    def _check_context_error(self, hr: int) -> None:
        s = self._scard
        errors = (
            getattr(s, name, None)
            for name in ("SCARD_E_NO_SERVICE", "SCARD_E_SERVICE_STOPPED", "SCARD_E_INVALID_HANDLE")
        )
        if any(error is not None and hr == error for error in errors):
            ctx, self._ctx = self._ctx, None
            self._reader = None
            self._state = s.SCARD_STATE_UNAWARE
            if ctx is not None:
                try:
                    s.SCardReleaseContext(ctx)
                except Exception:
                    pass  # pcscd may already have discarded this context
            raise ReaderMissing(s.SCardGetErrorMessage(hr))

    def _ensure_reader(self) -> str:
        self._ensure_context()
        if self._reader is None:
            hr, readers = self._scard.SCardListReaders(self._ctx, [])
            self._check_context_error(hr)
            if hr != self._scard.SCARD_S_SUCCESS or not readers:
                raise ReaderMissing("no PC/SC reader")
            self._reader, self._state = readers[0], self._scard.SCARD_STATE_UNAWARE
        return self._reader

    def wait_change(self, timeout_s: float) -> bool | None:
        s = self._scard
        reader = self._ensure_reader()
        hr, states = s.SCardGetStatusChange(self._ctx, int(timeout_s * 1000), [(reader, self._state)])
        self._check_context_error(hr)
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
        reader = self._ensure_reader()
        hr, states = s.SCardGetStatusChange(self._ctx, 0, [(reader, s.SCARD_STATE_UNAWARE)])
        self._check_context_error(hr)
        if hr != s.SCARD_S_SUCCESS:
            return False
        _, event_state, _ = states[0]
        self._state = event_state & ~s.SCARD_STATE_CHANGED
        return bool(event_state & s.SCARD_STATE_PRESENT)

    def read_uid(self) -> bytes:
        s = self._scard
        reader = self._ensure_reader()
        hr, card, protocol = s.SCardConnect(
            self._ctx, reader, s.SCARD_SHARE_SHARED, s.SCARD_PROTOCOL_T0 | s.SCARD_PROTOCOL_T1
        )
        self._check_context_error(hr)
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
