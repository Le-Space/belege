# @belege/app

The belege web app: SvelteKit (Svelte 5, static adapter, SPA), all data in the browser.

```bash
pnpm dev          # from the repo root
pnpm test:unit    # vitest, Node
pnpm test:e2e     # Playwright, Chromium with a virtual passkey (PRF)
```

## Architecture (phase 1, step 1)

- **Identity = passkey.** A WebAuthn passkey is the identity: its P-256 key gives the DID
  (`did:key:…`, via `@le-space/orbitdb-identity-provider-webauthn-did`). Create a passkey, or
  restore on a new device from the authenticator alone; the credential (public data only) is kept
  in `localStorage` so a reload only has to unlock.
- **Encryption at rest, from the passkey.** On every unlock the passkey is asked for its PRF output
  (one prompt). HKDF-SHA-256 derives from it the AES-GCM key every database is sealed with
  (`info = belege/db-key/v1`) and the database names (`belege/db-name/v1:<collection>`), so an
  address cannot be guessed from the DID. The provider's OrbitDB signing key is derived from the
  same answer. Nothing derived is stored. No PRF, no data: there is no plaintext fallback.
- **Persistent storage.** Helia on `LevelBlockstore`/`LevelDatastore` (IndexedDB
  `belege/helia-blocks`, `belege/helia-data`), OrbitDB under `belege/orbitdb`.
- **Data layer** (`src/lib/store/`): sealed OrbitDB documents databases `transactions`,
  `receipts`, `partners`, indexed by a ULID `id`; every record has `createdAt`, `updatedAt`,
  `deleted` (soft delete) and `author` (DID); money in integer cents. `sealed-documents.js` exists
  because `@orbitdb/core` 4.0.0 drops the `encryption` option for documents databases.
- **P2P prepared, not used.** libp2p runs with gossipsub for OrbitDB but no transports, no
  bootstrap and no discovery (`src/lib/network.js`); device sync comes later.

Several files are ported from [Le-Space/simple-todo](https://github.com/Le-Space/simple-todo)
`apps/invoice01`; each says so in its header, with what changed.
