# The hosted bridge on dstack (Phala Cloud, Intel TDX)

The bridge in a confidential VM, on the TEE stack NEAR's Shade Agents use (#696). This is the same bridge as the Aleph image (`bridge/rootfs`, #583): `bridge/rootfs/deploy-bridge.sh` builds it for both, and the secrets arrive in the same layout.

|                | Aleph (#583)                       | dstack (this)                                                           |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| TEE            | AMD SEV-SNP                        | Intel TDX                                                               |
| Image          | encrypted rootfs, Aleph STORE      | container, GHCR, pinned by digest                                       |
| Measured       | runtime + STORE hash               | compose hash (with Phala's pre-launch script)                           |
| Secrets arrive | attestation agent → `/tmp/secrets` | after the VM is attested on NEAR: sealed by the browser to the VM's own intake key, fetched by `registrar.mjs` |
| Sorted by      | `belege-bridge-run`                | `entrypoint.sh` → `sort-secrets.mjs`                                    |
| Inbound ports  | none                               | none (gateway off)                                                      |

## Files

- `Dockerfile` – build from the repository's root: `docker build -f bridge/tee/dstack/Dockerfile -t belege-bridge-dstack .` Bases pinned by digest; Node is copied as one binary onto Debian 12; user 10001.
- `entrypoint.sh` – sorts the start's secrets into the tmpfs `/run/belege-bridge`, then `exec env -i … node cli.js --hosted`: from then on no process holds the secrets in its environment.
- `sort-secrets.mjs` – `BELEGE_BRIDGE_SECRETS` is one JSON object, name → string (accounts up to 64 KiB, the three files up to 256 KiB; a peer key that is not clean base64 is dropped, and the bridge makes its own). Kept: `bridge_start` (`{ books, at_ms }`, the start this VM answers, written to `start.json`), the keychain's accounts (`imap`, `enablebanking`, `portal_<id>`, …), `bridge_config`, `bridge_peer_key` (base64), `enablebanking_sealed`; everything else is dropped. The hosted settings win over the owner's config: bridge on 8765, the node's WebSocket on 127.0.0.1:9097, nothing announced, a language model only in LibertAI's attested enclave (`enclaveLlm`: a LibertAI pin and base URL, else `llm` and its key are dropped, #754).
- `registrar.mjs` – before the bridge, with an empty environment: makes an X25519 intake key, asks dstack (`/var/run/dstack.sock`) for a TDX quote whose report data is `SHA-256("belege-bridge/start/1" ‖ books ‖ ":" ‖ start ms) ‖ SHA-256(intake key)`, and posts it with the key to the launcher (`BELEGE_LAUNCHER_URL`, fixed in the compose file), which submits it to the NEAR contract. The VM holds no NEAR key and no money; the quote answers one start only. Then it polls the launcher for the secrets the browser sealed to that key, opens them (`intake.mjs`) and sorts them like `sort-secrets.mjs`; without them in 15 minutes the bridge starts unarmed.
- `intake.mjs` – how the secrets are sealed: X25519 with an ephemeral key, HKDF-SHA256, AES-256-GCM, bound to the books and the start. The start page does the same in the browser; a shared test vector keeps both in step.
- `compose.yaml` – read-only, no capabilities, tmpfs only, no ports, the dstack socket. No `init: true`: an init as PID 1 would keep the start's environment.
- `provision.mjs <image@sha256:…>` – asks Phala for the compose hash, the app id and the key the browser encrypts the secrets to. Starts nothing.

## Try it locally

```bash
docker build -f bridge/tee/dstack/Dockerfile -t belege-bridge-dstack:dev .
BELEGE_BRIDGE_IMAGE=belege-bridge-dstack:dev BELEGE_BRIDGE_SECRETS='{"imap":"made-up"}' \
  docker compose -p belege-tee -f bridge/tee/dstack/compose.yaml up
```

The env carries only `bridge_start`; the secrets come in the second phase. Hosted, the bridge prints no pairing invitation and issues no code: a device pairs after attesting the VM (#585). Its node key (`bridge_peer_key`) comes with the secrets, so the browser knows the peer id it dials.

## Measured (2026-11-06)

|                                                                      |                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Image                                                                | 640 MB (Node and the bridge's production dependencies) |
| Container start until the bridge listens (one-phase start)           | 2 s                                                    |
| Phala, 4 MB test image: create until it answers / stop / start       | ≤ 36 s / 13 s / 38 s                                   |

The NEAR contract is in `../near-contract`. Still to do (#696): the launcher, the start screen.
