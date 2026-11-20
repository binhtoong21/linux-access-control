#!/usr/bin/env bash
# Usage: sudo bash export-keys.sh <output-file>
# Enter the encryption passphrase twice at the terminal; output must not exist.
# Store the encrypted archive and its passphrase separately off the server.
# Decrypt into an empty directory using the command printed on success.
set -euo pipefail
source "$(dirname "$0")/../common.sh"
require_root
[[ $# == 1 ]] || { echo 'Usage: export-keys.sh <output-file>' >&2; exit 2; }
OUTPUT=$1
[[ ! -e $OUTPUT && ! -L $OUTPUT ]] || { echo 'Output already exists.' >&2; exit 1; }
umask 077
IFS= read -r -s -p 'Passphrase: ' passphrase < /dev/tty
printf '\n' > /dev/tty
IFS= read -r -s -p 'Repeat passphrase: ' repeated < /dev/tty
printf '\n' > /dev/tty
[[ -n $passphrase && $passphrase == "$repeated" ]] || { echo 'Passphrases must match and be non-empty.' >&2; exit 1; }
# Reserve the output without overwriting even if another writer created it.
(set -o noclobber; : > "$OUTPUT")
trap 'rm -f -- "$OUTPUT"' EXIT
chmod 0600 "$OUTPUT"
tar -cz -C / etc/nfc-server/keys etc/nfc-server/server.env | \
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass fd:3 \
        3<<< "$passphrase" > "$OUTPUT"
unset passphrase repeated
trap - EXIT
printf 'Decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in %q | tar -xz -C <dir>\n' "$OUTPUT"
