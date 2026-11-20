#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Build on Ubuntu 22.04 amd64.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 22.04 ]] || { echo 'Build on Ubuntu 22.04 amd64.' >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
NODE_ARCHIVE=node-v20.18.1-linux-x64.tar.xz
curl -fsSLo "$WORK/$NODE_ARCHIVE" "https://nodejs.org/dist/v20.18.1/$NODE_ARCHIVE"
curl -fsSLo "$WORK/SHASUMS256.txt" https://nodejs.org/dist/v20.18.1/SHASUMS256.txt
(cd "$WORK"; grep "  $NODE_ARCHIVE\$" SHASUMS256.txt | sha256sum --check --strict -)
tar -xJf "$WORK/$NODE_ARCHIVE" -C "$WORK"
export PATH="$WORK/node-v20.18.1-linux-x64/bin:$PATH"
export COREPACK_HOME="$WORK/corepack"
# Pin a pnpm 10 release; recent npm signatures require an updated Corepack.
npm install --global corepack@0.31.0
corepack enable
corepack prepare pnpm@10.11.0 --activate
export CI=true
export NODE_ENV=development
VERSION=$(node -p "require(process.argv[1]).version" "$ROOT/server/package.json")-${BUNDLE_REVISION:-1}
[[ $VERSION =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo 'Invalid bundle version.' >&2; exit 1; }
BUNDLE="$WORK/nfc-server-$VERSION"
mkdir -p "$BUNDLE/server" "$WORK/server-build" "$WORK/dashboard-build"
# Build clean copies: no developer node_modules, dist, credentials or local state.
tar -C "$ROOT/server" --exclude=node_modules --exclude=dist --exclude=.env --exclude='.env.*' --exclude=coverage -cf - . | tar -C "$WORK/server-build" -xf -
(cd "$WORK/server-build"; pnpm install --frozen-lockfile; pnpm build)
cp "$ROOT/server/package.json" "$ROOT/server/pnpm-lock.yaml" "$BUNDLE/server/"
cp -a "$WORK/server-build/dist" "$ROOT/server/migrations" "$BUNDLE/server/"
# A standalone clean production install works without a pnpm workspace.
(cd "$BUNDLE/server"; NODE_ENV=production pnpm install --frozen-lockfile --prod)
# Fail the build if the native linux-x64 Argon2 package is missing or unusable.
(cd "$BUNDLE/server"; node -e 'require("@node-rs/argon2").hashSync("bundle-native-check")')
tar -C "$ROOT/dashboard" --exclude=node_modules --exclude=dist --exclude=.env --exclude='.env.*' --exclude='*.tsbuildinfo' --exclude=coverage -cf - . | tar -C "$WORK/dashboard-build" -xf -
(cd "$WORK/dashboard-build"; pnpm install --frozen-lockfile; pnpm build)
cp -a "$WORK/node-v20.18.1-linux-x64" "$BUNDLE/node"
cp -a "$ROOT/contracts" "$BUNDLE/contracts"
cp -a "$WORK/dashboard-build/dist" "$BUNDLE/dashboard"
cp -a "$ROOT/deploy/prod" "$BUNDLE/deploy"
find "$BUNDLE/deploy" -type d -name __pycache__ -prune -exec rm -rf {} +
printf '%s\n' "$VERSION" > "$BUNDLE/VERSION"
mkdir -p "$ROOT/deploy/dist"
tar -czf "$ROOT/deploy/dist/nfc-server-$VERSION.tar.gz" -C "$WORK" "nfc-server-$VERSION"
echo "Bundle: $ROOT/deploy/dist/nfc-server-$VERSION.tar.gz"
