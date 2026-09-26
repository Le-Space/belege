# Accounts and the monthly DATEV export

_Deutsch: [export.de.md](export.de.md)_

Once a month, Belege makes one ZIP for the bookkeeping: the month's bookings as a **DATEV Buchungsstapel** (EXTF CSV) for import into **MonkeyOffice**, and the receipts as files. The ZIP is made in the browser and downloaded; nothing goes to a server, and nothing goes to the language model.

```
DATEV_2026-09.zip
├── DATEV/EXTF_Buchungsstapel_2026-09.csv   Windows-1252, for the import
├── Belege/2026-09-001_Kabelnetz_Beispiel_GmbH.pdf
├── Belege/2026-09-002_….pdf
├── Kontoauszuege/KA-2026-09-1200_Konto_A.pdf     one statement per account with a booking in the month
├── Kontoauszuege/KA-2026-09-1340_Kraken_BTC.pdf
└── Uebersicht_2026-09.csv                  UTF-8, for people: every booking, its account, receipt number, how the receipt was linked
```

## Before the export

1. **Ledger accounts of the bank accounts** – _Integrationen → Eigene Anweisungen → Buchhaltung (MonkeyOffice / DATEV)_: for each bank account the number it has in MonkeyOffice ("Sachkonto"). The field shows 1200, 1210, … (SKR 03) as a placeholder only.
2. **Header values** – same place: Beraternummer and Mandantennummer (defaults 1001 and 1, which MonkeyOffice usually takes for a company doing its own books – check what your MonkeyOffice expects), the month the fiscal year starts (January), the Sachkontenlänge (4).
3. **An account for every booking** – in each booking under _Konto_. The app suggests, you confirm with _Übernehmen_:
   - own transfer → **1360** Geldtransit, bank fee → **4970** Nebenkosten des Geldverkehrs, both without a BU key;
   - _gelernt_: the account you gave this vendor last time (found by the receipt's vendor or the counterparty on the statement);
   - otherwise nothing: pick from the SKR 03 list (search by number or name) or type any 4–8 digit number.

   The BU key comes from the linked receipt: VAT 19 % → 9, 7 % → 8 on money out; 19 % → 3, 7 % → 2 on money in; `reverse_charge` → 94; no key without VAT, with several or foreign rates, or on an Automatikkonto (8400, 8300). The keys can be changed in the settings.

The export page lists what is missing. **It exports only when every booking of the month has a confirmed account and every bank account its ledger account.** Fees and transfers are no exception: their suggestion is automatic, but it is confirmed – one click, _Konten aus Umbuchung und Bankgebühr übernehmen_, does all of them. (The alternative, a setting that takes automatic accounts unconfirmed, was left out: one more switch, and a wrong classification would reach the books unseen.) Bookings without a receipt, receipts linked to nothing and senders not yet confirmed are warnings: the export goes, but have a look.

## Import into MonkeyOffice

MonkeyOffice imports DATEV Buchungsstapel through its DATEV import (menu names differ between versions; its help has it under "DATEV"). Import `DATEV/EXTF_Buchungsstapel_<month>.csv`, check the bookings in the import preview, then attach the receipts from `Belege/` by their number (the number is in _Belegfeld 1_ and at the start of the file name). The first import is a test: do it in a copy of the company, or check every line before you post.

## The format

- EXTF, version 700, category 21 "Buchungsstapel", format version 13. Line 1: 31 header fields; line 2: the 125 column headings; then one line per booking with 125 fields (only the first 14 are filled).
- `;` between fields, CRLF after each line, text in double quotes with inner quotes doubled, empty fields completely empty. Windows-1252 (ANSI); a character it lacks loses its accent or becomes `?`.
- Amount positive, decimal comma, no thousands separator. **S/H refers to _Konto_**, the bank's ledger account: money in is S, money out is H. _Gegenkonto_ is the confirmed account.
- _Belegdatum_ `DDMM` = the booking date (DATEV takes the year from the fiscal year, and every line lies in the stack's period). _Belegfeld 1_ = the receipt number `YYYY-MM-NNN` (at most 36 characters). _Buchungstext_ = the receipt's vendor, else the counterparty, else the purpose (at most 60).
- A booking with several receipts: the first receipt's number in _Belegfeld 1_, all of them in the ZIP.
- _KOST1_ (Kostenstelle): the cost centre of the booking's account, given per own wallet under _Integrationen → Eigene Wallets_ (letters and digits, at most 36). None on a transfer exported once between two banks.
- A booking without a receipt of its own (a bank or exchange fee, an own transfer, a staking reward, an income without an invoice yet): its account's statement number `KA-YYYY-MM-<ledger account>` in _Belegfeld 1_. The statement is in `Kontoauszuege/`.
- **An own transfer** whose other side is in the books is exported **once**, from the bank account with the lower ledger number, against the other bank's ledger account (1200 → 1210, not via 1360: with one line, 1360 would stay open). The other side is listed in the overview as "nicht im Buchungsstapel". A transfer whose other side is not in the books keeps 1360.
- Receipt numbers are given in booking order and kept on the receipt once exported: a second export of the month gives the same numbers, a receipt added later gets the next one.
- Code: `app/src/lib/export/datev.js` (all of the format, one module), `plan.js` (what goes in, the check list), `build.js` (the ZIP, with [fflate](https://github.com/101arrowz/fflate), loaded only on the export page), `cp1252.js`; accounts in `app/src/lib/booking/`.

### What was checked against a source, and what not

- **Field list, order and rules** follow the open-source Ruby gem [ledermann/datev](https://github.com/ledermann/datev) (header, booking fields, its example `EXTF_Buchungsstapel.csv` for format version 13), which follows DATEV's developer documentation. DATEV's own pages could not be read here. Two headings follow the task that asked for this export (`Basis-Umsatz`, `WKZ Basis-Umsatz`; the gem writes `Basisumsatz`); DATEV reads by position.
- Header fields 8–10 and 18 (Herkunft, Exportiert von, Importiert von, Diktatkürzel) are left empty; 27 (SKR) too. If MonkeyOffice wants them, `headerLine` in `datev.js` is the one place.
- **SKR 03 names** in the catalogue were compared with the public account pages of buchungssatz.de, not with DATEV's chart. **BU keys** 9/8/3/2 and 94 for §13b are the commonly documented SKR 03 keys (DATEV community, tax-software help pages); not checked with DATEV itself.
- **Not tested with MonkeyOffice yet.** The first real import is the test.

## Monthly statements

Every account with a booking in the month gets a statement as a PDF: bank accounts, exchange accounts and wallets alike (`app/src/lib/export/statement.js`, drawn by `statement-pdf.js`). It lists every booking of the month on that account, with its receipt number or what stands in for one (_Umbuchung_, _Gebühr_, _Ertrag_), and the totals of money in, money out and the month.

A crypto account also shows the quantity and the rate of every booking, with the rate's source (K = Kraken, CG = CoinGecko, EZB = ECB, H = the price of the trade). The start and end balance in the asset is worked back from the last balance the exchange reported.

For a bank account, the statement lists what Belege holds; it does not replace the bank's own statement.

## Eigenbeleg

For a payment that has no receipt from the other side, for example fees paid on a blockchain that issues no invoices, the detail of the payment offers **Eigenbeleg erstellen** (`app/src/lib/receipts/eigenbeleg.js`). You write what was paid and why there is no receipt; a crypto payment starts with a reason filled in. Belege then draws a PDF with:

- its own number range (`EB-YYYY-NNN`), date, amount and account;
- the recipient or payer;
- for a crypto payment: quantity, rate with its source, and the transaction reference;
- what was paid and why no receipt exists;
- who wrote it and when, with a line to sign.

The PDF is stored like an uploaded receipt and linked to the payment as your decision. The export numbers it like any other receipt and puts it into `Belege/`.

An Eigenbeleg is not an invoice and gives no input-tax deduction.

## To check with the tax adviser

- Whether, and up to which amount, Eigenbelege are accepted for payments without a receipt (blockchain fees, lease payments).
- The **accounts**: the catalogue is a starting point (e.g. 4964 is "Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)" – right for software subscriptions?).
- The **BU keys**, above all **§13b**: 94 is the usual key for a service from abroad at 19 %; others (e.g. for goods from the EU) exist. Which Automatikkonten your chart has (8400 and 8300 are treated as such: no key).
- **Beraternummer, Mandantennummer**, Sachkontenlänge and fiscal year, as MonkeyOffice has them.
- Whether the booking date as _Belegdatum_ is right for you, or the receipt's date.

## Your own chart of accounts

Under _Integrationen → Eigene Anweisungen → Kontenplan_ the app reads the chart of accounts of your bookkeeping program; from then on "Konto" suggests your accounts with your names instead of the built-in SKR 03 list, and marks a number that is not in your chart.

- **MonKey Office:** sidebar → _Import & Export → Export DATEV → Kontenbeschriftungen_ (optionally only a range _von Konto … bis Konto_) → read the CSV file in.
- **Other programs with a DATEV interface:** the export _Kontenbeschriftungen_ (a file that starts with `EXTF`, data category 20).
- **Otherwise:** any CSV or text file with a column of account numbers (4–8 digits) and a column of names, separated by semicolon, comma or tab. UTF-8 and Windows-1252 are both read.

The chart is kept sealed in your books in the browser, like every record. _Entfernen_ goes back to the SKR 03 list.
