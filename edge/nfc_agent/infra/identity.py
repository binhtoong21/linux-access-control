"""Workstation identity (/var/lib/nfc-agent/identity/), the source of truth outside edge.db (D-017, ADR-003 §1)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

IDENTITY_FILE = "identity.json"


@dataclass(frozen=True)
class Identity:
    mqtt_identity: str
    key_version: int
    km: bytes

    def __repr__(self) -> str:  # never print K_m
        return f"Identity(mqtt_identity={self.mqtt_identity!r}, key_version={self.key_version})"


class IdentityMissing(RuntimeError):
    """The machine is not enrolled (or identity/ was lost): run enrollment / `nfc-agent reenroll`."""


def load_identity(identity_dir: Path) -> Identity:
    path = identity_dir / IDENTITY_FILE
    if not path.exists():
        raise IdentityMissing(str(path))
    data = json.loads(path.read_text(encoding="utf-8"))
    km = bytes.fromhex(data["k_m"])
    if len(km) != 32:
        raise ValueError("K_m must be 32 bytes")
    return Identity(data["mqtt_identity"], int(data["key_version"]), km)


def write_identity(identity_dir: Path, identity: Identity) -> None:
    """Write via temp file + rename + directory fsync (S5 finding), mode 0600."""
    identity_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = identity_dir / (IDENTITY_FILE + ".tmp")
    body = json.dumps(
        {"mqtt_identity": identity.mqtt_identity, "key_version": identity.key_version, "k_m": identity.km.hex()}
    )
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, body.encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, identity_dir / IDENTITY_FILE)
    if hasattr(os, "O_DIRECTORY"):
        dfd = os.open(identity_dir, os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
