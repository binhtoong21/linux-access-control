"""Dev/offline provisioning until the server exists (M2/M3): writes identity/ and a signed snapshot.

Uses the agent's own crypto module, so the snapshot goes through the real signature check.
  sudo python3 -m tools.dev_provision --ws ws-dev-01 --card 1F0820CF --sim-card 04A32B1C5D6E80 --out /tmp/demo
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from pathlib import Path

from nfc_agent.domain.uid import normalize_uid
from nfc_agent.infra import crypto
from nfc_agent.infra.identity import Identity, write_identity

DEV_MASTER_KEY = bytes.fromhex("6465762d6f6e6c792d6d61737465722d6b65792d6e6f742d666f722d70726f64")  # dev only


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ws", default="ws-dev-01")
    p.add_argument("--key-version", type=int, default=1)
    p.add_argument("--card", required=True, help="real card UID (user 1)")
    p.add_argument("--sim-card", default="04A32B1C5D6E80", help="simulated card UID (user 2)")
    p.add_argument("--start", default="00:00")
    p.add_argument("--end", default="24:00")
    p.add_argument("--version", type=int, default=int(time.time()))
    p.add_argument("--identity-dir", type=Path)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()

    km = crypto.derive_km(DEV_MASTER_KEY, a.ws, a.key_version)
    if a.identity_dir:
        write_identity(a.identity_dir, Identity(a.ws, a.key_version, km))
    group = str(uuid.uuid5(uuid.NAMESPACE_DNS, "group.dev"))
    users = [
        {
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "user.sv001")),
            "external_id": "SV001",
            "full_name": "Sinh viên Thẻ Thật",
            "status": "active",
            "group_ids": [group],
        },
        {
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "user.sv002")),
            "external_id": "SV002",
            "full_name": "Sinh viên Giả Lập",
            "status": "active",
            "group_ids": [group],
        },
    ]
    cards = [
        {
            "match_key": crypto.card_match_key(km, normalize_uid(uid)),
            "card_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, uid)),
            "user_id": user["id"],
            "status": "active",
        }
        for uid, user in ((a.card, users[0]), (a.sim_card, users[1]))
    ]
    to_min = lambda hm: int(hm.split(":")[0]) * 60 + int(hm.split(":")[1])  # noqa: E731
    snap = {
        "schema": "snapshot-v1",
        "workstation_id": a.ws,
        "version": a.version,
        "key_version": a.key_version,
        "uid_scheme": "hmac-sha256-v1",
        "created_at": time.time(),
        "parameters": {"lease_duration_sec": 86400, "warning_before_sec": 300, "max_session_duration_sec": 43200},
        "users": users,
        "cards": cards,
        "schedules": [
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "sched.dev")),
                "subject_type": "group",
                "subject_id": group,
                "valid_from": "2026-01-01",
                "valid_to": None,
                "days_mask": 127,
                "start_minute": to_min(a.start),
                "end_minute": to_min(a.end),
                "target_os_username": None,
            }
        ],
        "profiles": [{"os_username": "student", "status": "enabled", "is_default": True}],
    }
    raw = json.dumps(snap, ensure_ascii=False, separators=(",", ":")).encode()
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_bytes(raw)
    Path(str(a.out) + ".sig").write_text(crypto.sign(km, "snapshot-v1", raw))
    print(f"snapshot v{a.version} for {a.ws} -> {a.out} (+ .sig)")


if __name__ == "__main__":
    main()
