#!/bin/bash
set -euo pipefail

EDGE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PACKAGING="$EDGE_DIR/packaging"
VERSION=$(sed -n 's/^version = "\([^"]*\)".*/\1/p' "$EDGE_DIR/pyproject.toml")
VERSION="${VERSION:?Missing project version}-${DEB_REVISION:-1}"
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
ROOT="$WORK/root"

make -C "$EDGE_DIR/pam"
python3 -m venv "$WORK/build-venv"
PYTHON="$WORK/build-venv/bin/python"
mkdir -p "$ROOT/opt/nfc-agent/wheels" "$ROOT/DEBIAN" "$EDGE_DIR/dist"
"$PYTHON" -m pip wheel --no-deps --wheel-dir "$ROOT/opt/nfc-agent/wheels" "$EDGE_DIR"
"$PYTHON" -m pip download --only-binary=:all: --no-deps \
    --dest "$ROOT/opt/nfc-agent/wheels" -r "$PACKAGING/requirements-runtime.txt"

install -Dm755 "$PACKAGING/nfc-agent" "$ROOT/usr/bin/nfc-agent"
install -Dm644 "$PACKAGING/nfc-agent.service" "$ROOT/lib/systemd/system/nfc-agent.service"
install -Dm644 "$EDGE_DIR/pam/pam_nfc.so" "$ROOT/lib/x86_64-linux-gnu/security/pam_nfc.so"
install -Dm755 "$EDGE_DIR/greeter/lab_greeter.py" "$ROOT/usr/lib/nfc-agent/lab_greeter.py"
install -Dm755 "$EDGE_DIR/greeter/lab-greeter-wrapper.sh" "$ROOT/usr/lib/nfc-agent/lab-greeter-wrapper.sh"
install -Dm755 "$PACKAGING/debian/nfc-pam-config" "$ROOT/usr/lib/nfc-agent/nfc-pam-config"
install -Dm644 "$PACKAGING/lab-greeter.desktop" "$ROOT/usr/share/xgreeters/lab-greeter.desktop"
install -Dm644 "$PACKAGING/99-lab-greeter.conf" "$ROOT/usr/share/lightdm/lightdm.conf.d/99-lab-greeter.conf"
install -Dm644 "$PACKAGING/blacklist-nfc-pn533.conf" "$ROOT/etc/modprobe.d/blacklist-nfc-pn533.conf"
install -Dm644 "$PACKAGING/agent.conf.example" "$ROOT/usr/share/doc/nfc-agent/agent.conf.example"
for script in postinst prerm postrm; do
    install -m755 "$PACKAGING/debian/$script" "$ROOT/DEBIAN/$script"
done
install -m644 "$PACKAGING/debian/conffiles" "$ROOT/DEBIAN/conffiles"
sed "s/@VERSION@/$VERSION/" "$PACKAGING/debian/control" > "$ROOT/DEBIAN/control"
find "$ROOT" -type d -exec chmod 0755 {} +
find "$ROOT/opt/nfc-agent/wheels" -type f -exec chmod 0644 {} +
chmod 0644 "$ROOT/DEBIAN/control"
dpkg-deb --root-owner-group --build "$ROOT" "$EDGE_DIR/dist/nfc-agent_${VERSION}_amd64.deb"
