#!/usr/bin/env bash
# deploy-bridge.sh <out dir>: the bridge with its production dependencies
# only, as one directory to bake into a hosted image: the Aleph rootfs
# (build-image.sh, #583) and a container for other TEEs (#696) take the same
# output. Run from the repository's checkout, with pnpm; `node <out>/src/cli.js
# --hosted` starts it.
set -euo pipefail
out="${1:?usage: deploy-bridge.sh <out dir>}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ ! -e "$out" ] || [ -z "$(ls -A "$out" 2>/dev/null)" ] || { echo "not empty: $out" >&2; exit 1; }
cd "$repo"
# No portal browsers in a hosted bridge (bridge/rootfs/README.md).
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
pnpm install --frozen-lockfile --filter @belege/bridge...
pnpm --filter @belege/bridge deploy --legacy --prod "$out"
rm -rf "$out/test"
du -sh "$out"
