"""Reference implementation of the v1 crypto contract (stdlib only).

Prints contracts/vectors/crypto-v1.json to stdout. Inputs are fixed so the
output is deterministic; edge/ and server/ tests must reproduce every value.
"""

import hashlib
import hmac
import json

KM_SALT = b"nfc-lab-km-v1"


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm, block, counter = b"", b"", 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


def derive_km(master_key: bytes, mqtt_identity: str, key_version: int) -> bytes:
    info = f"{mqtt_identity}:{key_version}".encode()
    return hkdf_sha256(master_key, KM_SALT, info)


def normalize_uid(raw: str) -> str:
    uid = raw.replace(":", "").replace(" ", "").replace("-", "").upper()
    int(uid, 16)  # must be hex
    if len(uid) // 2 not in (4, 7, 10) or len(uid) % 2:
        raise ValueError("UID must be 4, 7 or 10 bytes")
    return uid


def card_match_key(km: bytes, uid: str) -> str:
    return hmac.new(km, b"uid-match-v1" + uid.encode(), hashlib.sha256).hexdigest()


def blind_index(k_index: bytes, uid: str) -> str:
    return hmac.new(k_index, b"uid-index-v1" + uid.encode(), hashlib.sha256).hexdigest()


def sign(km: bytes, tag: str, payload: bytes) -> str:
    return hmac.new(km, tag.encode() + b":" + payload, hashlib.sha256).hexdigest()


def main() -> None:
    master_key = bytes(range(32))
    k_index = bytes(range(32, 64))
    km_cases = [("ws-01", 1), ("ws-01", 2), ("lab-a-07", 1)]
    km = {f"{m}:{v}": derive_km(master_key, m, v) for m, v in km_cases}
    k1 = km["ws-01:1"]

    uids = ["1f:08:20:cf", "04A32B1C5D6E80", "04 11 22 33 44 55 66 77 88 99"]
    payloads = {
        "snapshot-v1": b'{"schema":"snapshot-v1","workstation_id":"ws-01","version":13}',
        "lease-v1": b'{"schema":"lease-v1","workstation_id":"ws-01","desired_version":13,'
        b'"server_time":1793049323.96,"lease_duration_sec":86400,'
        b'"nonce":"c41b0e7a92d35f8816a4e0b2c9d7f351"}',
        "ack-v1": '{"schema":"ack-v1","command":"ack_outbox","workstation_id":"ws-01","acked_seq":103,"note":"tiếng Việt"}'.encode(),
    }

    out = {
        "spec": "crypto-v1",
        "inputs": {"master_key_hex": master_key.hex(), "k_index_hex": k_index.hex(), "km_salt": KM_SALT.decode()},
        "km": [{"mqtt_identity": m, "key_version": v, "km_hex": km[f"{m}:{v}"].hex()} for m, v in km_cases],
        "uid_normalize": [{"raw": r, "normalized": normalize_uid(r)} for r in uids],
        "uid_normalize_invalid": ["1F08", "ZZ0820CF", "1F0820CF00"],
        "card_match_key": [
            {"mqtt_identity": "ws-01", "key_version": 1, "uid": normalize_uid(r), "match_key": card_match_key(k1, normalize_uid(r))}
            for r in uids
        ],
        "blind_index": [{"uid": normalize_uid(r), "index": blind_index(k_index, normalize_uid(r))} for r in uids],
        "signatures": [
            {"mqtt_identity": "ws-01", "key_version": 1, "tag": tag, "payload_hex": p.hex(), "signature": sign(k1, tag, p)}
            for tag, p in payloads.items()
        ],
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
