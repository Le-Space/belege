# Keys and recovery

_Deutsch: [keys.de.md](keys.de.md)_

How Belege gets its keys, what is stored where, and what happens when a passkey is lost.

## The short version

- **Your passkeys open the books.** At every unlock the passkey answers once with its PRF output; with it, it opens its slot in the books' vault, and every key is derived from what the vault holds. None of the keys is stored.
- **Add a second passkey.** Under _Einstellungen → Schlüssel_ – a security key you keep somewhere safe, say. Each passkey has a slot of its own, and every slot opens the same books and every backup, also on an empty device.
- **A synced passkey travels.** One kept in iCloud Keychain or the Google Password Manager opens the same books on every device of that account.
- **Write down recovery words.** 24 words on paper, offered right after the books are made and under _Einstellungen → Schlüssel_. When every passkey is gone, they open the books on an empty device, making a new passkey on the way.
- **No passkey and no words, no books.** With a single passkey that is not synced and no words, its loss means that neither the books nor any backup can be opened again, though the backup itself is still kept on Aleph. The keys page says so while that is the case.

Books have to be kept for years (in Germany 8 years for receipts and 10 for books, § 147 AO): write down recovery words or add a second passkey, and back up regularly.

## The vault

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/keys-vault-en-dark.svg">
  <img src="media/keys-vault-en-light.svg" alt="Each passkey opens its own slot; every slot holds a sealed copy of the same vault key, which opens the root R; every key is derived from R with HKDF. The recovery words open a slot as a passkey does." width="680">
</picture>

- **The root R** is what every key is derived from: the PRF output of the passkey that made the books (32 bytes). Books made before the vault keep exactly the keys they had – the first unlock with the vault puts this very value into it.
- **The vault** keeps R once, sealed under a random vault key (AES-256-GCM).
- **A slot** is that vault key, sealed under a key only its passkey can make: derived from its PRF output, bound to the vault and to that passkey. Any slot opens the vault.
- **Adding a passkey** while the books are open gives it a slot: two prompts, the new passkey and its answer.
- **Removing a passkey** takes its slot out; it is refused from then on. **With renewal**, the vault also gets a new vault key, and every passkey that stays answers once – for a passkey that may be in other hands. What removing cannot do: a passkey that has opened the books knows R, and R cannot change without sealing the books anew; older backups still carry its slot.

## Recovery words

- **What they are:** 24 words after BIP39 – 256 random bits and a checksum – as paperless-anywhere uses them and as the package plans them ([#92](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/92)). Belege draws them, never a person; they are shown once, and the page asks three of them back.
- **Slot W:** the words give the BIP39 seed (PBKDF2-HMAC-SHA512), the seed by HKDF (`belege/vault-slot/words/v1`) the slot's key. Neither the words nor the seed are stored. A vault has at most one set of words; new ones replace the old.
- **On an empty device:** "Mit Wiederherstellungswörtern öffnen" on the lock screen. The words open the vault – from this browser or through their index on Aleph –, a new passkey is made (two prompts) and gets a slot; from then on it unlocks like any other. A misspelt or swapped word is caught by the checksum before anything is made.
- **What they weigh:** as much as every passkey together. Whoever saw them knows R. Renewing the vault takes the words out; make new ones after.

The vault is a record of `@le-space/orbitdb-identity-provider-webauthn-did` (`createVault`, `addSlot`), kept by `app/src/lib/books-vault.js`.

## Where an empty device finds the vault

In this browser the vault record is in `localStorage`, and the same record is in the books' sealed settings (`books/vault`), synced between own devices ([#962](https://github.com/Le-Space/belege/issues/962)). Every device merges what the others wrote into its own: a passkey added on one device counts on all, and one taken out after it was added stays out (the record notes when). A vault renewed on another device is taken at the next unlock. Only entries the books wrote count, never a member's. A renewal counts one generation on, sealed into every slot, and a device never takes a vault older than the one it keeps – of a lower generation, or one its record replaced – wherever that record comes from: the index, an own device, the recovery words. An empty device shown only the old record still opens it; nothing says it was replaced.

**An empty device with a passkey of its own** gets the vault from a device with the books, by QR, after "Zulassen" there – no server involved ([device-proof.md](device-proof.md#a-device-with-a-passkey-of-its-own-962)). If the books keep their vault on Aleph, that device later publishes its passkey's own index there too, since only it has that passkey's answer.

On an empty device, a passkey finds it on Aleph, if it was kept there (_Einstellungen → Schlüssel_, or the question asked once after the first backup – with a single passkey too, [#1049](https://github.com/Le-Space/belege/issues/1049) –, and after each backup from then on):

- **at its own index** – an address derived from that passkey's PRF output, where the vault was put when the passkey got its slot;
- **at the words' index** – an address derived from the recovery words' seed, likewise;
- **at the books' index** – an address derived from R, with the current vault and, sealed, the Aleph account the backups are kept for;
- **at its memberships' index** – for a member ([below](#members)): an address derived from that passkey's PRF output under another label, with each member vault the passkey opens and, sealed under the member's root, the account the books' backups are kept for. Written when the member backs up.

Both are sealed, signed by keys only the passkey or R lead to, and carry no names, no wallet: beside the vault only each slot's credential id and date (`app/src/lib/backup/vault-index.js`). "Mit vorhandenem Passkey wiederherstellen" asks there, unless the network is paused; then the books open with their keys, and "Wiederherstellen" lists the backups.

**A device that founded books of its own** ([#524](https://github.com/Le-Space/belege/issues/524)): a passkey that already has a slot in a vault made elsewhere, opened here without "Wiederherstellen" or with the network paused, gets new, empty books, and a backup of the others is refused as another vault's. From then on the browser has a vault for that passkey and does not ask Aleph by itself. The passkey's own index is asked again in three cases, never while the network is paused: after a backup was refused as another vault's; when you press "Bei Aleph nachfragen" under _Einstellungen → Schlüssel_; and at an unlock of books that hold no booking and no receipt, on a device with device sync on over the public relays. What the index names counts only if this passkey's slot opens it and it holds another root than the books open. Then the other books are offered. On your yes the page reloads, the passkey answers once, and that unlock asks the index again, opens the other vault and keeps it; the vault founded here stays in `localStorage`, set aside for this passkey (`aside`), so nothing is deleted. If anything fails on the way, the books from before open.

**A restore that finds no books** ([#555](https://github.com/Le-Space/belege/issues/555)): when neither this browser nor Aleph has a vault with a slot for the passkey – or the network is paused and Aleph was not asked –, "Wiederherstellen" asks before it opens the books this passkey makes. A passkey that made books gets them, empty until an own device syncs them or a backup is restored. A passkey added to books elsewhere whose vault was never kept on Aleph would get new, empty books: cancel, keep the vault on Aleph there, and try again. On "Abbrechen" nothing is opened or kept, and the passkey is forgotten in this browser again.

**Two vaults of the same books** ([#555](https://github.com/Le-Space/belege/issues/555)): a device set up before the vault was kept on Aleph, or with the network paused, makes a vault of its own for the same books – the same root, another vault. Before such a device changes its vault or keeps it on Aleph, it reads the books' index: when that holds another vault of the same books which this passkey opens, the device takes it, with what it knows of the slots, rather than publishing over it. A passkey only its own vault had still opens the books in this browser (that vault stays, set aside); _Einstellungen → Schlüssel_ names it, so it can be added again. When the vault there has no slot for this passkey, nothing is published. A vault this browser renewed itself is replaced, as before. On an empty device, a passkey whose own index names one vault and the books' index another without its slot is refused, but not remembered as removed: once a vault with its slot is published, it gets in.

## What comes from R

HKDF-SHA-256 derives each key from R under a label of its own (`app/src/lib/database-keys.js`); the main ones:

| Key              | Label                                    | Used for                                                                           |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Database key     | `belege/db-key/v1`                       | sealing every record                                                               |
| Replication key  | `belege/replication-key/v1`              | sealing every log entry as a whole                                                 |
| Database names   | `belege/db-name/v2`                      | naming the databases, so no name says what they hold                               |
| Receipt-file key | `belege/blob-key/v1`                     | sealing receipt files and mails                                                    |
| Backup key       | `belege/backup-key/v1`                   | sealing a backup before it leaves                                                  |
| Books' secret    | `belege/books-secret/v1`                 | the books' own identity, the writer of every collection (#496)                     |
| Device proof     | `belege/device-auth/v1`                  | own devices proving they hold the books' keys ([device-proof.md](device-proof.md)) |
| Bridge key       | `belege/bridge-auth/v1` and a generation | the one key that leaves the browser: the bridge proves itself with it (below)      |

One key reveals nothing about another.

## What is stored where

| What                                | Where                                                                       | In what form                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF output, R and every derived key | memory, while the books are open                                            | plain, gone when the tab closes                                                                                                                 |
| the vault                           | `localStorage` of this site; the books' sealed settings; on Aleph if chosen | sealed; the passkeys' names in this browser and in the sealed settings, never on Aleph                                                          |
| the books                           | IndexedDB of this site                                                      | sealed per record and per entry                                                                                                                 |
| receipt files                       | IndexedDB of this site                                                      | sealed                                                                                                                                          |
| passkey details, flags              | `localStorage` of this site                                                 | public: credential id, public key, DID, PRF input                                                                                               |
| backups                             | Aleph Cloud                                                                 | sealed with the backup key ([backup.md](backup.md))                                                                                             |
| the books' Aleph key                | the sealed settings of the books                                            | sealed; signs backup orders and, when switched on, Le Space Credits requests – its address is the Credits account, the same on every own device |
| the passkey's private key           | the authenticator                                                           | never leaves it                                                                                                                                 |
| the bridge's key                    | the bridge's keychain (`bridge-auth`)                                       | only if the bridge was paired by invitation                                                                                                     |
| a member vault                      | `localStorage` of the member's browser; on Aleph after a member's backup    | sealed under the member's passkey                                                                                                               |

**How this is checked.** After a session with a passkey, a bank statement and a reload, a test reads everything this site keeps – IndexedDB, `localStorage`, `sessionStorage` and the service worker's cache – and looks for every key of the session, in each way bytes can be written down, and for lines of the statement. It runs in CI against the build that is published (`app/e2e-production`), which has no test hook to ask for its keys: the test listens where keys pass through the browser's cryptography instead. The published files themselves are read for test hooks before each deploy (`scripts/check-production-build.mjs`).

## What the bridge holds, and why

The bridge is a small program on your computer. It does what a browser may not: ask your bank,
your mailbox and a language model, and keep running when the tab is closed. For that it needs
their passwords and keys. They stay on that computer, in its keychain, and never go to the
browser ([bridge/README.md](../bridge/README.md#where-things-are-kept)).

It never gets a key of your books. The keys above stay in the browser, with one exception: if you
pair the bridge by invitation, so your phone reaches it through a relay, a device gives it a key
of its own. With that key the bridge proves to your devices that it is your bridge. It opens
nothing else: no books, no other device. "Kopplung lösen" moves the books to a new generation of
that key, and the old one is then worth nothing.

So whoever takes your computer with the bridge gets what the bridge holds – bank, mail, model –
but not your books. That is why a backup of the books needs the passkey or the recovery words,
not the bridge.

The other way round, the bridge limits what a device may do with it ([#579](https://github.com/Le-Space/belege/issues/579)):

- Each command belongs to an area, such as reading the bank, reading the mailbox or the language model. A device may only use the areas it holds.
- When you add a device under _Integrationen → Eigene Geräte → Erweitert_ while the books have a bridge, you tick there first which areas it gets – all are ticked to begin with. The bridge gives a device exactly these when it first sees it; it takes the choice when the device that paired it next sends the device list. A device added before, without a choice, or through admitting a member holds all areas, as before (a member's only if you allowed the bridge). The device that paired the bridge ticks, per device, which areas it keeps under _Integrationen → Eigene Geräte → Erweitert_; any other device sees only its own there. When a device lacks an area, the bridge refuses the command and the app says which area is missing – it does not try another way. Only that device may set the areas, and it cannot take that right from itself. On the bridge's machine the owner can do it too, with the token (`POST /node/scopes`).
- A member has access only if you allowed it when admitting them.
- A device that does not use the bridge for 90 days loses access. The device that paired the bridge renews it under _Integrationen → Eigene Geräte → Erweitert_.
- The bridge counts per device and command how often it was allowed or refused, and when last. You see it under _Integrationen → Eigene Geräte → Erweitert_. Only the command, the count and the time are kept, never content; the count goes with the device.
- What costs money is limited per device: calls to the language model a minute, its tokens a day and backups an hour. So a stolen phone cannot run down your credit before you remove it.

## Members

The books can let a second person in – the bookkeeping, say ([#6](https://github.com/Le-Space/belege/issues/6)). That person keeps their own passkey and their own books; they get a **key bundle** for yours.

```mermaid
sequenceDiagram
    autonumber
    participant M as Bookkeeping's device
    participant O as Owner's device
    M->>M: new member root, one-time x25519 key
    M-->>O: join code (by mail, chat or QR): one-time public key, member's DID, device id
    Note over M,O: the owner compares the code's check with the bookkeeping's screen
    O->>O: write access for the member's DID, member and device in the books
    O-->>M: answer: the key bundle, sealed to the one-time key
    Note over M,O: the bookkeeping compares the books' check with the owner's screen
    M->>M: member vault: bundle + member root, sealed under the member's passkey
    Note over M,O: from the next unlock: "Bücher, in denen ich Mitglied bin"
```

So both sides compare a check before anything is written or kept ([#640](https://github.com/Le-Space/belege/issues/640)). If it differs, the code or the answer was swapped on the way, and you stop.

**What the bundle holds:** the database key, the replication key, the receipt-file key, the device-proof key – and for a member who writes the backup key, and if they may use the bridge the bridge key's base –, the databases' names and addresses, and the books' public identity. **What it never holds:** R, the books' secret, the vault key, a passkey slot or the recovery words.

**Two roles** ([#641](https://github.com/Le-Space/belege/issues/641)), chosen when admitting:

- **Writes along** – the bookkeeping, or an assistant who works in the books: reads, writes under their own name (a DID from their own root, which the books' access lists allow), backs up and restores. Reaching the owner's bridge (bank, mailbox, AI) is a tick when admitting; without it the bundle holds no bridge key.
- **Reads along** – an assistant who follows the books: the keys to read and sync only – no write access in any access list, no backup key, no bridge key. Their session opens the books read-only; every write is refused there, and by every device.

**What stays with the owner:** passkeys and recovery words of the books, moving the books, letting members in and taking them out.

**The member vault** works like the books' vault: the bundle and the member's own root, sealed under a vault key, with a slot for the member's passkey. It lies in the member's browser (`belege.memberships.v1`) and, after the member's first backup, at the memberships' index on Aleph – sealed, without names. On an empty device the member's passkey finds it there ([backup.md](backup.md#members-back-up-and-restore)).

**Taking a member out** (_Integrationen → Zusammenarbeit_, [#614](https://github.com/Le-Space/belege/issues/614)): what they wrote so far stays; anything they write after is refused by every device of the books; their devices so far leave the device list and are refused, and their old join code no longer works. A setting only the owner sets (where the backups are kept and who signs them, the bridge, how devices meet, the vault on Aleph, the invoicing app) is put back if they changed it. The write access is not revoked in OrbitDB – it checks old entries against the current list too, and the member's earlier entries would no longer replicate. Instead every collection's access list gets `removed:<their DID>` with the hashes of their entries so far, and an entry of theirs counts only if it is one of those (`app/src/lib/store/books-access.js`).

**What cannot be taken back:** what the member has read. With the keys in their bundle they could also read later entries, if they got hold of them, until the books get [new keys](#new-keys-for-the-books).

## New keys for the books

_Einstellungen → Schlüssel → Neue Schlüssel für die Bücher_ ([#627](https://github.com/Le-Space/belege/issues/627)) – after a member was taken out, or when a passkey may be in other hands:

1. A new random root R′, in a new vault with a slot for every passkey you tick (each answers once). The earlier roots stay inside, sealed.
2. The books are packed in this browser as a move does, sealed under a key from R′, and kept in IndexedDB until they are taken over.
3. The new vault goes into the old books. It holds nothing secret in the clear; only a passkey with a slot opens it.
4. The page reloads; one unlock opens new databases under R′ – new names, new keys, a new identity of the books – and they take the packed books over. The pack is deleted.
5. Another device of yours finds the new vault in the old books and switches, if its passkey has a slot; it then dials this device. A device follows that note only when the books themselves wrote it, not a member ([#638](https://github.com/Le-Space/belege/issues/638)).

What does not come along: the recovery words (write down new ones), members (they join again with a new join code), the bridge pairing (pair again), the backup chain (the next backup is a full one). Backups made before still restore ([#628](https://github.com/Le-Space/belege/issues/628)): the backup opens with the earlier root kept in the vault, only entries the books of that time signed count, and they add only records today's books do not have – no settings –, the receipt files sealed anew. A passkey you did not tick, and a member taken out, keep only the old books, which get nothing new.

## Passkey prompts

- **Create:** two – the passkey, then its PRF output.
- **Unlock:** one – the PRF output.
- **Restore on a new device:** three – two touches that find the passkey and its DID, then the PRF output.
- **Add a passkey:** two – the new passkey, then its PRF output.
- **Remove with renewal:** one for each passkey that stays.
- **Open with recovery words:** two – the new passkey, then its PRF output.
