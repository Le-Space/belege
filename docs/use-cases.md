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
- **What leaves:** nothing. Your books stay in this browser, sealed with your passkey.

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
proves it holds your passkey. You choose where the devices meet:

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
freigeben" under Eigene Geräte. Your phone then asks the Belege tab on the computer, and that tab
asks the bridge. This works only while that tab is open and unlocked, and the phone may only read
and ask, never set up or delete.

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
- **Assistant:** a read-only share of one year, redacted and with an end. You can end it at any
  time. The bridge must be running for this.
- **Le Space invoicing app:** it delivers own receipts and learns which of its invoices are paid.

## Coming later

Not ready yet, but planned: the bridge as a machine of its own in the cloud, attested and paired
like on your computer. An AI service from Le Space. Paying with Le Space Credits. And shared books
with colleagues or the tax adviser.
