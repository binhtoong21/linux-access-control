"""nfc-agent command line: `run` (systemd service) and root-only local admin commands via the control socket."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import socket
import sys
from pathlib import Path

from .app.agent import CONTROL_SOCKET, AgentConfig, build


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
    sw = sub.add_parser("simulate-swipe", help="feed a UID through the real decision path (tests, demo)")
    sw.add_argument("uid")
    ap = sub.add_parser("apply-snapshot", help="apply a signed snapshot file (offline/dev; normally via MQTT)")
    ap.add_argument("payload", type=Path, help="raw snapshot bytes; signature read from <payload>.sig")
    sub.add_parser("status")
    args = p.parse_args(argv)

    if args.cmd == "run":
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
        agent = build(AgentConfig(db_path=args.db, identity_dir=args.identity_dir, reader=args.reader))

        def stop(*_):
            agent.sessions.planned_shutdown()  # planned shutdown: reported workstation_rebooted
            agent.store.close()
            sys.exit(0)

        signal.signal(signal.SIGTERM, stop)
        agent.run_forever()
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
