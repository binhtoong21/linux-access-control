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

CRL_FILE=/var/lib/nfc-server-crl/crl.pem
if [[ -f /etc/nfc-server/server.env ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
        if [[ $line == CRL_FILE=* ]]; then
            CRL_FILE=${line#CRL_FILE=}
            # Read a literal path, including the optional quotes used in EnvironmentFile.
            if [[ $CRL_FILE == \"*\" || $CRL_FILE == \'*\' ]]; then
                CRL_FILE=${CRL_FILE:1:${#CRL_FILE}-2}
            fi
        fi
    done < /etc/nfc-server/server.env
fi
CRL_FILE=${CRL_FILE:-/var/lib/nfc-server-crl/crl.pem}
if [[ -f $CRL_FILE ]]; then
    install -o root -g root -m 0600 -- "$CRL_FILE" "${DUMP%.dump}.crl.pem"
else
    printf 'Warning: CRL file is absent: %s; backup has no CRL copy.\n' "$CRL_FILE" >&2
fi

shopt -s nullglob
dumps=()
for dump in "$NIGHTLY"/nfclab-*.dump; do
    [[ ${dump##*/} =~ ^nfclab-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || continue
    dumps+=("$dump")
done
if (( ${#dumps[@]} > 14 )); then
    rm -f -- "${dumps[@]:0:${#dumps[@]}-14}"
fi
# A CRL copy survives exactly as long as the dump with the same timestamp.
for crl in "$NIGHTLY"/nfclab-*.crl.pem; do
    [[ ${crl##*/} =~ ^nfclab-[0-9]{8}T[0-9]{6}Z\.crl\.pem$ ]] || continue
    if [[ ! -f ${crl%.crl.pem}.dump ]]; then
        rm -f -- "$crl"
    fi
done
printf 'Backup: %s (%s bytes)\n' "$DUMP" "$(stat -c %s "$DUMP")"
