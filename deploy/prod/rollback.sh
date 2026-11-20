#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_root
[[ $# == 1 && $1 =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo 'Usage: rollback.sh <version>' >&2; exit 2; }
load_server_env
release=/opt/nfc-server/releases/$1
[[ -d $release && -f $release/VERSION ]] || { echo "Release not found: $1" >&2; exit 1; }
current=$(readlink -f /opt/nfc-server/current)
[[ $release != "$current" && $(printf '%s\n' "$1" "$(cat "$current/VERSION")" | sort -V | head -n 1) == "$1" ]] || {
    echo 'Choose an older installed release.' >&2; exit 1;
}
echo 'WARNING: migrations may require restoring a pre-upgrade dump from /var/backups/nfc-server.' >&2
echo 'Expand-first migrations usually preserve old-code compatibility. No database restore is performed.' >&2
systemctl stop nfc-server
ln -sfn "$release" /opt/nfc-server/current
systemctl start nfc-server
echo "Rolled back to $1. Check https://$SERVER_NAME/api/v1/system/health."
