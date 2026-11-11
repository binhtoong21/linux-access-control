"""Edge must reproduce every value in contracts/vectors/crypto-v1.json byte for byte."""

import pytest

from nfc_agent.domain.uid import InvalidUid, normalize_uid, normalize_uid_bytes
from nfc_agent.infra import crypto


def _km(vectors: dict, identity: str, version: int) -> bytes:
    case = next(k for k in vectors["km"] if k["mqtt_identity"] == identity and k["key_version"] == version)
    return bytes.fromhex(case["km_hex"])


def test_km_derivation(crypto_vectors):
    master = bytes.fromhex(crypto_vectors["inputs"]["master_key_hex"])
    for case in crypto_vectors["km"]:
        assert crypto.derive_km(master, case["mqtt_identity"], case["key_version"]).hex() == case["km_hex"]


def test_key_version_changes_km(crypto_vectors):
    assert _km(crypto_vectors, "ws-01", 1) != _km(crypto_vectors, "ws-01", 2)


def test_uid_normalization(crypto_vectors):
    for case in crypto_vectors["uid_normalize"]:
        assert normalize_uid(case["raw"]) == case["normalized"]
    for raw in crypto_vectors["uid_normalize_invalid"]:
        with pytest.raises(InvalidUid):
            normalize_uid(raw)


def test_uid_from_reader_bytes():
    assert normalize_uid_bytes(bytes([0x1F, 0x08, 0x20, 0xCF])) == "1F0820CF"


def test_card_match_key(crypto_vectors):
    for case in crypto_vectors["card_match_key"]:
        km = _km(crypto_vectors, case["mqtt_identity"], case["key_version"])
        assert crypto.card_match_key(km, case["uid"]) == case["match_key"]


def test_signatures_and_tamper_detection(crypto_vectors):
    for case in crypto_vectors["signatures"]:
        km = _km(crypto_vectors, case["mqtt_identity"], case["key_version"])
        payload = bytes.fromhex(case["payload_hex"])
        assert crypto.sign(km, case["tag"], payload) == case["signature"]
        assert crypto.verify(km, case["tag"], payload, case["signature"])
        assert not crypto.verify(km, case["tag"], payload + b" ", case["signature"])
        other_tag = next(t for t in crypto.SIGNATURE_TAGS if t != case["tag"])
        assert not crypto.verify(km, other_tag, payload, case["signature"])
