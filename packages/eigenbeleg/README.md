# @le-space/eigenbeleg

The Eigenbeleg and the Kontoauszug of Le Space's tools – [Belege](https://github.com/Le-Space/belege) and the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI: what they say, drawn as PDF/A-2b ([`@le-space/pdf`](../pdf), text in any script) and written as CSV. Runs in a browser and in Node; the same document is the same file in both. The documents are German, for German bookkeeping.

An Eigenbeleg is a receipt the payer writes for a payment that has no receipt from the other side. It is never an invoice, and never one written for somebody else.

- **A period's Eigenbeleg** (Eigenbeleg's): `valueEntries(entries, rates)` values [`@le-space/ledger`](../ledger) entries at the day's rate (`rates.rateFor(asset, day)`, e.g. from [`@le-space/rates`](../rates); `fixedRates` for tests; Aleph credits at their USD price per credit). `buildDocument({ payer, chain, network, period, entries, number, includeKinds, layout })` puts the payments to the network on it (fees, storage deposits; transfers only when included) and says of every other movement why not; `layout: 'collective'` (one Sammel-Eigenbeleg) or `'single'` (one per transaction, numbered up from the first, `nthNumber`). `eigenbelegPdf(doc, { logo })`, `eigenbelegCsv(doc)` (semicolons, decimal commas, BOM; formulas defused).
- **The Kontoauszug** (Eigenbeleg's): `buildStatement({ payer, account, chain, period, entries, opening, closing, method, belege })` – opening balance, each booking with debit, credit and running balance, closing balance checked against the chain; Aleph credits as a monthly **Verbrauchsauszug**. `statementPdf(st, { logo })`. `logo: true` draws the chain's mark, small, beside the title (NEAR, Akash, Filecoin, Aleph; from `@le-space/pdf`'s `LOGOS`, sources and terms in its `assets/README.md`); off unless asked for.
- **The Eigenbeleg of one booking** (Belege's, `@le-space/eigenbeleg/booking`, `/booking-pdf`): `bookingPdf(doc)` for a `BookingEigenbeleg` – a bank booking or a crypto payment, with an own wallet's transaction in full (whole hash, both addresses, every movement with the gas, the explorer link as a QR code). The booking's context is the caller's to gather. `nextSelfNumber(receipts, year)` – the range EB-YYYY-NNN.
- **A statement Eigenbeleg** (Belege's Aleph, Akash and travel statements, `@le-space/eigenbeleg/statement-layout`): `statementLayout({ title, created, continuation })` → `head`, `field`, `rule`, `heading`, `table` (the header repeats on a new page), `signature`, `save`.

Every PDF has Eigenbeleg's look (`layout.js`): A4, grey labels beside their values, a note in a tinted box, page numbers at the foot, a line to sign. `creator` names the program in the metadata (`eigenbeleg` for the period's documents, `Belege` for a booking's and a statement's unless given).

```bash
pnpm --filter @le-space/eigenbeleg test           # Node, and every document byte for byte in Chromium
pnpm --filter @le-space/eigenbeleg pdfa-samples out/   # one of each, for veraPDF (CI runs it)
```

The model, the CSV, the Kontoauszug and the PDF layout came from Eigenbeleg's `packages/eigenbeleg` at e6cde90; the booking's Eigenbeleg and the statement layout from Belege's `app/src/lib/receipts/eigenbeleg*.js` and `app/src/lib/pdf/statement-layout.js` (moved with their history). AGPL-3.0-or-later.
