"""What counts as one swipe (BR-007c) and how flaky first contact is handled (S1 follow-up)."""

import sys
from types import SimpleNamespace

import pytest

from nfc_agent.infra.reader import (
    CardSwiped,
    CardUnresponsive,
    PcscBackend,
    ReaderAvailable,
    ReaderMissing,
    ReaderUnavailable,
    SimulatedBackend,
    SwipeDetector,
    SwipeError,
)


class Scripted:
    """Backend replaying a script of wait_change results and read_uid outcomes."""

    def __init__(self, changes, reads=(), present_after_retry=True):
        self.changes = list(changes)
        self.reads = list(reads)
        self.present_after_retry = present_after_retry

    def wait_change(self, timeout_s):
        item = self.changes.pop(0) if self.changes else None
        if isinstance(item, Exception):
            raise item
        return item

    def present(self):
        return self.present_after_retry

    def read_uid(self):
        item = self.reads.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def drain(detector, n):
    return [e for e in (detector.poll(0) for _ in range(n)) if e is not None]


def test_one_event_per_placement_even_if_card_rests():
    b = Scripted([True, None, None, True, False, True], reads=[b"\x1f\x08\x20\xcf", b"\x1f\x08\x20\xcf"])
    assert drain(SwipeDetector(b, sleep=lambda s: None), 6) == [CardSwiped("1F0820CF"), CardSwiped("1F0820CF")]


def test_retry_recovers_flaky_first_contact():
    b = Scripted([True], reads=[CardUnresponsive("x"), CardUnresponsive("x"), b"\x1f\x08\x20\xcf"])
    assert drain(SwipeDetector(b, sleep=lambda s: None), 1) == [CardSwiped("1F0820CF")]


def test_brushing_past_is_not_a_swipe():
    """The card left before the UID could be read: no audit entry, no error on screen."""
    b = Scripted([True], reads=[CardUnresponsive("x")], present_after_retry=False)
    assert drain(SwipeDetector(b, sleep=lambda s: None), 1) == []


def test_persistent_failure_is_reader_error():
    b = Scripted([True], reads=[CardUnresponsive("unresponsive")] * 3)
    (event,) = drain(SwipeDetector(b, sleep=lambda s: None), 1)
    assert isinstance(event, SwipeError) and event.reason == "reader_error"


def test_invalid_uid_length():
    b = Scripted([True], reads=[b"\x01\x02"])
    assert drain(SwipeDetector(b, sleep=lambda s: None), 1) == [SwipeError("invalid_uid", "0102")]


def test_unplugged_reader_reported_once_then_recovers():
    b = Scripted([ReaderMissing("gone"), ReaderMissing("gone"), True], reads=[b"\x1f\x08\x20\xcf"])
    events = drain(SwipeDetector(b, sleep=lambda s: None), 6)
    assert events == [ReaderUnavailable("gone"), ReaderAvailable(), CardSwiped("1F0820CF")]


def test_simulator_drives_the_same_detector():
    sim = SimulatedBackend()
    sim.swipe("04A32B1C5D6E80")
    sim.swipe("1F0820CF")
    events = drain(SwipeDetector(sim, sleep=lambda s: None), 6)
    assert events == [CardSwiped("04A32B1C5D6E80"), CardSwiped("1F0820CF")]


def test_card_gone_after_last_retry_is_not_an_error():
    """Live test: a quick tap used to end as reader_error because presence was read from a stale cache."""

    class GoneAtTheEnd(Scripted):
        def __init__(self):
            super().__init__([True], reads=[CardUnresponsive("x")] * 3)
            self.checks = 0

        def present(self):
            self.checks += 1
            return self.checks < 3

    assert drain(SwipeDetector(GoneAtTheEnd(), sleep=lambda s: None), 1) == []


def test_missing_reader_does_not_spin():
    """Live test: without a device pcscd returns immediately; the detector must wait instead of busy-looping."""
    slept = []
    b = Scripted([ReaderMissing("gone")] * 3)
    drain(SwipeDetector(b, sleep=slept.append), 3)
    assert slept == [0, 0]  # first poll reports, the next two wait (timeout passed to poll)


class FakeScard:
    SCARD_S_SUCCESS = 0
    SCARD_E_NO_SERVICE = 1
    SCARD_E_SERVICE_STOPPED = 2
    SCARD_E_INVALID_HANDLE = 3
    SCARD_E_TIMEOUT = 4
    SCARD_SCOPE_USER = 0
    SCARD_STATE_UNAWARE = 0
    SCARD_STATE_UNKNOWN = 1
    SCARD_STATE_UNAVAILABLE = 2
    SCARD_STATE_CHANGED = 4
    SCARD_STATE_PRESENT = 8
    SCARD_STATE_EMPTY = 16
    SCARD_SHARE_SHARED = 0
    SCARD_PROTOCOL_T0 = 1
    SCARD_PROTOCOL_T1 = 2
    SCARD_PCI_T0 = 1
    SCARD_PCI_T1 = 2
    SCARD_LEAVE_CARD = 0

    def __init__(self):
        self.down = False
        self.contexts = []
        self.released = []
        self.invalid_contexts = {}
        self.connect_error = self.SCARD_S_SUCCESS
        self.card_present = True

    def SCardEstablishContext(self, scope):
        if self.down:
            return self.SCARD_E_NO_SERVICE, None
        ctx = len(self.contexts) + 1
        self.contexts.append(ctx)
        return self.SCARD_S_SUCCESS, ctx

    def SCardReleaseContext(self, ctx):
        self.released.append(ctx)
        return self.invalid_contexts.get(ctx, self.SCARD_S_SUCCESS)

    def SCardGetErrorMessage(self, hr):
        return f"PC/SC error {hr}"

    def SCardListReaders(self, ctx, groups):
        return self.invalid_contexts.get(ctx, self.SCARD_S_SUCCESS), ["reader"]

    def SCardGetStatusChange(self, ctx, timeout, states):
        reader, state = states[0]
        if ctx in self.invalid_contexts:
            return self.invalid_contexts[ctx], []
        current_state = self.SCARD_STATE_PRESENT if self.card_present else self.SCARD_STATE_EMPTY
        if state == current_state:
            return self.SCARD_E_TIMEOUT, []
        return self.SCARD_S_SUCCESS, [(reader, current_state | self.SCARD_STATE_CHANGED, [])]

    def SCardConnect(self, ctx, reader, share, protocols):
        return self.invalid_contexts.get(ctx, self.connect_error), "card", self.SCARD_PROTOCOL_T1

    def SCardTransmit(self, card, pci, command):
        return self.SCARD_S_SUCCESS, [0x1F, 0x08, 0x20, 0xCF, 0x90, 0x00]

    def SCardDisconnect(self, card, disposition):
        return self.SCARD_S_SUCCESS


@pytest.fixture
def pcsc(monkeypatch):
    scard = FakeScard()
    monkeypatch.setitem(sys.modules, "smartcard", SimpleNamespace(scard=scard))
    return PcscBackend(), scard


def test_pcsc_context_is_lazy_and_startup_recovers(monkeypatch):
    scard = FakeScard()
    scard.down = True
    monkeypatch.setitem(sys.modules, "smartcard", SimpleNamespace(scard=scard))
    backend = PcscBackend()
    assert scard.contexts == []
    with pytest.raises(ReaderMissing):
        backend.wait_change(0)
    assert scard.contexts == []
    scard.down = False
    assert backend.wait_change(0) is True


@pytest.mark.parametrize("error", [1, 2, 3])
def test_pcsc_restart_does_not_replay_resting_card(pcsc, error):
    backend, scard = pcsc
    slept = []
    detector = SwipeDetector(backend, sleep=slept.append)
    assert detector.poll(0.5) == CardSwiped("1F0820CF")
    scard.invalid_contexts[1] = error
    scard.down = True
    assert isinstance(detector.poll(0.5), ReaderUnavailable)
    assert detector.poll(0.5) is None
    assert detector.poll(0.5) is None
    assert slept == [0.5, 0.5]
    assert scard.released == [1]
    scard.down = False
    assert drain(detector, 5) == [ReaderAvailable()]
    assert scard.contexts == [1, 2]
    scard.card_present = False
    assert detector.poll(0) is None
    scard.card_present = True
    assert detector.poll(0) == CardSwiped("1F0820CF")
    assert drain(detector, 3) == []


@pytest.mark.parametrize("error", [1, 2, 3])
def test_pcsc_context_lost_during_uid_read_retries_placement(pcsc, error):
    backend, scard = pcsc
    detector = SwipeDetector(backend, sleep=lambda s: None)
    scard.connect_error = error
    assert isinstance(detector.poll(0), ReaderUnavailable)
    assert scard.released == [1]
    scard.connect_error = scard.SCARD_S_SUCCESS
    assert drain(detector, 5) == [ReaderAvailable(), CardSwiped("1F0820CF")]
    assert scard.contexts == [1, 2]


@pytest.mark.parametrize("error", [1, 2, 3])
@pytest.mark.parametrize("operation", ["list", "wait", "present", "connect"])
def test_pcsc_context_errors_drop_context(pcsc, error, operation):
    backend, scard = pcsc
    backend._ensure_context()
    if operation != "list":
        backend.wait_change(0)
    scard.invalid_contexts[1] = error
    call = {
        "list": backend.wait_change,
        "wait": backend.wait_change,
        "present": backend.present,
        "connect": backend.read_uid,
    }[operation]
    with pytest.raises(ReaderMissing):
        call(0) if operation in ("list", "wait") else call()
    assert scard.released == [1]
    assert backend._ctx is None
    assert backend._reader is None
    assert backend._state == scard.SCARD_STATE_UNAWARE
    assert backend.wait_change(0) is True
    assert scard.contexts == [1, 2]


@pytest.mark.parametrize("during_retry", [False, True])
def test_missing_reader_while_reading_is_reported_once(during_retry):
    class MissingDuringRead(Scripted):
        def present(self):
            raise ReaderMissing("gone")

    reads = [CardUnresponsive("retry") if during_retry else ReaderMissing("gone")]
    backend = MissingDuringRead([True, ReaderMissing("gone"), True], reads=reads + [b"\x1f\x08\x20\xcf"])
    assert drain(SwipeDetector(backend, sleep=lambda s: None), 6) == [
        ReaderUnavailable("gone"),
        ReaderAvailable(),
        CardSwiped("1F0820CF"),
    ]


def test_pcsc_missing_optional_error_constants(pcsc, monkeypatch):
    backend, scard = pcsc
    monkeypatch.delattr(FakeScard, "SCARD_E_SERVICE_STOPPED")
    monkeypatch.delattr(FakeScard, "SCARD_E_INVALID_HANDLE")
    assert backend.wait_change(0) is True
    scard.invalid_contexts[1] = scard.SCARD_E_NO_SERVICE
    with pytest.raises(ReaderMissing):
        backend.wait_change(0)
    assert backend.wait_change(0) is True


def test_pcsc_release_exception_does_not_prevent_recovery(pcsc, monkeypatch):
    backend, scard = pcsc
    backend.wait_change(0)
    scard.invalid_contexts[1] = scard.SCARD_E_NO_SERVICE

    def release(ctx):
        raise RuntimeError("context already gone")

    monkeypatch.setattr(scard, "SCardReleaseContext", release)
    with pytest.raises(ReaderMissing):
        backend.wait_change(0)
    assert backend.wait_change(0) is True
