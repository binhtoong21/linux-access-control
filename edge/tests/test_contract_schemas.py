"""contracts/examples must validate against contracts/schemas (same check runs in server/)."""

import json

import pytest
from jsonschema import Draft202012Validator

NAMES = ["hello-v1", "heartbeat-v1", "outbox-v1", "snapshot-v1", "lease-v1", "ack-v1"]


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", NAMES)
def test_example_matches_schema(contracts_dir, name):
    schema = _load(contracts_dir / "schemas" / f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(_load(contracts_dir / "examples" / f"{name}.json"))


def test_schema_rejects_unknown_outcome(contracts_dir):
    schema = _load(contracts_dir / "schemas" / "outbox-v1.schema.json")
    batch = _load(contracts_dir / "examples" / "outbox-v1.json")
    batch["records"][0]["payload"]["outcome"] = "maybe"
    assert not Draft202012Validator(schema).is_valid(batch)
