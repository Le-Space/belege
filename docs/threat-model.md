# What Belege protects against, and what not

_Deutsch: [threat-model.de.md](threat-model.de.md)_

Belege keeps a company's books in the browser, sealed under keys from the books' root, which your passkey opens ([keys.md](keys.md)). This page says plainly which risks that answers and which it cannot – so you can decide where and how to use it. Weaknesses in Belege itself are reported privately ([SECURITY.md](../SECURITY.md)).

## What Belege protects against

- **Those who store or carry the data.** Aleph Cloud, relays, IPFS nodes, own devices on the way: they get sealed records, sealed log entries and sealed backups, never the keys ([backup.md](backup.md), [device-proof.md](device-proof.md)).
- **A copy of the browser profile or the disk.** No key is kept at rest. Without a passkey of the books or their recovery words, what is stored stays sealed.
- **Devices that are not yours.** Only a device that proves the books' key gets the books, and only when the books know it or someone lets it in.
- **The language model.** Text for a hosted model is redacted first, and a model in an attested enclave reads only there ([ai.md](ai.md)).
- **A stolen bridge, for the books.** The bridge holds bank, mail and model credentials, not the books' keys. Paired by invitation it holds a key of its own that proves it is your bridge and opens no books and no device; "Kopplung lösen" makes it worthless ([keys.md](keys.md#what-the-bridge-holds-and-why)).

## What Belege cannot protect against

- **A device or browser that is not under your control.** Malware, someone using the unlocked device, or a **browser extension** allowed on the site sees what the page sees: the open books, and the passkey's answer at unlock – and with it the keys. That holds for any web app, online banking included. The keys can then only be changed with [new keys for the books](keys.md#new-keys-for-the-books), so this is worth avoiding rather than repairing.
- **A tampered version of the app.** The app comes from belege.le-space.de; a build that was changed on the way could do what an extension could. Each release names its IPFS CID on its release page, so a served build can be compared with the published one.
- **A member who copies what they could read.** A member of the books – the bookkeeping, say – holds the keys to read them and writes under their own name ([keys.md](keys.md#members)). What they have read, or copied, cannot be taken back. Taking a member out ([#614](https://github.com/Le-Space/belege/issues/614)) stops their writes at once, and their devices – a new one too – are let in only if you let them in; reading what comes later, should they get hold of it some other way, stops only with new keys for the books (Settings → Keys, [keys.md](keys.md#new-keys-for-the-books)). Let in only people you would also hand the folder of receipts.
- **Losing every passkey.** Add a second one under _Einstellungen → Schlüssel_, or write down recovery words on paper there ([keys.md](keys.md)).

## What you can do

- **A browser profile only for Belege, without extensions.** The simplest and most effective step. Alternatively, in an existing profile, allow no extension on belege.le-space.de (Chrome: an extension's details → "Site access"; Safari: Settings → Extensions, per website).
- **On Android**, Chrome runs no extensions: Belege installed as an app from there is not exposed to them.
- **Keep the system and the browser up to date**, and lock the device when you leave it.
- **A desktop app** without browser extensions is planned as an alternative to the web app; there is no date yet.
