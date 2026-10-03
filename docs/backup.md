# Backup on Aleph Cloud

_Deutsch: [backup.de.md](backup.de.md)_

A backup holds everything Belege keeps in this browser: the eight databases of the books and every receipt file, including those that came by mail. It is one file, sealed with a key from your passkey. Aleph Cloud keeps it, and nobody without your passkey can open it, Aleph included.

## Set up once

1. In the terminal, in Belege's folder: `pnpm setup:aleph`. The bridge makes a backup key of its own and keeps it in the keychain. It prints the key's address, never the key itself. That address is the Aleph account that pays for keeping the backups. It is not your wallet.
2. Put credits on that address (app.aleph.cloud → Credits), or send it ALEPH. Aleph keeps a backup only while the account can pay. No tokens move per backup: Aleph checks that the account can pay.
3. Restart the bridge (`pnpm bridge`).

## Back up

_Integrationen → Backup → "Jetzt sichern"_. The browser packs and seals the backup, uploads it directly to Aleph's IPFS host and asks the bridge to have Aleph keep it. The bridge signs that order (a STORE message) with its backup key. The backup never passes through the bridge.

The page shows the backup's CID; keep it somewhere.

## Restore

_Integrationen → Backup → "Wiederherstellen"_, after unlocking with **the same passkey** (on a new device, "Passkey wiederherstellen"). The list shows:

- the backups the bridge's Aleph account had kept (pair the bridge again: an empty browser has no pairing);
- the backups made from this browser.

A CID can also be typed. After a question, the browser fetches the sealed file from Aleph's gateway, opens it with the key from the passkey and puts every database and receipt file back. It **merges**: what is in the books here stays, what the backup holds is added, nothing is deleted. The page then reloads, and the passkey opens the books again.

A backup made with another passkey cannot be opened ("mit einem anderen Passkey gemacht"), and one that holds other books is refused.

## What goes out

- **To Aleph's IPFS host, from the browser:** the sealed file. Aleph sees its size and this computer's IP address, not what is in it.
- **To the Aleph API, from the bridge:** the STORE message with the backup key's address and the file's CID.

## Technical

- **Contents:** every block exactly as it is stored, so a restore brings back the same CIDs, the same signed entries and the same writer:
  - each database's log entries (already sealed with the database key), its manifest and access controller, and the identity of every writer;
  - each receipt file's root and 1 MiB chunks (already sealed with the blob key);
  - a dag-cbor manifest: the storage bridge's metadata (every database with its address, manifest and heads, from `bundleDatabases`), the receipt files, the app version and the date.
- **Restoring:** the storage bridge's `restoreFromBlocks` puts the databases back from the opened backup. A head it cannot join stops the restore with the reason, instead of reporting success.
- **Earlier sessions' entries:** OrbitDB 4.0.0 caches a verified identity by `signatures.id` and refuses another identity with the same id that differs. A passkey's identity has the same `signatures.id` in every session but a new WebAuthn proof, so entries from an earlier session (in a backup, or synced from an own device) were refused. Belege checks such an identity again the way OrbitDB checks an uncached one (shape, id signature, the provider's passkey binding), without the comparison ([orbitdb/orbitdb#1258](https://github.com/orbitdb/orbitdb/issues/1258); `session-identities.js`).
- **Format:** a CAR file written by `@le-space/orbitdb-storage-bridge`, sealed as a whole with AES-256-GCM. The key is derived from the passkey's PRF output with HKDF (`belege/backup-key/v1`). The file is `belegeB1 ‖ nonce ‖ ciphertext`.
- **Upload:** the storage bridge's `aleph` backend, `POST https://ipfs.aleph.cloud/api/v0/add`, no key needed.
- **Keeping it:** the bridge signs the STORE message with `personal_sign` on the channel `BELEGE-BACKUP` (`POST /backup/aleph/pin`, [bridge/README.md](../bridge/README.md)).
- **Missing blocks:** nothing is fetched from the network for a backup. A block this browser lacks is counted as missing, and the page says so.
