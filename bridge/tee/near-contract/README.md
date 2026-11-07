# The hosted bridge's contract on NEAR

Which bridge code is approved, who asked to start or stop the bridge of some books, and which TDX VM answered that start with which node key (#696). Testnet only for now.

| Method | Who | What |
|---|---|---|
| `request_start({ books? })`, `request_stop({ books? })` | the books' NEAR account, or one it granted | an event the launcher acts on; a stop (or a new start) forgets the bridge at once. New books pay 0.01 NEAR storage once. One request per 30 s. |
| `grant({ account_id })`, `revoke(…)` | the books | let another agent wake the bridge (at most 8) |
| `register_bridge({ books, attestation, peer_key_hash })` | anyone (the launcher) | checks the dstack quote (shade-attestation: DCAP, RTMR3, compose hash, PPID) against the pending start; stores the node key's hash |
| `approve_measurements`, `approve_ppids`, `remove_*`, `set_attestation_ttl`, `forget_bridge` | the owner (Le Space) | which code, on which machines |
| `get_books({ books })` | view | grants, the pending request, the bridge with `peer_key_hash`, `compose_hash` and `valid` |

The quote's report data (64 bytes):

```
SHA-256("belege-bridge/start/1" ‖ books ‖ ":" ‖ start ms)  ‖  SHA-256(libp2p public key, protobuf)
```

A browser pairs with the bridge only when `get_books` shows a `valid` bridge and `sha256(base58btc.decode(peerId).slice(2))` equals its `peer_key_hash`. Without TDX (a test network), `new({ requires_tee: false })` lets the owner name a test submitter that registers with a mock attestation.

```bash
cargo test
```

The wasm: `./build-wasm.sh` (Docker, Debian with clang for `ring`'s wasm32 build, cargo-near 0.19) → `target/near/belege_bridge_agent.wasm`, about 730 KB. It builds with rustc **1.86**: nearcore does not run wasm from 1.87 or newer yet, so `Cargo.lock` keeps dependencies that build with it, as NEAR's Shade Agent template locks them (`near-sys` 0.2.9, not 0.2.14, which wants 1.93). Do not `cargo update` without building the wasm again.

Made after NEAR's Shade Agent template (NearDeFi/shade-agent-template, Apache-2.0); the attestation check is its `shade-attestation` crate (MIT), used as it is.
