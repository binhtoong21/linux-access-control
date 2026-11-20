#!/usr/bin/env bash
# Shared helpers; sourced by root-only entry points.
set -euo pipefail

require_root() {
    [[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
}

validate_server_name() {
    [[ ${SERVER_NAME:-} =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || {
        echo 'SERVER_NAME must be a DNS name (for example lab-server.local).' >&2; exit 1;
    }
}

load_server_env() {
    [[ -f /etc/nfc-server/server.env ]] || { echo 'Install the server first: server.env is missing.' >&2; exit 1; }
    set -a
    # Installer-generated values use quoting compatible with bash and systemd EnvironmentFile.
    source /etc/nfc-server/server.env
    set +a
    validate_server_name
}

run_release() {
    local release=$1
    shift
    cd /
    runuser -u nfcsrv -- /bin/bash -c '
        set -euo pipefail
        set -a
        source /etc/nfc-server/server.env
        set +a
        release=$1
        shift
        cd "$release/server"
        exec "$release/node/bin/node" "$@"
    ' bash "$release" "$@"
}
