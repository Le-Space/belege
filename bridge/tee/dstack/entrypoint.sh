#!/bin/sh
# The hosted bridge in a dstack container (#696): sort what came with the
# start into a tmpfs, then start the bridge with an empty environment.
#
# dstack decrypts the start's encrypted env inside the TEE and hands it to
# this container as BELEGE_BRIDGE_SECRETS: one JSON object, name → value,
# with the names the Aleph image takes from /tmp/secrets (#583,
# belege-bridge-run): the keychain's accounts, bridge_config,
# bridge_peer_key, enablebanking_sealed. Only a VM with the approved compose
# hash can decrypt it.
#
# `exec env -i` replaces this process: from then on no process in the
# container holds BELEGE_BRIDGE_SECRETS in its environment.
set -eu
run=/run/belege-bridge
umask 077
node /opt/belege-bridge-tee/sort-secrets.mjs "$run"
# The quote for the NEAR contract, beside the bridge, with nothing secret in
# its environment (registrar.mjs).
env -i PATH=/usr/local/bin:/usr/bin:/bin BELEGE_LAUNCHER_URL="${BELEGE_LAUNCHER_URL:-}" \
  node /opt/belege-bridge-tee/registrar.mjs "$run" &
exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$run" NODE_ENV=production \
  BELEGE_BRIDGE_SECRETS_DIR="$run/secrets" \
  node /opt/belege-bridge/src/cli.js --hosted --config "$run/bridge.json"
