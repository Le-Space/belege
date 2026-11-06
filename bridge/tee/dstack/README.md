# The hosted bridge on dstack (Phala Cloud, Intel TDX)

The bridge in a confidential VM, on the TEE stack NEAR's Shade Agents use (#696). This is the same bridge as the Aleph image (`bridge/rootfs`, #583): `bridge/rootfs/deploy-bridge.sh` builds it for both, and the secrets arrive in the same layout.

|                | Aleph (#583)                       | dstack (this)                                                           |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| TEE            | AMD SEV-SNP                        | Intel TDX                                                               |
| Image          | encrypted rootfs, Aleph STORE      | container, GHCR, pinned by digest                                       |
| Measured       | runtime + STORE hash               | compose hash (with Phala's pre-launch script)                           |
| Secrets arrive | attestation agent → `/tmp/secrets` | encrypted env, decrypted by dstack in the TEE → `BELEGE_BRIDGE_SECRETS` |
| Sorted by      | `belege-bridge-run`                | `entrypoint.sh` → `sort-secrets.mjs`                                    |
| Inbound ports  | none                               | none (gateway off)                                                      |

## Files

- `Dockerfile` – build from the repository's root: `docker build -f bridge/tee/dstack/Dockerfile -t belege-bridge-dstack .` Bases pinned by digest; Node is copied as one binary onto Debian 12; user 10001.
- `entrypoint.sh` – sorts the start's secrets into the tmpfs `/run/belege-bridge`, then `exec env -i … node cli.js --hosted`: from then on no process holds the secrets in its environment.
- `sort-secrets.mjs` – `BELEGE_BRIDGE_SECRETS` is one JSON object, name → string (accounts up to 64 KiB, the three files up to 256 KiB; a peer key that is not clean base64 is dropped, and the bridge makes its own). Kept: the keychain's accounts (`imap`, `enablebanking`, `portal_<id>`, …), `bridge_config`, `bridge_peer_key` (base64), `enablebanking_sealed`; everything else is dropped. The hosted settings win over the owner's config: bridge on 8765, the node's WebSocket on 127.0.0.1:9097, nothing announced, no language model.
- `compose.yaml` – read-only, no capabilities, tmpfs only, no ports.
- `provision.mjs <image@sha256:…>` – asks Phala for the compose hash, the app id and the key the browser encrypts the secrets to. Starts nothing.

## Try it locally

```bash
docker build -f bridge/tee/dstack/Dockerfile -t belege-bridge-dstack:dev .
BELEGE_BRIDGE_IMAGE=belege-bridge-dstack:dev BELEGE_BRIDGE_SECRETS='{"imap":"made-up"}' \
  docker compose -p belege-tee -f bridge/tee/dstack/compose.yaml up
```

The bridge starts unarmed and writes `node/public-key.sha256`, the hash the TDX quote's report data will carry. Hosted, it prints no pairing invitation and issues no code: a device pairs after attesting the VM (#585).

## Measured (2026-11-06)

|                                                                      |                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Image                                                                | 640 MB (Node and the bridge's production dependencies) |
| Container start until the bridge listens and the key hash is written | 2 s                                                    |
| Phala, 4 MB test image: create until it answers / stop / start       | ≤ 36 s / 13 s / 38 s                                   |

Still to do (#696): the NEAR contract and the quote with the key hash in its report data, the launcher, the start screen.
