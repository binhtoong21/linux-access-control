"""Crypto contract v1 (contracts/README.md). Stdlib only, byte-exact with server/."""

import hashlib
import hmac

KM_SALT = b"nfc-lab-km-v1"
SIGNATURE_TAGS = ("snapshot-v1", "lease-v1", "ack-v1")


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    """RFC 5869 HKDF with SHA-256."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm, block, counter = b"", b"", 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


def derive_km(master_key: bytes, mqtt_identity: str, key_version: int) -> bytes:
    """Per-workstation key K_m (ADR-007). The agent receives K_m at enrollment; derivation lives here for tests."""
    return hkdf_sha256(master_key, KM_SALT, f"{mqtt_identity}:{key_version}".encode())


def card_match_key(km: bytes, normalized_uid: str) -> str:
    """CardMatchKey looked up in snapshot_cards (CR-001 step 2)."""
    return hmac.new(km, b"uid-match-v1" + normalized_uid.encode("ascii"), hashlib.sha256).hexdigest()


def sign(km: bytes, tag: str, payload: bytes) -> str:
    if tag not in SIGNATURE_TAGS:
        raise ValueError(f"unknown signature tag {tag!r}")
    return hmac.new(km, tag.encode() + b":" + payload, hashlib.sha256).hexdigest()


def verify(km: bytes, tag: str, payload: bytes, signature: str) -> bool:
    """Verify on the raw received bytes, before any JSON parsing (ADR-003 §4)."""
    return hmac.compare_digest(sign(km, tag, payload), signature.lower())
