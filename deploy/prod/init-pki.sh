#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_root
[[ $# -ge 1 && $# -le 2 ]] || { echo 'Usage: init-pki.sh <SERVER_NAME> [SERVER_IP]' >&2; exit 2; }
SERVER_NAME=$1
SERVER_IP=${2:-}
validate_server_name
[[ -z $SERVER_IP || $SERVER_IP =~ ^[0-9a-fA-F:.]+$ ]] || { echo 'Invalid SERVER_IP.' >&2; exit 2; }
KEYS_DIR=${KEYS_DIR:-/etc/nfc-server/keys}
umask 077
install -d -o nfcsrv -g nfcsrv -m 0700 "$KEYS_DIR"
install -d -o root -g mosquitto -m 0750 /etc/mosquitto/certs
install -d -o root -g root -m 0700 /etc/nginx/nfc-server
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# noclobber also protects a dangling symlink; never replace existing PKI files.
# All generated temporary files use this same guarded writer.
write_new() {
    local target=$1
    shift
    if [[ ! -e $target && ! -L $target ]]; then
        local content
        # Generate successfully before opening a persistent target; a failed
        # OpenSSL command must not leave an empty file that blocks a retry.
        content=$("$@")
        (set -o noclobber; printf '%s\n' "$content" > "$target")
    fi
}

if [[ -e $KEYS_DIR/ca.crt && ! -e $KEYS_DIR/ca.key ]]; then
    echo 'CA certificate exists without its key; restore the original key from backup.' >&2
    exit 1
fi
write_new "$KEYS_DIR/ca.key" openssl ecparam -name prime256v1 -genkey -noout
write_new "$KEYS_DIR/ca.crt" openssl req -x509 -new -key "$KEYS_DIR/ca.key" -sha256 -days 3650 -subj '/CN=NFC Lab CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
chown nfcsrv:nfcsrv "$KEYS_DIR/ca.key" "$KEYS_DIR/ca.crt"
chmod 0600 "$KEYS_DIR/ca.key"
chmod 0644 "$KEYS_DIR/ca.crt"
SAN="DNS:$SERVER_NAME,DNS:localhost,IP:127.0.0.1"
if [[ -n $SERVER_IP ]]; then SAN+=",IP:$SERVER_IP"; fi

issue() {
    local base=$1 cn=$2 usage=$3 key_usage=$4 owner=$5 mode=$6
    if [[ -e $base.crt && ! -e $base.key ]]; then
        echo "Certificate exists without its key: $base; restore the original key." >&2
        exit 1
    fi
    write_new "$base.key" openssl ecparam -name prime256v1 -genkey -noout
    if [[ ! -e $base.crt && ! -L $base.crt ]]; then
        write_new "$WORK/request.csr" openssl req -new -key "$base.key" -subj "/CN=$cn"
        write_new "$WORK/extensions" printf '%s\n' 'basicConstraints=critical,CA:FALSE' \
            "keyUsage=critical,$key_usage" "extendedKeyUsage=$usage" "subjectAltName=$SAN"
        write_new "$base.crt" openssl x509 -req -in "$WORK/request.csr" \
            -CA "$KEYS_DIR/ca.crt" -CAkey "$KEYS_DIR/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
            -days 1825 -sha256 -extfile "$WORK/extensions"
        rm -f "$WORK/request.csr" "$WORK/extensions"
    fi
    chown "$owner" "$base.key" "$base.crt"
    chmod "$mode" "$base.key"
    chmod 0644 "$base.crt"
}

issue /etc/mosquitto/certs/broker "$SERVER_NAME" serverAuth digitalSignature,keyAgreement root:mosquitto 0640
issue "$KEYS_DIR/nfc-server" nfc-server clientAuth digitalSignature nfcsrv:nfcsrv 0600
# Nginx gets its own key and signing-only keyUsage, separate from the broker.
issue /etc/nginx/nfc-server/tls "$SERVER_NAME" serverAuth digitalSignature root:root 0600
chmod 0600 "$KEYS_DIR/nfc-server.crt"
echo 'PKI ready; existing files were preserved.'
