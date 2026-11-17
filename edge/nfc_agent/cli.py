"""nfc-agent command line: `run` (systemd service) and root-only local admin commands via the control socket."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from .app.agent import CONTROL_SOCKET, AgentConfig, build
from .app.bootstrap import CONFIG_FILE, EnrollmentStopped, apply_conf, ensure_identity, load_agent_conf
from .infra import enroll
from .infra.identity import IdentityMissing

log = logging.getLogger("nfc_agent")


def _idle(reason: str) -> int:
    """Stay up doing nothing: exiting would make systemd restart the agent every second (and re-enroll each time)."""
    log.error("%s; the agent is idle (PAM and the greeter fall back to passwords)", reason)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    while True:
        time.sleep(3600)


def _control(request: dict, path: Path = CONTROL_SOCKET) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(15)
        s.connect(str(path))
        s.sendall((json.dumps(request) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="nfc-agent")
    sub = p.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="run the agent (systemd service)")
    run.add_argument("--reader", choices=["pcsc", "sim"], default="pcsc")
    run.add_argument("--db", type=Path, default=AgentConfig.db_path)
    run.add_argument("--identity-dir", type=Path, default=AgentConfig.identity_dir)
    run.add_argument("--config", type=Path, default=CONFIG_FILE)
    reenroll_cmd = sub.add_parser("reenroll", help="drop this workstation's identity and enroll again (D-014.6)")
    reenroll_cmd.add_argument("--identity-dir", type=Path, default=AgentConfig.identity_dir)
    reenroll_cmd.add_argument("--state-dir", type=Path, default=AgentConfig.state_dir)
    reenroll_cmd.add_argument("--no-restart", action="store_true", help="do not restart the nfc-agent service")
    sw = sub.add_parser("simulate-swipe", help="feed a UID through the real decision path (tests, demo)")
    sw.add_argument("uid")
    ap = sub.add_parser("apply-snapshot", help="apply a signed snapshot file (offline/dev; normally via MQTT)")
    ap.add_argument("payload", type=Path, help="raw snapshot bytes; signature read from <payload>.sig")
    sub.add_parser("status")
    args = p.parse_args(argv)

    if args.cmd == "run":
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
        config = apply_conf(
            AgentConfig(db_path=args.db, identity_dir=args.identity_dir, reader=args.reader),
            load_agent_conf(args.config),
        )
        try:
            ensure_identity(config)
        except EnrollmentStopped as err:
            return _idle(f"enrollment stopped: {err}; run `sudo nfc-agent reenroll`")
        except IdentityMissing as err:
            return _idle(f"no identity: {err}")
        agent = build(config)

        signal.signal(signal.SIGTERM, lambda *_: agent.stopping.set())  # never touch the store inside the handler
        agent.run_forever()
        # Stopping the agent never ends a session: a restart of the service alone must leave the desktop alone.
        # On a real reboot, recover() closes the session as reconstructed at this liveness mark.
        try:
            agent.store.touch_liveness(agent.boot_id, time.time())
        except Exception:  # noqa: BLE001 - stopping must go on
            log.exception("could not record liveness on stop")
        if agent.link is not None:
            agent.link.stop()  # unsent records stay in the outbox and go out after the next start
        agent.store.close()
        return 0
    if args.cmd == "reenroll":
        old = enroll.reenroll(args.identity_dir, args.state_dir)
        print(f"old identity kept at {old}" if old else "no identity to keep; enrolling from scratch")
        if not args.no_restart:
            subprocess.run(["systemctl", "restart", "nfc-agent"], check=True)
            print("nfc-agent restarted: it sends a new enrollment request; approve it as a reinstall on the Dashboard")
        return 0
    if args.cmd == "simulate-swipe":
        reply = _control({"cmd": "simulate_swipe", "uid": args.uid})
    elif args.cmd == "apply-snapshot":
        sig = Path(str(args.payload) + ".sig").read_text().strip()
        reply = _control({"cmd": "apply_snapshot", "payload_hex": args.payload.read_bytes().hex(), "signature": sig})
    else:
        reply = _control({"cmd": "status"})
    print(json.dumps(reply, ensure_ascii=False, indent=2))
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
