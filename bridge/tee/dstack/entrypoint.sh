#!/bin/sh
# The hosted bridge in a dstack container (#696), started in two phases:
#
# 1. dstack decrypts the start's env inside the TEE and hands it to this
#    container as BELEGE_BRIDGE_SECRETS: one JSON object, name → value. It
#    carries bridge_start (the books and the start this VM answers), nothing
#    secret. sort-secrets.mjs writes it into a tmpfs.
# 2. registrar.mjs proves the VM on NEAR with a key of its own and waits for
#    the bridge's secrets, sealed by the browser to that key once the
#    contract shows the VM attested: the keychain's accounts, bridge_config,
#    bridge_peer_key, enablebanking_sealed, with the names the Aleph image
#    takes from /tmp/secrets (#583, belege-bridge-run). It sorts them into
#    the same tmpfs and exits.
#
# Then the bridge starts.
# `exec env -i` replaces this process: from then on no process in the
# container holds BELEGE_BRIDGE_SECRETS in its environment.
set -eu
run=/run/belege-bridge
umask 077
node /opt/belege-bridge-tee/sort-secrets.mjs "$run"
env -i PATH=/usr/local/bin:/usr/bin:/bin BELEGE_LAUNCHER_URL="${BELEGE_LAUNCHER_URL:-}" \
  node /opt/belege-bridge-tee/registrar.mjs "$run" || true
exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$run" NODE_ENV=production \
  BELEGE_BRIDGE_SECRETS_DIR="$run/secrets" \
  node /opt/belege-bridge/src/cli.js --hosted --config "$run/bridge.json"
