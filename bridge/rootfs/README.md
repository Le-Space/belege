# The hosted bridge's image (#583)

The bridge can run in an **Aleph confidential VM** (AMD SEV-SNP) instead of on the person's
computer, started when needed (#251, plan #567 M4). This directory builds its image. It follows
[Le-Space/paperless-anywhere](https://github.com/Le-Space/paperless-anywhere)'s `rootfs/`, which
runs the same path in production, and relay-button's `aleph-confidential-rootfs` action.

## What is in it

`build-image.sh` makes a plain ext4: Debian 12 (`minbase`, signed packages, security updates),
Node 22 (pinned, checksummed), Caddy, and **the bridge baked in** (`pnpm deploy --prod` of this
checkout in `/opt/belege-bridge`). Nothing is pulled after the unlock. The **Bridge image**
workflow (`.github/workflows/bridge-image.yml`) hands the image to relay-button's action, which
swaps in its confidential init and a systemctl replacement, encrypts it (LUKS2, aes-xts-plain64)
and publishes it as an Aleph STORE.

The first image runs the bridge with its node, the mail fetch and Enable Banking. It has no
language model (#251), no Java/Jameica/Hibiscus, no lib-fints and no Playwright browser for
customer portals.

| Unit | What it does |
|---|---|
| `belege-bridge` | `belege-bridge-run`: sorts what came with the unlock into a tmpfs, then starts `cli.js --hosted` as the user `belege-bridge` |
| `caddy` | 443 for the VM's `*.2n6.me` name, once it came with the unlock (`belege-bridge-https`): `/attest`, `/bridge/status.json`, and the node's WebSocket |
| `attest-relay` | relay-button's attest relay on 127.0.0.1:8787, behind Caddy's `/attest`, as on orbitdb-relay |
| `belege-bridge-status` | the start's phase, the node's peer id and public addresses, and when each step was first seen; no secrets |
| `belege-bridge-forget-passphrase` | zeroes and removes a disk passphrase handed over a second time |
| `belege-bridge-net-hardening` | the interim CVE-2026-98432 filter, as in paperless-anywhere |

`belege-bridge-check` (run by the try workflow over SSH) fails if anything but Caddy (443), the
attestation agent (8443) and sshd (22, only with a key a test sent) listens beyond loopback. The
bridge's HTTP API (8765), its node's WebSocket (9097) and the attest relay listen on 127.0.0.1.
Caddy does not proxy the HTTP API.

## Secrets come with the unlock, and stay in memory (#584)

The image holds no secret and no SSH key. The owner's browser computes the launch measurement,
checks the VM's attestation report against AMD's keys and that measurement, and only then sends
the disk passphrase and the secrets, signed by the owner's key. Aleph's attestation agent writes
them to `/tmp/secrets/<name>`. `belege-bridge-run` copies the bridge's own into a tmpfs that only
the bridge's user can read:

| Secret | Becomes |
|---|---|
| `imap`, `enablebanking`, `paperless`, `aleph_backup`, `bridge_auth`, … (an account of `keychain.js`, with everything but `a-z0-9_` as `_`) | `/run/belege-bridge/secrets/<name>`, read by `unlockedKeychain` |
| `bridge_config` (JSON) | `/run/belege-bridge/bridge.json`, with the node's WebSocket port and the VM's public name set; `llm`, `lanRelay` and `pairedTokens` removed |
| `bridge_peer_key` (base64 protobuf) | the node's peer key, so the peer id is the one the books know |
| `enablebanking_sealed` | the sealed Enable Banking file |
| `https_hostname`, `acme_email` | Caddy's site and the ZeroSSL contact |

What the bridge writes while it runs (a handover's key, `bridge.json`) stays in that tmpfs, and
Caddy keeps its certificate in `/run/caddy`. Nothing goes onto the rootfs; a restart attests
again and gets everything again. The disk passphrase never reaches the bridge.

## What the measurement covers

As for paperless-anywhere: the launch measurement covers Aleph's SEV-SNP runtime (firmware,
kernel, initrd) and a boot command line that names the owner's address. The browser computes it
with `@le-space/attest-wasm` (`confidentialTrustedExecution`) from Aleph's published runtime and
pins it in the INSTANCE. The image itself is named by its STORE hash in the INSTANCE and opens
only with the image passphrase.

So the unlock (`test/release.mjs`, which `test/attest-live.mjs` runs) sends nothing unless the
INSTANCE is the owner's, boots the published STORE and pins the measurement computed on the
unlocking side; the guest must then prove that measurement in the RA-TLS handshake before the
injection. `bridge/test/unlock.test.js` shows it with a stand-in for the guest's attestation agent:
a VM with a changed runtime, another image, other pins or another owner gets no secret.
`bridge-image.json` (from the workflow) records the STORE hash, the sha256
of the plain image and the pinned inputs.

The plain image is not yet byte-for-byte reproducible (Debian's packages at build time, file
times, the ext4 UUID); the encrypted one cannot be (LUKS salts).

## The plain image, published (#777)

Run with **plain**, the workflow also publishes the image without encryption, as a STORE of its
own: the image after relay-button's confidential conversion and before the encryption, gzipped.
It holds no secret – no key, no passphrase, no account – and is the first piece of an image of
its own per set of books (#777), as in
[Paperless anywhere](https://github.com/Le-Space/paperless-anywhere/blob/main/docs/own-image.md):
what an attested image builder seals with a passphrase from the books. Nothing in the app uses
it yet; the hosted bridge still starts the encrypted image above.

`bridge-image.json` names it under `sealable`: the STORE's hash, the SHA-256 and size of the
image itself (unpacked), the stored size, and GitHub's signed statement that this workflow built
a file with that SHA-256 at that commit. Anyone can compare:

```sh
curl -fsS https://api2.aleph.im/api/v0/messages/<sealable.store> | jq -r '.message.content.item_hash'
curl -fL https://api2.aleph.im/api/v0/storage/raw/<that hash> | gunzip > bridge-plain.ext4
sha256sum bridge-plain.ext4                                    # sealable.sha256
gh attestation verify bridge-plain.ext4 --repo Le-Space/belege
```

A pull request that changes the image converts it too and fails if it has grown beyond what an
image builder takes (Aleph's 1 GiB upload, less what the encryption adds); it publishes nothing.

## Trying it

**Bridge on a confidential node** (`.github/workflows/bridge-try.yml`) creates a VM from a STORE,
forwards 443, attests and unlocks it through a relay's `/attest` with `test/attest-live.mjs`
(the browser's code, in Node), waits for `/bridge/status.json` to say ready with a relay
reservation, dials the node directly and through the relay (`test/dial.mjs`), attests it again
through the VM's own `/attest`, checks what faces the network, and forgets the VM. The bridge
starts unpaired, with nothing but the relay's address; the browser pairs it with the unlock
("Gehostete Bridge" in the app, #585).

Both workflows need the `ALEPH_PRIVATE_KEY` and `BRIDGE_LUKS_PASSPHRASE` secrets; the image
workflow run with **plain** only needs the first.
