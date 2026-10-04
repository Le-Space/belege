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
  - Where the ECB has none (the ruble: no rate since 1 March 2022), the rate is entered by hand (EUR per unit), with where it comes from: the card statement, an exchange receipt.
  - The original amount, the rate and its source stay on the booking.
- **Undo:** _Auslage rückgängig machen_ deletes the booking and frees the receipt, for a payment that turns up after all. Booking it again makes a new booking.

## The account

- _Auslagen Geschäftsführung_ is an account without an import (`source: outlay`): its bookings come from receipts only. It shows in Zahlungen, in the account filter and in the export like any account.
- **Ledger account:** set from the legal form in _Buchhaltung_:
  - a UG/GmbH books against its shareholder clearing account;
  - a sole proprietor or partnership against 1890 (Privateinlage).
  - Until that is set, the export asks for it as for any account.
- **Each booking's expense account** is suggested and confirmed as usual.

## Not yet (issue #293)

- Marking a receipt "privat, nicht geschäftlich".
- Paying outlays back: a transfer matched against open outlays.
- A rate source for currencies without an ECB rate other than by hand.
- Employees as further persons.

The accounts and rates are to be confirmed with the tax adviser; this describes what Belege does, not tax advice.
