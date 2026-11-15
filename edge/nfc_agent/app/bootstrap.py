"""Before the agent can do anything it needs an identity (D-017). This module gets one: from disk, or by enrolling."""

from __future__ import annotations

import configparser
import logging
from collections.abc import Callable
from pathlib import Path

from ..infra import enroll
from ..infra.identity import Identity, IdentityMissing, load_identity
from .agent import AgentConfig

log = logging.getLogger("nfc_agent.bootstrap")

CONFIG_FILE = Path("/etc/nfc-agent/agent.conf")


class EnrollmentStopped(RuntimeError):
    """An admin rejected this workstation, or the server refused its request: wait for `nfc-agent reenroll`."""


def agent_version() -> str:
    try:
        from importlib.metadata import version

        return version("nfc-agent")
    except Exception:  # not installed as a package (tests, running from the source tree)
        return "0.1.0"


def load_agent_conf(path: Path = CONFIG_FILE) -> dict[str, str]:
    """`[server] url`, `[server] ca_file`; a missing file is an empty config, not an error."""
    parser = configparser.ConfigParser()
    if path.exists():
        parser.read(path, encoding="utf-8")
    out: dict[str, str] = {}
    if parser.has_section("server"):
        for key in ("url", "ca_file"):
            value = parser.get("server", key, fallback="").strip()
            if value:
                out[key] = value
    return out


def apply_conf(config: AgentConfig, conf: dict[str, str]) -> AgentConfig:
    if "url" in conf:
        config.server_url = conf["url"]
    if "ca_file" in conf:
        config.ca_file = Path(conf["ca_file"])
    return config


def default_enroller(config: AgentConfig) -> enroll.Enroller:
    transport = enroll.HttpsTransport(config.server_url or "", config.ca_file)
    return enroll.Enroller(transport, config.state_dir, config.identity_dir, agent_version=agent_version())


def ensure_identity(
    config: AgentConfig, make_enroller: Callable[[AgentConfig], enroll.Enroller] = default_enroller
) -> Identity:
    """The identity on disk, or a new one from enrollment (blocking until an admin decides)."""
    try:
        return load_identity(config.identity_dir)
    except IdentityMissing:
        pass
    stopped = config.state_dir / enroll.STOPPED_FILE
    if stopped.exists():
        raise EnrollmentStopped(stopped.read_text(encoding="utf-8").strip() or "enrollment stopped")
    if not config.server_url:
        raise IdentityMissing(f"{config.identity_dir} is missing and no [server] url is configured")
    try:
        return make_enroller(config).run()
    except (enroll.EnrollmentRejected, enroll.EnrollmentRefused) as err:
        # Remembered on disk: without it a restart would file a new request every time systemd restarts the service.
        config.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        stopped.write_text(f"{err}\n", encoding="utf-8")
        raise EnrollmentStopped(str(err)) from err
