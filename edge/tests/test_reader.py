"""What counts as one swipe (BR-007c) and how flaky first contact is handled (S1 follow-up)."""

from nfc_agent.infra.reader import (
    CardSwiped,
    CardUnresponsive,
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
    events = drain(SwipeDetector(b, sleep=lambda s: None), 3)
    assert events == [ReaderUnavailable("gone"), CardSwiped("1F0820CF")]


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
