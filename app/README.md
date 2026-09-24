# @belege/app

The belege web app: SvelteKit (Svelte 5, static adapter, SPA), all data in the browser.

```bash
pnpm dev          # from the repo root
pnpm test:unit    # vitest, Node
pnpm test:e2e     # Playwright, Chromium with a virtual passkey (PRF)
```

## Architecture (phase 1, steps 1 to 3)

- **Identity = passkey.** A WebAuthn passkey is the identity: its P-256 key gives the DID
  (`did:key:…`, via `@le-space/orbitdb-identity-provider-webauthn-did`). Create a passkey, or
  restore on a new device from the authenticator alone; the credential (public data only) is kept
  in `localStorage` so a reload only has to unlock.
- **Encryption at rest, from the passkey.** On every unlock the passkey is asked for its PRF output
  (one prompt). HKDF-SHA-256 derives from it the AES-GCM key every database is sealed with
  (`info = belege/db-key/v1`) and the database names (`belege/db-name/v1:<collection>`), so an
  address cannot be guessed from the DID; receipt files get a key of their own
  (`belege/blob-key/v1`). The provider's OrbitDB signing key is derived from the same answer. Nothing derived is stored. No PRF, no data: there is no plaintext fallback.
- **No private key at rest.** The OrbitDB signing key (secp256k1, the provider's default) is
  derived again from that same PRF answer at every unlock and lives in a session-only keystore
  (`src/lib/session-identities.js`); the libp2p peer key is a fresh Ed25519 key per session with no
  datastore to land in (`src/lib/network.js`). The keystore database an earlier build wrote
  (`belege/orbitdb/keystore`) is deleted at unlock. What stays in `localStorage` is public: the
  credential (id, public key, DID, PRF input) and the passkey's signature over the identity
  (`webauthn-identity-proof:*`), which keeps the identity document, and so the identity, stable.
  Passkey prompts: create 3, unlock 1, restore on a new device 4.
- **Persistent storage.** Helia on `LevelBlockstore`/`LevelDatastore` (IndexedDB
  `belege/helia-blocks`, `belege/helia-data`), OrbitDB logs under `belege/orbitdb`; no keystore.
- **Data layer** (`src/lib/store/`): sealed OrbitDB documents databases `transactions`,
  `receipts`, `partners`, `accounts`, `settings`, indexed by a ULID `id`; every record has `createdAt`, `updatedAt`,
  `deleted` (soft delete) and `author` (DID); money in integer cents. `sealed-documents.js` exists
  because `@orbitdb/core` 4.0.0 drops the `encryption` option for documents databases.
- **P2P prepared, not used.** libp2p runs with gossipsub for OrbitDB but no transports, no
  bootstrap and no discovery (`src/lib/network.js`); device sync comes later.

Several files are ported from [Le-Space/simple-todo](https://github.com/Le-Space/simple-todo)
`apps/invoice01`; each says so in its header, with what changed.

## Interface

- **Look**: the Le-Space brand tokens and layout of Le-Space/simple-todo `apps/escrow01`
  (`src/app.css`), light and dark (`.dark` on `<html>`, chosen in the header). Two brand values
  miss WCAG AA for text and are adjusted there; `src/lib/contrast.spec.js` checks every text pair.
- **Consent first** (`src/lib/ConsentModal.svelte`): on a first visit, before the passkey. Plain
  sentences for everyone, the technical detail only with "Technisch" (`technical-view.js`).
  "Verstanden" stores the flag `belege.consent`; the footer and "Nur dieses Gerät" reopen it.
  Bump `CONSENT_VERSION` in `consent.js` when what it says changes.
- **Strings** live in `src/lib/i18n/de.js`; English is one more file of the same shape.
- **Footer**: "Gebaut mit Le Space", the build commit and its instant (from `git log`, in the
  reader's zone, UTC on hover) and "Quellcode" linking to this repository.

## Bank import (step 2)

- **Hibiscus through the bridge** (`src/lib/bridge/`, `src/lib/bank/hibiscus-sync.js`): pair on
  Integrationen with the code the bridge prints; the token goes into the sealed `settings`
  collection. A sync asks for 90 days the first time, then from a week before the last sync.
- **CAMT.053** (`src/lib/bank/camt.js`): parsed in the browser with `DOMParser`; the account comes
  from the statement's IBAN, kept only as its last four digits and a hash.
- **No duplicates** (`src/lib/bank/import.js`): matched by source, account and source id, else by a
  fingerprint of account, date, amount, purpose and counterparty (the bridge computes the same),
  with a repeat count so two identical bookings on one day stay two. Re-imports update changed
  bookings and skip the rest; soft-deleted bookings do not come back.
- **Zahlungen**: months with count and receipt coverage, bookings by day, search, account filter,
  "Nur ohne Beleg"/"Alle".
- The E2E spec `e2e/bank-import.spec.js` runs a fake Hibiscus and the real bridge in test mode.

## Receipts (step 3)

- **Sources** (Belege page): "E-Mails abrufen" asks the bridge for the mails to the accounting
  address in the chosen months (default: this month and the last) and imports every PDF or image
  attachment as one receipt, and a mail without one as a receipt of its text; parts already
  imported are not downloaded again. "Belege hochladen" (button or drag & drop) and "Ordner
  freigeben" (File System Access API, Chromium only; the handle is kept unencrypted in IndexedDB
  `belege/folder`, read permission is asked again each session) add files.
- **Sealed files** (`src/lib/receipts/blob-store.js`): a file is sealed with AES-GCM under the blob
  key (HKDF `belege/blob-key/v1` from the PRF answer, a fresh nonce per file), cut into 1 MiB raw
  blocks, and listed by a dag-cbor root block in Helia's blockstore; the root CID is the record's
  `fileCid`. No block holds plaintext; reads never go to the network.
- **Records** (`receipts`): `source` (`mail`/`upload`/`folder`), `sourceRef`, `mailId`,
  `receivedAt`, `from`, `subject`, `excerpt`, `fileCid`, `fileName`, `mime`, `size`, `sha256` (of
  the plaintext, for dedup), `authVerdict`, `outgoing`, `confirmedByUser`, `extraction` (the LLM's
  JSON), `extractionModel`, `extractionError`, `vendor`, `amountCents`, `currency`, `documentDate`,
  `invoiceNumber`, `status` (`neu`, `ausgelesen`, `rückfrage`, `zugeordnet`, `ignoriert`), plus the
  common fields. No duplicates by `sha256`, soft-deleted ones included.
- **Auslesen**: the PDF's text layer (pdf.js via unpdf, `isEvalSupported: false`) goes to the
  bridge with subject, sender and file name as hints; the bridge redacts, asks the LLM, checks the
  answer. The file never leaves the browser. "Alle neuen auslesen" runs them one by one.
- **Unverified senders**: a mail whose sender did not pass DKIM/SPF (and that is not from Sent)
  comes in as `rückfrage` with a warning; it is neither previewed nor read until confirmed, and
  the bridge checks the same on its side.
- **View**: sources with counts, receipts by month ("Ohne Datum" last), search (vendor, amount in
  both spellings, date, invoice number, file), status badges ("Nicht zugeordnet" once read), page 1
  of a PDF on a canvas, images as they are, a mail's text.
- The E2E spec `e2e/receipts.spec.js` runs a fake IMAP server with a synthetic mailbox, a fake LLM
  and the real bridge in test mode.

### Gaps

- **Images**: no OCR yet; photographed receipts are stored and shown ("Bild – Auslesen folgt").
  Scanned PDFs without a text layer are marked the same way.
- **HTML-only invoices**: a mail without an attachment is read from its first 2 KB of text only;
  longer HTML invoices lose their tail, and tables lose their layout.
- **Portal downloads**: "your invoice is online" mails only link to a vendor portal; the receipt
  itself has to be downloaded by hand and uploaded.
- **Tables**: pdf.js glues table rows together (docs/phase-0.md); dates in tables can be read
  wrong. Invoice numbers are compared with separators stripped only once matching comes (step 4).
- The folder is read when you press the button, not watched.
