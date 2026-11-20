#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_root
[[ $# == 2 ]] || { echo 'Usage: create-admin.sh <username> <display name>' >&2; exit 2; }
load_server_env
IFS= read -r -s -p 'Password: ' password < /dev/tty
printf '\n' > /dev/tty
IFS= read -r -s -p 'Repeat password: ' repeated < /dev/tty
printf '\n' > /dev/tty
[[ $password == "$repeated" ]] || { echo 'Passwords do not match.' >&2; exit 1; }
printf '%s' "$password" | run_release /opt/nfc-server/current dist/identity/create-admin-cli.js --username "$1" --display-name "$2"
unset password repeated
