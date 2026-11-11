import json
from pathlib import Path

import pytest

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


@pytest.fixture(scope="session")
def contracts_dir() -> Path:
    return CONTRACTS


@pytest.fixture(scope="session")
def crypto_vectors(contracts_dir: Path) -> dict:
    return json.loads((contracts_dir / "vectors" / "crypto-v1.json").read_text(encoding="utf-8"))
