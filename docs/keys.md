# Keys and recovery

_Deutsch: [keys.de.md](keys.de.md)_

How Belege gets its keys, what is stored where, and what happens when a passkey is lost.

## The short version

- **Your passkeys open the books.** At every unlock the passkey answers once with its PRF output; with it, it opens its slot in the books' vault, and every key is derived from what the vault holds. None of the keys is stored.
- **Add a second passkey.** Under _Einstellungen → Schlüssel_ – a security key you keep somewhere safe, say. Each passkey has a slot of its own, and every slot opens the same books and every backup, also on an empty device.
- **A synced passkey travels.** One kept in iCloud Keychain or the Google Password Manager opens the same books on every device of that account.
- **Lose every passkey and you lose the books.** With a single passkey that is not synced, its loss means that neither the books nor any backup can be opened again, though the backup itself is still kept on Aleph. The keys page says so while the books have only one.

Books have to be kept for years (in Germany 8 years for receipts and 10 for books, § 147 AO): add a second passkey, and back up regularly. Recovery words on paper are planned as one more slot.

## The vault

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/keys-vault-en-dark.svg">
  <img src="media/keys-vault-en-light.svg" alt="Each passkey opens its own slot; every slot holds a sealed copy of the same vault key, which opens the root R; every key is derived from R with HKDF. Recovery words are planned as one more slot." width="680">
</picture>

- **The root R** is what every key is derived from: the PRF output of the passkey that made the books (32 bytes). Books made before the vault keep exactly the keys they had – the first unlock with the vault puts this very value into it.
- **The vault** keeps R once, sealed under a random vault key (AES-256-GCM).
- **A slot** is that vault key, sealed under a key only its passkey can make: derived from its PRF output, bound to the vault and to that passkey. Any slot opens the vault.
- **Adding a passkey** while the books are open gives it a slot: two prompts, the new passkey and its answer.
- **Removing a passkey** takes its slot out; it is refused from then on. **With renewal**, the vault also gets a new vault key, and every passkey that stays answers once – for a passkey that may be in other hands. What removing cannot do: a passkey that has opened the books knows R, and R cannot change without sealing the books anew; older backups still carry its slot.

The vault is a record of `@le-space/orbitdb-identity-provider-webauthn-did` (`createVault`, `addSlot`), kept by `app/src/lib/books-vault.js`.

## Where an empty device finds the vault

In this browser the vault record is in `localStorage`. On an empty device, a passkey finds it on Aleph, if it was kept there (_Einstellungen → Schlüssel_, and after each backup from then on):

- **at its own index** – an address derived from that passkey's PRF output, where the vault was put when the passkey got its slot;
- **at the books' index** – an address derived from R, with the current vault and, sealed, the Aleph account the backups are kept for.

Both are sealed, signed by keys only the passkey or R lead to, and carry no names, no wallet: beside the vault only each slot's credential id and date (`app/src/lib/backup/vault-index.js`). "Mit vorhandenem Passkey wiederherstellen" asks there, unless the network is paused; then the books open with their keys, and "Wiederherstellen" lists the backups.

## What comes from R

HKDF-SHA-256 derives each key from R under a label of its own (`app/src/lib/database-keys.js`); the main ones:

| Key              | Label                       | Used for                                                                           |
| ---------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Database key     | `belege/db-key/v1`          | sealing every record                                                               |
| Replication key  | `belege/replication-key/v1` | sealing every log entry as a whole                                                 |
| Database names   | `belege/db-name/v2`         | naming the databases, so no name says what they hold                               |
| Receipt-file key | `belege/blob-key/v1`        | sealing receipt files and mails                                                    |
| Backup key       | `belege/backup-key/v1`      | sealing a backup before it leaves                                                  |
| Books' secret    | `belege/books-secret/v1`    | the books' own identity, the writer of every collection (#496)                     |
| Device proof     | `belege/device-auth/v1`     | own devices proving they hold the books' keys ([device-proof.md](device-proof.md)) |

One key reveals nothing about another.

## What is stored where

| What                                | Where                                           | In what form                                          |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| PRF output, R and every derived key | memory, while the books are open                | plain, gone when the tab closes                       |
| the vault                           | `localStorage` of this site; on Aleph if chosen | sealed; with the passkeys' names only in this browser |
| the books                           | IndexedDB of this site                          | sealed per record and per entry                       |
| receipt files                       | IndexedDB of this site                          | sealed                                                |
| passkey details, flags              | `localStorage` of this site                     | public: credential id, public key, DID, PRF input     |
| backups                             | Aleph Cloud                                     | sealed with the backup key ([backup.md](backup.md))   |
| the passkey's private key           | the authenticator                               | never leaves it                                       |

## Passkey prompts

- **Create:** two – the passkey, then its PRF output.
- **Unlock:** one – the PRF output.
- **Restore on a new device:** three – two touches that find the passkey and its DID, then the PRF output.
- **Add a passkey:** two – the new passkey, then its PRF output.
- **Remove with renewal:** one for each passkey that stays.
