# Backup on Aleph Cloud

_Deutsch: [backup.de.md](backup.de.md)_

A backup holds everything Belege keeps in this browser: the eight databases of the books and every receipt file, including those that came by mail. It is one file, sealed with a key from your passkey. Aleph Cloud keeps it. Only the same passkey can open it, not even Aleph.

## What you need to restore

On an empty device, two things:

1. **The same passkey.** The backup's key is derived from the passkey it was made with. Another passkey does not open it ("mit einem anderen gemacht").
2. **The address of the Aleph account that pays**, or the backup's CID. Belege finds the backups through the account: it asks Aleph for that account's STORE messages on the channel `BELEGE-BACKUP`. The address is public, but on an empty device it is the only way to the backups, so write it down. `pnpm setup:aleph` shows it, and a paired bridge names it by itself.

## Set up once

1. In the terminal, in Belege's folder: `pnpm setup:aleph`. The bridge makes a backup key of its own and keeps it in the keychain. It prints the key's address, never the key itself. That address is the Aleph account that pays for keeping the backups. It is not your wallet.
2. Put credits on that address (app.aleph.cloud → Credits).
   - A backup is paid in credits. Aleph keeps it only while the account has them.
   - Aleph refuses a new backup when the account has less than a day of it (about 54 credits per MiB and day). The page then says how many credits it takes.
   - Credits are drawn by the hour. No tokens move per backup, and ALEPH held on the account does not pay for it.
3. Restart the bridge (`pnpm bridge`) and pair it. _Integrationen → Backup_ keeps the account's address in the settings.
4. Allow this browser's key. The page shows it and the command:

   ```sh
   pnpm setup:aleph -- --authorize <address> --channel BELEGE-BACKUP
   ```

   From then on the browser signs the order to Aleph itself, and the bridge need not run for a backup. Until then the bridge signs, as before.

## Back up

_Integrationen → Backup → "Jetzt sichern"_.

1. The browser packs and seals the backup.
2. It uploads the file directly to Aleph's IPFS host.
3. Aleph is asked to keep the file, with a STORE message for the account, paid in credits. This browser's key signs that message once the account has allowed it; otherwise the bridge signs it with its backup key.

The backup never passes through the bridge. The page shows the backup's CID; keep it somewhere.

This browser's key is made here and kept sealed in the settings, as the bridge token is. It goes with the books to your own devices and into every backup. A stolen key could only have Aleph keep files on that one channel at the account's expense. It opens no backup, since those are sealed with the passkey's key, and it moves no funds. `pnpm setup:aleph -- --revoke <address>` takes the grant back.

## Restore

_Integrationen → Backup → "Wiederherstellen"_, after unlocking with **the same passkey**. On a new device that means "Mit vorhandenem Passkey wiederherstellen".

The list shows:

- the backups kept for the account, whether the bridge or an allowed key sent them. The browser asks Aleph directly, without the bridge. The address comes from the settings or the paired bridge, or you enter it;
- the backups made from this browser.

A CID can also be typed. After a question, the browser fetches the sealed file from Aleph's gateway, opens it with the key from the passkey and puts every database and receipt file back. It **merges**: what is in the books here stays, what the backup holds is added, nothing is deleted. The page then reloads, and the passkey opens the books again.

A backup made with another passkey cannot be opened ("mit einem anderen gemacht"), and one that holds other books is refused.

## Let another key back up

An application can back up from the browser without the bridge running. It holds a key of its own, and the bridge's account lets that key keep backups at its expense. Belege itself does this (channel `BELEGE-BACKUP`, above), and so does Le Space Invoice (channel `INVOICE-BACKUP`, Le-Space/invoice#28). Both show their key's address and the command.

```sh
pnpm setup:aleph -- --authorize <address> --channel INVOICE-BACKUP   # may keep backups on that channel
pnpm setup:aleph -- --grants                                         # who may
pnpm setup:aleph -- --revoke <address>                               # take it back
```

A grant is an entry in the account's `security` aggregate on Aleph, signed with the bridge's backup key: STORE only, on the named channel only. Aleph charges the bridge's account for what that key keeps, not the key (measured 2026-10-03). The list of backups asks Aleph by the paying account, so what such a key kept is in it too.

## What leaves

- **To Aleph's IPFS host, from the browser:** the sealed file. Aleph sees its size and this computer's IP address, not what is in it.
- **To the Aleph API, from the browser:**
  - the STORE message, with the address of this browser's key, the account's and the file's CID;
  - reads of the account's grants, its credits and its list of backups, by its address.
- **To the Aleph API, from the bridge:**
  - without the grant, the STORE message with the address of its backup key and the file's CID;
  - on `--authorize` and `--revoke`, the list of keys the account allows.

## Technical

- **Content:** every block exactly as it is stored. A restore therefore brings back the same CIDs, the same signed entries and the same writer:
  - each database's log entries (already sealed with the database key), its manifest and access controller, and every writer's identity;
  - each receipt file's root and 1 MiB chunks (already sealed with the blob key);
  - a dag-cbor manifest: the storage bridge's metadata (each database with address, manifest and heads, from `bundleDatabases`), the receipt files, the app version and the date.
- **Restore:**
  - the storage bridge's `restoreFromBlocks` puts the databases back from the opened backup;
  - if a head cannot be joined, the restore stops with the reason instead of reporting success.
- **Entries from earlier sessions:**
  - OrbitDB 4.0.0 remembers verified identities by `signatures.id` and refuses a different one with the same id;
  - a passkey identity has the same `signatures.id` in every session but a new WebAuthn assertion, so entries from an earlier session (from a backup, or synced from an own device) were refused;
  - Belege checks such an identity again the way OrbitDB checks an unstored one (shape, id signature, passkey binding in the provider), only without that comparison ([orbitdb/orbitdb#1258](https://github.com/orbitdb/orbitdb/issues/1258); `session-identities.js`).
- **Format:** a CAR file, written by `@le-space/orbitdb-storage-bridge`, sealed as a whole with AES-256-GCM. The key is derived with HKDF from the passkey's PRF result (`belege/backup-key/v1`). The file is `belegeB1 ‖ nonce ‖ ciphertext`.
- **Upload:** the storage bridge's `aleph` backend, `POST https://ipfs.aleph.cloud/api/v0/add`, with no key.
- **Keeping:**
  - A STORE message on the channel `BELEGE-BACKUP`, signed with `personal_sign`. `content.address` is the paying account, and it is paid in credits (`payment: { type: "credit" }`, storage bridge 0.17.0). Without that field Aleph books it as `hold`, which only ALEPH held on the account covers.
  - With the grant, the browser sends it itself (`backup/keeper.js`), with its secp256k1 key from the sealed settings (`backup/aleph-key`). It follows a `pending` answer until Aleph has decided; a refusal names the credits there are and the credits a day takes.
  - Without the grant, the bridge sends it (`POST /backup/aleph/pin`, [bridge/README.md](../bridge/README.md)). A refusal comes back from there as HTTP 402 `ALEPH_BACKUP_REJECTED`.
- **List:** the browser asks Aleph's messages API with `owners=` (the paying account) instead of `addresses=` (the sender), so STORE messages another key sent for the account are included. The paired bridge names the account and, in tests, Aleph's addresses (`GET /backup/status`).
- **Missing blocks:** nothing is fetched from the network for a backup. A block this browser does not have counts as missing, and the page says so.
