# Private outlays

_Deutsch: [outlays.de.md](outlays.de.md)_

Some business costs are paid privately by the managing director: in cash abroad, with a private card. Belege cannot read that money, so such a receipt would wait forever for a bank payment. **"Privat ausgelegt …"** on the receipt books it on an account of its own, _Auslagen Geschäftsführung_, and links the receipt to that booking. The receipt is covered.

## Booking a receipt as an outlay

Belege → the receipt → _Privat ausgelegt …_:

- **Paid:** in cash, with a private card, or otherwise. It is shown on the booking (`Privat ausgelegt (bar) · Rechnung …`).
- **On:** the receipt's date, changeable.
- **Amount:** the receipt's gross. An expense goes out of the account; a credit note comes in.
- **Another currency:**
  - Belege asks the bridge for the ECB reference rate of the day and books the euro amount at it.
  - The ruble has no ECB rate since 1 March 2022. For RUB the bridge then offers the **Bank of Russia's official rate** valid on that day (set on the working day before; the form names its date). It sees the day asked for, nothing else.
  - Where neither has one, or a document shows the rate actually paid (the card statement, an exchange receipt), the rate is entered by hand (EUR per unit), with where it comes from. A rate from a document comes first: it is closer to what was paid.
  - The original amount, the rate and its source stay on the booking.
- **Undo:** _Auslage rückgängig machen_ deletes the booking and frees the receipt, for a payment that turns up after all. Booking it again makes a new booking.

## The account

- _Auslagen Geschäftsführung_ is an account without an import (`source: outlay`): its bookings come from receipts only. It shows in Zahlungen, in the account filter and in the export like any account.
- **Ledger account:** set from the legal form in _Buchhaltung_:
  - a UG/GmbH books against its shareholder clearing account;
  - a sole proprietor or partnership against 1890 (Privateinlage).
  - Until that is set, the export asks for it as for any account.
- **Each booking's expense account** is suggested and confirmed as usual.

## Private, not business

Receipts from the private mailbox sit next to purely private ones. **"Privat, nicht geschäftlich"** on a receipt sets it aside as private, with a reason if given (`private trip`):

- it stays out of the matching, out of the questions and out of the export; a link it had is undone;
- it is shown as _Privat_, with its reason, and the decision is in the log;
- _Wieder aufnehmen_ takes it back in.

A partly business receipt (a hotel with a private night) is booked as an outlay with the business share; the split itself belongs to travel expenses (#213).

## Paying it back

The business transfers the money back from its bank account. On that transfer, **"Erstattet Auslagen …"** lists the open outlays:

- the ones that add up to the transfer exactly are ticked, the oldest preferred; else the oldest until the transfer is used up. Change the ticks as needed, then _Als Erstattung verknüpfen_;
- one transfer can pay several outlays back, and several transfers one outlay. What counts is the sum over everything linked together; the oldest outlays are cleared first;
- the transfer needs no receipt of its own (badge _Erstattung Auslagen_): the outlays' receipts document it. It is booked against the private account of the legal form, like a private repayment: the shareholder clearing account of a UG/GmbH, 1800 (Privatentnahme) for a sole proprietor or partnership, whose outlays were deposits;
- each outlay shows whether it is paid back, partly or not yet, and by which transfer; a link can be undone (_lösen_);
- **Home** lists the outlays not paid back yet, with the amount still open.

## Not yet (issue #293)

- Employees as further persons.

The accounts and rates are to be confirmed with the tax adviser; this describes what Belege does, not tax advice.
