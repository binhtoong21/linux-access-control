"""Getting an identity before the agent starts: from disk, by enrolling, or not at all (D-014, D-017)."""

import pytest

from nfc_agent import cli
from nfc_agent.app.agent import AgentConfig
from nfc_agent.app.bootstrap import EnrollmentStopped, apply_conf, ensure_identity, load_agent_conf
from nfc_agent.infra import enroll
from nfc_agent.infra.identity import Identity, IdentityMissing, load_identity, write_identity

IDENT = Identity("ws-07", 2, bytes(range(32)))


class FakeEnroller:
    def __init__(self, outcome):
        self.outcome = outcome
        self.runs = 0

    def run(self):
        self.runs += 1
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture
def config(tmp_path):
    return AgentConfig(
        identity_dir=tmp_path / "identity", state_dir=tmp_path / "state", server_url="https://lab-server"
    )


def test_conf_file_sets_the_server_and_a_missing_file_is_empty(tmp_path):
    assert load_agent_conf(tmp_path / "missing.conf") == {}
    conf = tmp_path / "agent.conf"
    conf.write_text("[server]\nurl = https://lab-server.local\nca_file = /etc/x/ca.pem\n", encoding="utf-8")
    assert load_agent_conf(conf) == {"url": "https://lab-server.local", "ca_file": "/etc/x/ca.pem"}
    applied = apply_conf(AgentConfig(), load_agent_conf(conf))
    assert (applied.server_url, str(applied.ca_file).replace("\\", "/")) == (
        "https://lab-server.local",
        "/etc/x/ca.pem",
    )
    conf.write_text("[server]\nurl =\n", encoding="utf-8")
    assert load_agent_conf(conf) == {}
    assert apply_conf(AgentConfig(), {}).server_url is None


def test_an_identity_on_disk_is_used_without_enrolling(config):
    write_identity(config.identity_dir, IDENT)
    fake = FakeEnroller(AssertionError("must not enroll"))
    assert ensure_identity(config, lambda _: fake) == IDENT
    assert fake.runs == 0


def test_a_missing_identity_enrolls_when_a_server_is_configured(config):
    fake = FakeEnroller(IDENT)
    assert ensure_identity(config, lambda _: fake) == IDENT
    assert fake.runs == 1


def test_a_missing_identity_without_a_server_is_an_error(config):
    config.server_url = None
    with pytest.raises(IdentityMissing, match="no \\[server\\] url"):
        ensure_identity(config, lambda _: FakeEnroller(IDENT))


@pytest.mark.parametrize(
    "error", [enroll.EnrollmentRejected("rejected by an admin"), enroll.EnrollmentRefused("INVALID_CSR")]
)
def test_a_rejection_is_remembered_so_restarts_do_not_file_new_requests(config, error):
    with pytest.raises(EnrollmentStopped):
        ensure_identity(config, lambda _: FakeEnroller(error))
    marker = config.state_dir / enroll.STOPPED_FILE
    assert marker.exists()
    again = FakeEnroller(IDENT)
    with pytest.raises(EnrollmentStopped, match=str(error)):
        ensure_identity(config, lambda _: again)
    assert again.runs == 0


def test_reenroll_command_keeps_the_identity_aside_and_clears_the_stop_marker(config, capsys):
    write_identity(config.identity_dir, IDENT)
    config.state_dir.mkdir(parents=True)
    (config.state_dir / enroll.STOPPED_FILE).write_text("rejected\n")
    (config.state_dir / enroll.PENDING_FILE).write_text("{}")
    argv = [
        "reenroll",
        "--identity-dir",
        str(config.identity_dir),
        "--state-dir",
        str(config.state_dir),
        "--no-restart",
    ]
    assert cli.main(argv) == 0
    assert "old identity kept at" in capsys.readouterr().out
    with pytest.raises(IdentityMissing):
        load_identity(config.identity_dir)
    assert not (config.state_dir / enroll.STOPPED_FILE).exists()
    assert not (config.state_dir / enroll.PENDING_FILE).exists()
    old = [p for p in config.identity_dir.parent.iterdir() if p.name.startswith("identity.old.")]
    assert len(old) == 1 and load_identity(old[0]) == IDENT
    assert cli.main(argv) == 0
    assert "no identity to keep" in capsys.readouterr().out
    # Enrolling works again after reenroll.
    assert ensure_identity(config, lambda _: FakeEnroller(IDENT)) == IDENT
