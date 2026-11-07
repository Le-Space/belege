#!/usr/bin/env bash
# build-wasm.sh: the contract's wasm, built in Debian with cargo-near (clang
# with the wasm32 target for ring, rustc 1.86). Output:
# target/near/belege_bridge_agent.wasm. Caches cargo in a Docker volume.
set -euo pipefail
# (cargo-near installs with rustc 1.87. The contract builds with 1.86: nearcore does not run wasm from 1.87 or newer yet; Cargo.lock keeps dependencies that build with it, as NEAR's Shade Agent template locks them.)
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm -v "$here":/src -v belege-near-cargo:/usr/local/cargo -w /src debian:12 bash -euc '
  export DEBIAN_FRONTEND=noninteractive CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/cargo/rustup PATH=/usr/local/cargo/bin:$PATH
  apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl clang lld pkg-config libssl-dev libudev-dev build-essential >/dev/null
  command -v rustup >/dev/null || curl -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.86.0
  rustup target add wasm32-unknown-unknown --toolchain 1.86.0 >/dev/null
  command -v cargo-near >/dev/null || { rustup toolchain install 1.87.0 --profile minimal >/dev/null && cargo +1.87.0 install --locked cargo-near --version 0.19.0; }
  cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi
  ls -la target/near/*.wasm
'
