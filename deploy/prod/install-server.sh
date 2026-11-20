#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_root
[[ $# == 1 && -f $1 ]] || { echo 'Usage: SERVER_NAME=<DNS name> [SERVER_IP=<IP>] install-server.sh <bundle.tar.gz>' >&2; exit 2; }
BUNDLE=$(realpath "$1")
if [[ -f /etc/nfc-server/server.env ]]; then
    load_server_env
else
    validate_server_name
fi
[[ $(dpkg --print-architecture) == amd64 ]] || { echo 'This bundle requires amd64.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 22.04 ]] || { echo 'Ubuntu 22.04 is required.' >&2; exit 1; }
umask 077
WORK=$(mktemp -d)
OLD_RELEASE=$(readlink -f /opt/nfc-server/current || true)
RECOVER_SERVICE=0
DUMP='none (empty database)'
wait_for_health() {
    local release=$1 deadline=$((SECONDS + 60))
    while (( SECONDS < deadline )); do
        if curl -fsS --connect-timeout 2 --max-time 3 --noproxy '*' \
            --resolve "$SERVER_NAME:443:127.0.0.1" --cacert /etc/nfc-server/ca-public/ca.crt \
            "https://$SERVER_NAME/api/v1/system/health" > "$WORK/health.json"; then
            # HTTP 200 alone does not imply MQTT is ready: health can be degraded.
            if "$release/node/bin/node" -e '
                const h = require(process.argv[1]);
                process.exit(h.status === "ok" && h.db === "ok" && h.mqtt === "ok" &&
                  h.crl_next_update && !h.warnings.includes("crl_expiring") ? 0 : 1);
            ' "$WORK/health.json"; then return 0; fi
        fi
        sleep 1
    done
    return 1
}
cleanup() {
    local status=$?
    trap - EXIT
    if (( status != 0 && RECOVER_SERVICE == 1 )); then
        echo "Deployment failed; pre-upgrade dump: $DUMP" >&2
        if ! systemctl stop nfc-server; then
            echo 'Could not stop the failed release; automatic recovery aborted. Inspect journalctl -u nfc-server.' >&2
        elif [[ -n $OLD_RELEASE && -d $OLD_RELEASE ]]; then
            if ln -sfn "$OLD_RELEASE" /opt/nfc-server/current && systemctl start nfc-server; then
                if wait_for_health "$OLD_RELEASE"; then
                    echo 'The old release is healthy again.' >&2
                else
                    echo 'The old release did not become healthy within 60 seconds; inspect journalctl -u nfc-server.' >&2
                fi
            else
                echo 'Could not restart the old release; inspect journalctl -u nfc-server.' >&2
            fi
        else
            echo 'First installation failed; no old release exists. nfc-server has been left stopped.' >&2
        fi
    fi
    rm -rf "$WORK"
    exit "$status"
}
trap cleanup EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update
# sudo is required by BROKER_RESTART_CMD, including on minimal Ubuntu installations.
apt-get install -y nginx mosquitto openssl curl ca-certificates sudo
install -d -m 0755 /usr/share/keyrings
curl -fsSLo "$WORK/pgdg.asc" https://www.postgresql.org/media/keys/ACCC4CF8.asc
install -m 0644 "$WORK/pgdg.asc" /usr/share/keyrings/nfc-pgdg.asc
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/nfc-pgdg.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main' > /etc/apt/sources.list.d/nfc-pgdg.list
apt-get update
apt-get install -y postgresql-15
systemctl enable --now postgresql

if ! id nfcsrv > /dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/nfc-server --create-home --shell /usr/sbin/nologin nfcsrv
fi
install -d -o nfcsrv -g nfcsrv -m 0750 /var/lib/nfc-server
install -d -o root -g root -m 0755 /opt/nfc-server /opt/nfc-server/releases /etc/nfc-server

# Bundles are trusted artifacts built from this repository, not third-party archives.
tar -tzf "$BUNDLE" > "$WORK/members"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$WORK/members"; then
    echo 'Invalid bundle paths.' >&2; exit 1
fi
tar -xzf "$BUNDLE" -C "$WORK" --no-same-owner
shopt -s nullglob
roots=("$WORK"/nfc-server-*)
[[ ${#roots[@]} == 1 && -f ${roots[0]}/VERSION ]] || { echo 'Invalid bundle layout.' >&2; exit 1; }
VERSION=$(cat "${roots[0]}/VERSION")
[[ $VERSION =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ && ${roots[0]##*/} == "nfc-server-$VERSION" ]] || { echo 'Invalid bundle version.' >&2; exit 1; }
RELEASE=/opt/nfc-server/releases/$VERSION
for required in node/bin/node server/dist/main.js server/dist/infra/database/migrate-cli.js server/package.json dashboard/index.html deploy/install-server.sh; do
    [[ -f ${roots[0]}/$required ]] || { echo "Bundle missing $required" >&2; exit 1; }
done
if [[ ! -f $RELEASE/.complete ]]; then
    rm -rf -- "$RELEASE"
    PARTIAL=$(mktemp -d "/opt/nfc-server/releases/.$VERSION.partial-XXXX")
    cp -a "${roots[0]}/." "$PARTIAL/"
    chown -R root:root "$PARTIAL"
    chmod -R go-w "$PARTIAL"
    chmod -R a+rX "$PARTIAL"
    touch "$PARTIAL/.complete"
    mv -- "$PARTIAL" "$RELEASE"
fi
TEMPLATES="$RELEASE/deploy"

if [[ ! -e /etc/nfc-server/server.env ]]; then
    DB_PASSWORD=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    cat > "$WORK/server.env" <<EOF
SERVER_NAME=$SERVER_NAME
SERVER_IP=${SERVER_IP:-}
JWT_SECRET=$JWT_SECRET
DATABASE_URL=postgresql://nfclab:$DB_PASSWORD@127.0.0.1:5432/nfclab
PORT=8000
KEYS_DIR=/etc/nfc-server/keys
CA_CERT_FILE=/etc/nfc-server/keys/ca.crt
CA_KEY_FILE=/etc/nfc-server/keys/ca.key
CRL_FILE=/var/lib/nfc-server-crl/crl.pem
MQTT_URL=mqtts://localhost:8883
MQTT_CA=/etc/nfc-server/keys/ca.crt
MQTT_CERT=/etc/nfc-server/keys/nfc-server.crt
MQTT_KEY=/etc/nfc-server/keys/nfc-server.key
BROKER_HOST=$SERVER_NAME
BROKER_PORT=8883
BROKER_RESTART_CMD="sudo -n /usr/bin/systemctl restart mosquitto"
CONTRACTS_DIR=/opt/nfc-server/current/contracts
SNAPSHOT_WORKER=on
EOF
    install -o nfcsrv -g nfcsrv -m 0600 "$WORK/server.env" /etc/nfc-server/server.env
    unset DB_PASSWORD JWT_SECRET
fi
if grep -qxF 'CRL_FILE=/var/lib/nfc-server/crl/crl.pem' /etc/nfc-server/server.env; then
    sed 's|^CRL_FILE=/var/lib/nfc-server/crl/crl.pem$|CRL_FILE=/var/lib/nfc-server-crl/crl.pem|' \
        /etc/nfc-server/server.env > "$WORK/server.env"
    install -o nfcsrv -g nfcsrv -m 0600 "$WORK/server.env" /etc/nfc-server/server.env
    echo 'Migrated CRL_FILE in server.env to /var/lib/nfc-server-crl/crl.pem.'
fi
load_server_env
# Extract the URL password without putting credentials in process arguments.
export NFC_DB_PASSWORD
NFC_DB_PASSWORD=$("$RELEASE/node/bin/node" -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')
cd /
runuser -u postgres -- /usr/lib/postgresql/15/bin/psql -X -v ON_ERROR_STOP=1 postgres <<'SQL'
\getenv role_password NFC_DB_PASSWORD
SELECT format('CREATE ROLE nfclab LOGIN PASSWORD %L', :'role_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nfclab') \gexec
SELECT 'CREATE DATABASE nfclab OWNER nfclab'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nfclab') \gexec
SQL
unset NFC_DB_PASSWORD

bash "$TEMPLATES/init-pki.sh" "$SERVER_NAME" "${SERVER_IP:-}"
run_release "$RELEASE" dist/shared/crypto/keys-cli.js
install -d -o nfcsrv -g mosquitto -m 0750 /var/lib/nfc-server-crl
install -d -o root -g root -m 0755 /etc/nfc-server/ca-public
install -o root -g root -m 0644 "$CA_CERT_FILE" /etc/nfc-server/ca-public/ca.crt
install -o root -g root -m 0644 "$TEMPLATES/mosquitto/nfc.conf" /etc/mosquitto/conf.d/nfc.conf
install -o root -g root -m 0644 "$TEMPLATES/mosquitto/acl.conf" /etc/mosquitto/nfc-acl.conf
printf '%s\n' 'nfcsrv ALL=(root) NOPASSWD: /usr/bin/systemctl restart mosquitto' > "$WORK/sudoers"
visudo -cf "$WORK/sudoers"
install -o root -g root -m 0440 "$WORK/sudoers" /etc/sudoers.d/nfc-server
install -o root -g root -m 0644 "$TEMPLATES/nfc-server.service" /etc/systemd/system/nfc-server.service
systemctl daemon-reload

RECOVER_SERVICE=1
systemctl stop nfc-server
install -d -o root -g root -m 0700 /var/backups/nfc-server
TABLE_COUNT=$(runuser -u postgres -- /usr/lib/postgresql/15/bin/psql -X -At -v ON_ERROR_STOP=1 nfclab -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
if [[ $TABLE_COUNT != 0 ]]; then
    DUMP="/var/backups/nfc-server/pre-$VERSION-$(date -u +%Y%m%dT%H%M%S%N).dump"
    runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_dump -Fc nfclab > "$DUMP"
    chmod 0600 "$DUMP"
fi
if ! run_release "$RELEASE" dist/infra/database/migrate-cli.js up; then
    echo "Migrations failed; current was not switched. Pre-upgrade dump: $DUMP" >&2
    exit 1
fi
ln -sfn "$RELEASE" /opt/nfc-server/current

sed "s/__SERVER_NAME__/$SERVER_NAME/g" "$TEMPLATES/nginx/nfc-server.conf" > "$WORK/nginx.conf"
install -o root -g root -m 0644 "$WORK/nginx.conf" /etc/nginx/sites-available/nfc-server
ln -sfn /etc/nginx/sites-available/nfc-server /etc/nginx/sites-enabled/nfc-server
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl enable nfc-server mosquitto nginx
systemctl start nfc-server
deadline=$((SECONDS + 30))
until [[ -s $CRL_FILE ]]; do
    if (( SECONDS >= deadline )); then
        echo "CRL not created within 30 seconds: $CRL_FILE; inspect journalctl -u nfc-server." >&2
        exit 1
    fi
    sleep 1
done
if ! runuser -u mosquitto -- test -r "$CRL_FILE"; then
    echo "Mosquitto cannot read CRL: $CRL_FILE; check file and directory permissions." >&2
    exit 1
fi
systemctl restart mosquitto
systemctl start nginx
systemctl reload nginx

if ! wait_for_health "$RELEASE"; then
    cat "$WORK/health.json" >&2 || true
    echo 'Health check did not become ready within 60 seconds.' >&2
    exit 1
fi
RECOVER_SERVICE=0
cat "$WORK/health.json"
printf '\n'
# Keep current plus the two most recently installed other releases. Touch on reuse
# so a reinstall does not cause the active release to displace a newer rollback candidate.
touch "$RELEASE"
kept=1
while IFS= read -r candidate; do
    [[ $candidate == "$RELEASE" ]] && continue
    if (( kept < 3 )); then
        kept=$((kept + 1))
    else
        rm -rf -- "$candidate"
    fi
done < <(find /opt/nfc-server/releases -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' | sort -nr | cut -d ' ' -f 2-)
echo "Installed $VERSION. Pre-upgrade dump: $DUMP"
echo "Create the first admin: sudo bash /opt/nfc-server/current/deploy/create-admin.sh <username> \"<display name>\""
echo "Copy /etc/nfc-server/ca-public/ca.crt to the master image as /etc/nfc-agent/ca.pem."
echo "Set [server] url = https://$SERVER_NAME in /etc/nfc-agent/agent.conf."
