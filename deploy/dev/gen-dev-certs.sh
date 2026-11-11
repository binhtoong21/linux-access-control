#!/usr/bin/env bash
# Dev-only PKI for deploy/dev (never use in production). Output: deploy/dev/certs/ (git-ignored).
#   CA (ECDSA P-256), broker cert (CN=localhost), server client cert (CN=nfc-server),
#   one dev workstation cert (Ed25519, CN=ws-dev-01) and an empty CRL (S9: the CRL file must always exist).
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash on Windows: keep "/CN=..." as-is
cd "$(dirname "$0")"
OUT=certs
WS_ID="${1:-ws-dev-01}"
rm -rf "$OUT" && mkdir -p "$OUT/ca/newcerts"
touch "$OUT/ca/index.txt"; echo 1000 > "$OUT/ca/serial"; echo 1000 > "$OUT/ca/crlnumber"

cat > "$OUT/ca/openssl.cnf" <<EOF
[ ca ]
default_ca = dev_ca
[ dev_ca ]
dir = $OUT/ca
database = \$dir/index.txt
new_certs_dir = \$dir/newcerts
serial = \$dir/serial
crlnumber = \$dir/crlnumber
certificate = \$dir/ca.crt
private_key = \$dir/ca.key
default_md = sha256
default_days = 1095
default_crl_days = 3650
policy = any
unique_subject = no
copy_extensions = none
[ any ]
commonName = supplied
[ client ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
[ broker ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyAgreement
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost, DNS:mosquitto, IP:127.0.0.1
EOF

openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/ca/ca.key"
openssl req -x509 -new -key "$OUT/ca/ca.key" -sha256 -days 3650 -subj "/CN=NFC Lab Dev CA" -out "$OUT/ca.crt"
cp "$OUT/ca.crt" "$OUT/ca/ca.crt"

issue() { # name CN extension keytype
  if [ "$4" = ed25519 ]; then openssl genpkey -algorithm ed25519 -out "$OUT/$1.key"
  else openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/$1.key"; fi
  openssl req -new -key "$OUT/$1.key" -subj "/CN=$2" -out "$OUT/$1.csr"
  openssl ca -batch -config "$OUT/ca/openssl.cnf" -extensions "$3" -in "$OUT/$1.csr" -out "$OUT/$1.crt" 2>/dev/null
  rm "$OUT/$1.csr"
}
issue broker localhost broker ec
issue nfc-server nfc-server client ec
issue "$WS_ID" "$WS_ID" client ed25519
openssl ca -config "$OUT/ca/openssl.cnf" -gencrl -out "$OUT/crl.pem" 2>/dev/null
chmod 644 "$OUT"/*.key  # mosquitto container user must read them; dev only

echo "Dev PKI ready in $OUT/: ca.crt, broker.{crt,key}, nfc-server.{crt,key}, $WS_ID.{crt,key}, crl.pem"
