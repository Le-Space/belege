# Matching: fiscal years, refunds, vendor accounts

How Belege decides what belongs together beyond one payment and one receipt. The whole feature list: [features.md](features.md). [Deutsch](matching.de.md).

## One year at a time

The switch above every page (_Jahr_) shows one fiscal year: its payments, its questions, and the receipts paid in it. A receipt paid in the year counts there even if it is dated earlier (an invoice from December paid in January, marked _Beleg aus 2025_). An unpaid receipt counts in its own year, and also in a year whose payment is offered for it. The matching itself looks across years. Without a choice, the switch shows the newest year with a payment. The fiscal year starts in the month set under DATEV ([`app/src/lib/year/year.js`](../app/src/lib/year/year.js)).

## Refunds

A charge and its refund pair when all of this holds:

- the same counterparty, which the refund names;
- a refund word (_Rückerstattung, Gutschrift, Storno, Refund_, …);
- within 120 days;
- on any account, the same card included;
- each side has only the other.

A full refund needs no receipt on either side; after a partial one the charge still needs its receipt. _Als Erstattung verknüpfen …_ in the payment links a pair by hand, _Keine Erstattung_ keeps one apart ([`app/src/lib/matching/refunds.js`](../app/src/lib/matching/refunds.js)).

## Vendor accounts

Some vendors never pair one payment with one receipt: a prepaid tariff books top-ups, and its monthly "invoices" are statements of what the credit was used for. _Lieferantenkonto ansehen_ (in a payment or a receipt) puts the vendor's payments and receipts on one timeline with a running balance: opening balance + top-ups − consumption. It names what does not add up:

- a negative balance;
- a month without a statement;
- top-ups without any statement;
- a January statement that may bill the year before.

_Als Guthabenkonto führen_ makes the statements document the top-ups: no question per top-up, and the statements count as covered. The opening balance per year can be entered ([`app/src/lib/matching/vendor-account.js`](../app/src/lib/matching/vendor-account.js)).
