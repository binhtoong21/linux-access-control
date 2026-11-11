"""Card UID normalization (VR-007, ADR-007, contracts/README.md)."""

_SEPARATORS = str.maketrans("", "", ": -")
_VALID_BYTE_LENGTHS = (4, 7, 10)


class InvalidUid(ValueError):
    """Raised for UIDs that are not 4, 7 or 10 bytes of hex (outcome error/invalid_uid)."""


def normalize_uid(raw: str) -> str:
    """Return uppercase hex without separators; byte order is kept as read from the reader."""
    uid = raw.translate(_SEPARATORS).upper()
    if len(uid) % 2 or len(uid) // 2 not in _VALID_BYTE_LENGTHS:
        raise InvalidUid(f"UID must be 4, 7 or 10 bytes: {raw!r}")
    try:
        int(uid, 16)
    except ValueError as exc:
        raise InvalidUid(f"UID is not hex: {raw!r}") from exc
    return uid


def normalize_uid_bytes(data: bytes) -> str:
    """Normalize the raw byte string returned by the PC/SC GET UID command."""
    return normalize_uid(data.hex())
