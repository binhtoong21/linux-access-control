#!/usr/bin/env bash
# Run as root, normally through nfc-backup.timer.
# Write and verify a nightly PostgreSQL custom-format dump before publishing it.
# Keep the newest 14 nightly dumps; pre-update dumps are managed separately.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
umask 077
export LC_ALL=C
cd /
NIGHTLY=/var/backups/nfc-server/nightly
install -d -o root -g root -m 0700 /var/backups/nfc-server "$NIGHTLY"
DUMP="$NIGHTLY/nfclab-$(date -u +%Y%m%dT%H%M%SZ).dump"
PARTIAL="$DUMP.partial"
[[ ! -e $DUMP && ! -e $PARTIAL ]] || { echo 'Backup timestamp already exists.' >&2; exit 1; }
trap 'rm -f -- "$PARTIAL"' EXIT
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_dump -Fc nfclab > "$PARTIAL"
chmod 0600 "$PARTIAL"
/usr/lib/postgresql/15/bin/pg_restore --list "$PARTIAL" > /dev/null
mv -- "$PARTIAL" "$DUMP"
shopt -s nullglob
dumps=("$NIGHTLY"/nfclab-*.dump)
if (( ${#dumps[@]} > 14 )); then
    rm -f -- "${dumps[@]:0:${#dumps[@]}-14}"
fi
printf 'Backup: %s (%s bytes)\n' "$DUMP" "$(stat -c %s "$DUMP")"
