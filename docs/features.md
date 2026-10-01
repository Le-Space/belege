# Features

**English** · [Deutsch](features.de.md)

What Le Space Belege does today, by category. The app shows the same list, shorter, in its consent screen (_Was Le Space Belege kann_).

## Privacy and storage

- **Passkey instead of a password.** Every record and every receipt file is sealed (AES-GCM) with keys derived from the passkey's PRF answer; no private key is stored on the device.
- **Local-first.** The books live in this browser (OrbitDB and Helia on IndexedDB). Le Space runs no server for them.
- **The network under your hand.** The badge in the header shows what is online. One click pauses everything; own devices and the invoicing app switch on and off one by one ([#180](https://github.com/Le-Space/belege/issues/180)).

## Payments

- **Bank transactions** from [Hibiscus](https://github.com/willuhn/hibiscus) through the bridge (allowed accounts only), **banks in Europe through Enable Banking** (your own application, through the bridge, released accounts only; [banking.md](banking.md)), and **CAMT.053 statements** (Revolut, GLS, …) imported in the browser.
- **One fiscal year at a time**, with a year switch. Bookings that belong together (both sides of a transfer, a trade's legs, a fee) are one click apart.
- **Private payments** from the business account are marked, documented and settled ([#172](https://github.com/Le-Space/belege/issues/172)).

## Receipts

- **From everywhere:**
  - the accounting mailbox (IMAP, read-only), uploads and a shared folder;
  - customer portals through a browser on the bridge's Mac: Vodafone MeinKabel, and portals of your own by recording the way once;
  - on a click, a search in the private mailbox from the booking.
- **Checked.**
  - Mails that fail DKIM/SPF wait for a confirmation, and signs of a scam are named.
  - Copies of one invoice are marked, and any receipt can be set aside.
- **Eigenbeleg:** a self-made receipt for a payment without one. For crypto it carries the hash, both addresses and the gas, with the transaction as a QR code.

## Matching

- **A score** from amount, invoice and customer number, IBAN, vendor and date. Sure pairs are linked; the rest become questions on Home.
- **No receipt needed for:**
  - own transfers between accounts, recognised by counter-booking, reference or IBAN, including twins, across chains (IBC, bridges, swaps across chains) and by hand;
  - bank fees;
  - refunds, paired with their charge;
  - dust;
  - your own rules.
- **Vendor accounts** for prepaid and collective billing: a timeline with a running balance that names what does not add up.
- **Learning:** from your links, which counterparty is which vendor, and which fees are fees.

## AI – only on a click (✦)

- **Five places:**
  1. reading a receipt's text;
  2. _Mit KI weitersuchen_ in the private mailbox;
  3. _KI-Vorschlag_ for a receipt;
  4. _KI-Vorschlag_ for the other side of an own transfer;
  5. _Ungereimtheiten erklären_ in a vendor account.
- **Your own model**, set up in the bridge (DeepSeek, Ollama, …). Text is redacted before it is sent – that limits what leaves, it does not make it anonymous; a local model sends nothing. Le Space runs no AI.
- **Usage in view:** tokens and cost per day, week, month and receipt. See [ai.md](ai.md).

## Crypto

- **Sources:** Kraken, and own wallets on Cosmos chains (Nym, Akash, including Akash's older history), EVM chains (Ethereum, Base, Arbitrum, OP Mainnet, Polygon; Blockscout or Alchemy) Bitcoin (xpub/ypub/zpub) and Filecoin (by address, through Filfox).
- **Every booking in euros**, with the exact quantity and the rate of its day with its source:
  - CoinGecko, Kraken or the ECB;
  - a DEX pool at the booking's block (Uniswap V2, V3 and V4, against ETH or USDC);
  - the trade's other side, or the burned old tokens of a migration;
  - by hand.
- **Recognised:** DEX swaps, swaps across chains, token migrations and dust, with lookalike senders named.
- **Aleph Cloud credits** as a monthly statement per account. See [crypto.md](crypto.md).

## Pre-accounting and export

- **Every booking** gets an SKR 03 account and a BU key: suggested, confirmed by you. Your own chart of accounts can be read in.
- **Every month a ZIP:** a DATEV Buchungsstapel (EXTF) for MonkeyOffice, the receipts as PDFs, and a statement per account. See [export.md](export.md).

## Devices and working together

- **The same books on phone and computer.** A device gets them only after it proves the passkey. Devices are added by QR code and removed with one click.
- **Where devices meet** ([#148](https://github.com/Le-Space/belege/issues/148)):
  - at the public Le-Space relays;
  - at a relay in your own bridge, in your own network only (`pnpm setup:relay`, WebRTC-Direct, no certificate to install);
  - without any relay, by scanning two QR codes;
  - or all of them, with a device the books do not know yet let in only by QR or through the own bridge's relay.
- **A phone uses the computer's bridge.** Belege installs as an app (PWA), and the app shell works offline.
- **Invoicing app (UCEP):** it makes Eigenbelege for Belege and learns which of its invoices were paid.
- **A read share** of the books for an assistant, for a limited time.

## Language

- **German and English** ([#192](https://github.com/Le-Space/belege/issues/192)), switched in the header at once and offline; the first visit follows the browser's language. Amounts, dates and crypto quantities follow the language. Documents for German bookkeeping stay German: the Eigenbeleg, the statements and the DATEV export.
