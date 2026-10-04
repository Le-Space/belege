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

## Instalments (issue #258)

An invoice can be paid in parts: a customer pays our 10.000 € invoice as 3.500 + 3.500 + 3.000, or we pay a supplier in rates. The invoice stays the receipt for every part, and each payment is linked to it.

- **What is open** comes from the links alone: total minus what the linked payments add up to. Unlinking one instalment reopens exactly that part.
- **In another currency** (a USD invoice paid from euros – by bank, or in Monero valued in euros): a payment counts by the original amount where the bank names one, else by its euro amount at the ECB's reference rate of its day. Belege asks the bridge for that rate once a payment is linked to such an invoice and keeps it on the booking (`fx`), so "500,00 USD offen" is reckoned in the invoice's currency. Such a figure is an estimate (a card adds its margin, a crypto payment its own rate): a difference within 5 % of the total counts as paid, not as open or over-paid. Without a bridge, or without a rate, nothing is reckoned – euros are never taken for dollars – and the invoice counts as paid by its links.
- **The matching:**
  - a partly paid invoice stays in play;
  - a payment below what is open counts as an instalment (30 points) when the invoice is partly paid already, or when the purpose names the invoice's number and says so ("Teilzahlung", "Rate", "Anzahlung", "Restzahlung" …; the word alone is too common);
  - a payment of exactly what is open counts as its rest ("Restbetrag", the amount's points);
  - a late date is no sign against an instalment;
  - a paid invoice takes no further payment by itself.
- **By hand:** under "Beleg finden" a partly paid invoice linked elsewhere is offered again ("teilweise bezahlt · … offen") with "Als weitere Teilzahlung zuordnen"; its other links stay. Linking an invoice the usual way still moves it from another payment.
- **What you see:**
  - the payment's detail says "Teilzahlung 2 von 3 · 2025-017 · 3.000,00 € offen", then "bezahlt" (or "überzahlt um …");
  - Belege shows "teilweise bezahlt · 7.000 von 10.000 (2×)", then "in 3 Raten bezahlt".
- **Export:** every instalment carries the invoice's number in Belegfeld 1, and its file goes into the package once. The paired invoice app is told each payment and works out "teilweise bezahlt" itself.

## Wages, wage tax, contributions, tax payments (issue #233)

These payments get no receipt of their own: the payroll run is the receipt for a wage (payslip, payroll journal), the wage-tax return for the wage tax, the contribution statement for social security, the advance return or the assessment for a tax payment. Belege recognises them and asks for no receipt; the payment's "Warum?" names the document that stands for it (`app/src/lib/matching/payroll.js`):

- **Tax payments:** the counterparty is a tax office (Finanzamt, Finanzkasse, FK …) or the purpose carries a tax number; the tax by its word (LSt, USt, KSt, GewSt …); trade tax to a municipality's cash office. The period from the purpose (`12/2025`, `IV/2025`, `2024/2025`).
- **Contributions:** the Minijob-Zentrale, the Knappschaft, a health insurer, a Berufsgenossenschaft.
- **Wages:** an outgoing payment to a person on the employees list (Einstellungen → Mitarbeiter), or with Lohn, Gehalt or Minijob in the purpose.

The account suggested (SKR 03, to be checked with the tax adviser): 1740 wages, 1741 wage tax, 1742 contributions, 1780 VAT advance payments (1790 for an earlier year), 2200 corporate tax, 4320 trade tax. On Home, taxes paid to the tax office have a line of their own; wages, wage tax and contributions are expenses.

## Vendor accounts

Some vendors never pair one payment with one receipt: a prepaid tariff books top-ups, and its monthly "invoices" are statements of what the credit was used for. _Lieferantenkonto ansehen_ (in a payment or a receipt) puts the vendor's payments and receipts on one timeline with a running balance: opening balance + top-ups − consumption. It names what does not add up:

- a negative balance;
- a month without a statement;
- top-ups without any statement;
- a January statement that may bill the year before.

_Als Guthabenkonto führen_ makes the statements document the top-ups: no question per top-up, and the statements count as covered. The opening balance per year can be entered ([`app/src/lib/matching/vendor-account.js`](../app/src/lib/matching/vendor-account.js)).
