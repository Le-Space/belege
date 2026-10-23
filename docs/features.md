# Features

**English** · [Deutsch](features.de.md)

What Le Space Belege does today, by category. The app shows the same list, shorter, in its consent screen (_Was Le Space Belege kann_).

## Privacy and storage

- **Passkey instead of a password.** Every record and every receipt file is sealed (AES-GCM) with keys derived from the passkey's PRF answer; no private key is stored on the device.
- **Local-first.** The books live in this browser (OrbitDB and Helia on IndexedDB). Le Space runs no server for them.
- **The network under your hand.** The badge in the header shows what is online. One click pauses everything; own devices and the invoicing app switch on and off one by one ([#180](https://github.com/Le-Space/belege/issues/180)).

## Payments

- **Bank transactions** from [Hibiscus](https://github.com/willuhn/hibiscus) through the bridge (allowed accounts only), **banks in Europe through Enable Banking** (your own application, through the bridge, released accounts only; [banking.md](banking.md)), **CAMT.053 statements** (Revolut, GLS, …) imported in the browser, and **company credit cards** as accounts of their own, their statements read from the issuer's CSV.
- **One fiscal year at a time**, with a year switch. Bookings that belong together (both sides of a transfer, a trade's legs, a fee) are one click apart.
- **Private payments** from the business account are marked, documented and settled ([#172](https://github.com/Le-Space/belege/issues/172)).

## Receipts

- **From everywhere:**
  - the accounting mailbox (IMAP, read-only), uploads and a shared folder;
  - your own **Paperless-ngx** ([#318](https://github.com/Le-Space/belege/issues/318)), through the bridge (`pnpm setup:paperless`): what it added since the last fetch, when the Belege page opens and on a click. The original file is the receipt, so a mail attachment that also reached Paperless is caught as a duplicate by its bytes; a scan or photo without a text layer is read with the text Paperless recognised. While Paperless is on, Belege does not read the mailbox itself – Paperless' mail rules do – unless you switch that on, and then documents with the tags you name are left out. On a payment, _Beleg finden → Paperless_ asks Paperless' own full-text search (the search text, else the counterparty) and takes a hit over like an upload: read and linked to that payment, kept as from Paperless;
  - customer portals through a browser on the bridge's Mac: Vodafone MeinKabel, and portals of your own by recording the way once;
  - on a click, a search in the private mailbox from the booking.
- **Checked.**
  - Mails that fail DKIM/SPF wait for a confirmation, and signs of a scam are named.
  - Copies of one invoice are marked, and any receipt can be set aside.
- **E-invoices (XRechnung)** ([#160](https://github.com/Le-Space/belege/issues/160)): an XML invoice in UBL or CII, uploaded or from the mailbox, is kept as the original and read at once without AI – seller, number, dates, VAT, lines, total. It is shown as a plain view of its fields and goes into the export as the XML it came as. A **ZUGFeRD / Factur-X** PDF is read from the XML it carries, which is kept beside the PDF and exported with it; a PDF from a sender not confirmed is opened only after the confirmation. Factur-X MINIMUM and BASIC WL are read but named as no EN 16931 e-invoice.
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

- **Sources:** Kraken, and own wallets on Cosmos chains (Nym, Akash, including Akash's older history), EVM chains (Ethereum, Base, Arbitrum, OP Mainnet, Polygon; Blockscout or Alchemy) Bitcoin (xpub/ypub/zpub) and Filecoin (by address, through Filfox; with USDFC and swaps on SushiSwap).
- **Every booking in euros**, with the exact quantity and the rate of its day with its source:
  - CoinGecko, Kraken or the ECB (for the ruble, the Bank of Russia; for the tenge, the National Bank of Kazakhstan; else a cross rate through the ruble);
  - a DEX pool at the booking's block (Uniswap V2, V3 and V4, against ETH or USDC);
  - the trade's other side, or the burned old tokens of a migration;
  - by hand.
- **Recognised:** DEX swaps, swaps across chains, token migrations and dust, with lookalike senders named.
- **Aleph Cloud credits** as a monthly statement per account. See [crypto.md](crypto.md).

## Pre-accounting and export

- **Every booking** gets an SKR 03 account and a BU key: suggested, confirmed by you. Your own chart of accounts can be read in.
- **VAT on Home** ([#195](https://github.com/Le-Space/belege/issues/195)): per month or quarter and for the year, the input VAT from the receipts (19 % and 7 %, by receipt date), the output VAT from the invoices of the invoicing app – when the money comes in (Ist, the default) or on the invoice date (Soll), as set under Buchhaltung – and the VAT payable or refund. An own invoice among the receipts – uploaded or from the mailbox – is recognised by the company names, the model's `[FIRMA]` mark or the own VAT ID under Buchhaltung ([#354](https://github.com/Le-Space/belege/issues/354)): its VAT counts as output VAT, never as input VAT; the receipt says so and can be set otherwise. **International and special cases** are told apart and shown with their receipts: intra-EU supplies with the lines for the EC Sales List (ZM) per period and customer VAT ID, third-country turnover, §13b in Germany, exempt turnover and intra-EU acquisitions; what cannot be told without guessing (an EU invoice without the customer's VAT ID, say) is named with a link. Foreign VAT, §13b, invoices not paid yet and invoices whose VAT the app did not send are named apart. A small business (§19 UStG) sees its turnover against the limits instead. A help for the advance return, not the return itself.
- **Every month a ZIP:** a DATEV Buchungsstapel (EXTF) for your bookkeeping, the receipts as PDFs, and a statement per account. See [export.md](export.md).

## Travel expenses

- **Trips** ([#213](https://github.com/Le-Space/belege/issues/213)) with their receipts, the statutory meal allowances by times and countries (meals provided, the three-month rule), mileage – a family member's car flagged for the tax adviser – and hospitality bills with their split. A receipt in another currency counts in euros, by its payment, its outlay or a rate.
- **Recognised, never assigned by itself:** a travel cost's kind, route and times from the reading; without AI, from its words in eleven languages; trips proposed by dates and route; appointments from calendar invitations (title, place and times only).
- **A monthly statement** as a numbered German PDF, booked on SKR 03 travel accounts by the legal form against the traveller's clearing account, its payout linked to it. See [travel.md](travel.md).

## Devices and working together

- **The same books on phone and computer.** A device gets them only after it proves the passkey. Devices are added by QR code and removed with one click.
- **Where devices meet** ([#148](https://github.com/Le-Space/belege/issues/148)):
  - at the public Le-Space relays;
  - at a relay in your own bridge, in your own network only (`pnpm setup:relay`, WebRTC-Direct, no certificate to install);
  - without any relay, by scanning two QR codes – right in the network menu at the top; the invite is a link the phone's camera opens, and once unlocked the menu there shows the answer (on an iPhone better from the home-screen app, which keeps its books apart from Safari);
  - or all of them, with a device the books do not know yet let in only by QR or through the own bridge's relay.
- **A phone uses the computer's bridge.** Belege installs as an app (PWA), and the app shell works offline.
- **Invoicing app (UCEP):** it makes Eigenbelege for Belege and learns which of its invoices were paid.
- **A read share** of the books for an assistant, for a limited time.

## Language

- **German and English** ([#192](https://github.com/Le-Space/belege/issues/192)), switched in the header at once and offline; the first visit follows the browser's language. Amounts, dates and crypto quantities follow the language. Documents for German bookkeeping stay German: the Eigenbeleg, the statements and the DATEV export.
