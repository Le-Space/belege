# What Belege protects against, and what not

_Deutsch: [threat-model.de.md](threat-model.de.md)_

Belege keeps a company's books in the browser, sealed under keys from a passkey ([keys.md](keys.md)). This page says plainly which risks that answers and which it cannot – so you can decide where and how to use it. Weaknesses in Belege itself are reported privately ([SECURITY.md](../SECURITY.md)).

## What Belege protects against

- **Those who store or carry the data.** Aleph Cloud, relays, IPFS nodes, own devices on the way: they get sealed records, sealed log entries and sealed backups, never the keys ([backup.md](backup.md), [device-proof.md](device-proof.md)).
- **A copy of the browser profile or the disk.** No key is kept at rest. Without the passkey, what is stored stays sealed.
- **Devices that are not yours.** Only a device that proves it holds the passkey gets the books.
- **The language model.** Text for a hosted model is redacted first, and a model in an attested enclave reads only there ([ai.md](ai.md)).

## What Belege cannot protect against

- **A device or browser that is not under your control.** Malware, someone using the unlocked device, or a **browser extension** allowed on the site sees what the page sees: the open books, and the passkey's answer at unlock – and with it the keys. That holds for any web app, online banking included. Keys derived from that answer cannot be changed without sealing the books anew, so this is worth avoiding rather than repairing.
- **A tampered version of the app.** The app comes from belege.le-space.de; a build that was changed on the way could do what an extension could. Each release names its IPFS CID on its release page, so a served build can be compared with the published one.
- **Losing every passkey.** See [keys.md](keys.md); a vault with a second passkey is planned ([#406](https://github.com/Le-Space/belege/issues/406)).

## What you can do

- **A browser profile only for Belege, without extensions.** The simplest and most effective step. Alternatively, in an existing profile, allow no extension on belege.le-space.de (Chrome: an extension's details → "Site access"; Safari: Settings → Extensions, per website).
- **On Android**, Chrome runs no extensions: Belege installed as an app from there is not exposed to them.
- **Keep the system and the browser up to date**, and lock the device when you leave it.
- **A desktop app** without browser extensions is planned as an alternative to the web app; there is no date yet.
