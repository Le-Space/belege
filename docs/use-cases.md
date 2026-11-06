# Ways to use Belege

_Deutsch: [use-cases.de.md](use-cases.de.md)_

Belege runs in the browser. For a lot, that is enough. For bank, mailbox and AI, a small
program on your computer joins in: the bridge. This page lists the ways to use Belege, what each
needs, and what leaves your computer. You can start small and add more later.

## 1. Only the browser

Open belege.le-space.de, make a passkey, and start. Upload bank statements as CAMT files from
online banking, receipts as PDFs or photos, or let Belege read a folder on your computer. Belege
matches payments and receipts and makes a DATEV package every month. Travel expenses work too.

- **You need:** a browser and a passkey.
- **What leaves:** nothing. Your books stay in this browser, sealed; only your passkey opens them.

## 2. One computer with the bridge

The bridge runs on your computer and does what a browser may not. It fetches transactions from
your bank (through Hibiscus or Enable Banking), and receipts from your mailbox, from Paperless or
from customer portals. It asks a language model to read receipts and make suggestions. And it
reads Kraken, your own wallets and Aleph accounts, read-only.

- **You need:** the bridge on a Mac or Windows computer (`pnpm bridge`), paired once with the
  code it shows.
- **What leaves:** the bridge's requests to your bank, your mailbox and the services you set up.
  For AI you choose: a model on your computer (then nothing leaves), a hosted model with
  redaction first, or LibertAI in an attested enclave. Passwords and keys stay in your
  computer's keychain.

## 3. Several devices of your own

The same books on computer and phone, or on two computers. A device gets the books only once it
proves it holds your books' key, and only when your books already know it or you let it in. You
choose where the devices meet:

- through a Le Space relay (works on the road too),
- through the relay in your bridge (only in your own network),
- by QR code, with no relay at all (two devices in the same network),
- or all of these; a new device then comes in through your own network only.

- **You need:** the same passkey on every device, and "Eigene Geräte synchronisieren".
- **What leaves:** only encrypted data between your devices. A relay sees that two devices talk,
  never what.

## 4. The phone uses your computer's bridge

No bridge runs on a phone. It can use your computer's, in one of two ways.

**The bridge as a device of its own.** You pair the bridge by invitation (Integrationen →
Bridge). Your phone then reaches it through a relay, on the road too, with no browser open on the
computer. The bridge gets a key of its own for this. It shows that it is your bridge, and opens no
books.

- **What leaves:** the bridge connects to your books' relays itself. What it exchanges with your
  devices is encrypted.

**Through the open computer.** You want the bridge never to go online itself? Start it with
`pnpm bridge --no-node`. On the computer, switch on "Bridge dieses Rechners für eigene Geräte
freigeben" under Eigene Geräte → Erweitert. Your phone then asks the Belege tab on the computer, and that tab
asks the bridge. This works only while that tab is open and unlocked, and the phone may only read
and ask, never set up or delete. Only your own devices use this way, not the devices of members.

- **What leaves:** the bridge talks to your computer only. Phone and computer exchange encrypted
  data, as in sync.

## 5. Backing up and getting it back

An encrypted backup of your books and receipts lies on Aleph Cloud, automatic if you like. On an
empty device you get it back with your passkey, or with the 24 recovery words if the passkey is
gone. You can add a second passkey as a spare.

- **You need:** the bridge once, to set up the account on Aleph, and credits there. Allow your
  browser's key for that account, and it backs up without the bridge too
  ([backup.md](backup.md)). To get it back you need the account's address.
- **What leaves:** only the encrypted backup. Aleph cannot read it.

## 6. Working with others

- **Tax adviser:** the DATEV package with the receipts, every month.
- **Assistant:** you admit them as a member (_Integrationen → Zusammenarbeit_,
  [#641](https://github.com/Le-Space/belege/issues/641)). They have their own passkey and work on
  belege.le-space.de, from anywhere. You choose:
  - "Liest mit" (reads along): they follow the books and write nothing.
  - "Schreibt mit" (writes along): they work in the books and back up; your bridge only if you
    tick it.
- **An AI assistant on your computer** (Claude Code, say): it gets a view of a year's payments,
  receipts and questions, with an end. For it the bridge must be running. What it reads goes to its
  provider.
- **Le Space invoicing app:** it delivers own receipts and learns which of its invoices are paid.

## 7. The bookkeeping works in your books

Your bookkeeping gets into your books with their own passkey (_Integrationen → Zusammenarbeit_).
They make a join code, you admit it and send the answer back, and you both compare a check shown
on your screens; if it differs, you stop. From then on they open your books
next to their own, assign receipts, make own receipts, export and back up. They write under their
own name. Passkeys, recovery words and inviting others stay with you.

- **You need:** device sync on both sides; both devices online at the same time, so that the books
  replicate.
- **What leaves:** the same as with several own devices – sealed, through a relay or
  directly. The join code and its answer go the way you send them; the answer is sealed for the
  device that made the code.
- **More:** [keys.md](keys.md#members), [backup.md](backup.md#members-back-up-and-restore).

## Coming later

Not ready yet, but planned: the bridge as a machine of its own in the cloud, attested and paired
like on your computer. An AI service from Le Space. Paying with Le Space Credits (the card is in the
app, still in test operation).
