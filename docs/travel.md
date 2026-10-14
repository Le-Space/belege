# Travel expenses

_Deutsch: [travel.de.md](travel.de.md)_

Travel and hospitality receipts do not fit "one payment, one receipt". A trip has many receipts, often paid privately; meal allowances and mileage have no receipt at all; a hospitality bill needs details before it counts; and what the company pays back is one transfer for a whole month. **Reisen** gathers a month's trips, works out what they come to, makes the statement (Reisekostenabrechnung) and books it ([#213](https://github.com/Le-Space/belege/issues/213)).

Who travels is listed under **Einstellungen → Reisende** ([#380](https://github.com/Le-Space/belege/issues/380)):

- **The owner** or managing shareholder: made with the first trip, or with the first employee added.
- **Employees:** each with their own **clearing account**, the account their statements are booked on. It is to be named with the tax adviser, a personal account say. Without it, no statement of theirs can be made.
- **The last four digits of each person's IBAN** recognise the transfer that pays them back.

With more than one person, Reisen, a trip and a receipt's "Zu einer Reise …" say whose a trip is. The allowances are the statutory ones, abroad those of the Federal Ministry of Finance's yearly letter.

## Trips

**Reisen** (from Belege and from Home) shows a month: its trips with what they come to, its hospitality bills, the trips proposed by the receipts, appointments from invitations, the open points and the month's statement.

A trip's page holds:

- **Head:** destination, business reason, departure and return (date and time), the place of activity (a customer, a site: for the three-month rule), whether there was a night away.
- **Abroad:** each border crossed, with the time and the country code; the country's name shows next to it, to catch a typo. A day abroad gets the rate of the country reached last before midnight; the day home, the last country abroad. Where a country has cities with rates of their own (Moskau, Paris, New York City …), the crossing picks one; anywhere else is the rest of the country.
  - **Rates:** the per-country table of the BMF letter for the year (from 2025 on), exactly as printed, with the letter as its source. Meals provided cut a day by the full-day rate of its country.
  - **Countries the letter does not list:** Micronesia gets the Philippines', the states of Trinidad and Tobago's district its rates (as the letter says); an overseas territory its mother country's (Guadeloupe → France, Hong Kong is China's); any other Luxembourg's. The last two are warnings, for the tax adviser.
  - A day before 2025 has no letter in Belege: it stays without an amount, named.
  - The overnight rates abroad apply to an employer's refund only, not to the owner: see the nights below.
- **Nights without a hotel invoice** (employees only, #380): each night is ticked on its own, with the flat rate it gets – 20 € in Germany (R 9.7 Abs. 3 LStR), abroad the BMF letter's overnight rate of the place at midnight (a city's where the crossing names one). Never ticked by itself, never for the owner. Booked with the month's statement on the accommodation account (4666), without VAT; a hotel receipt on the same trip is a warning, so no night is paid twice.
- **Meals provided:** per day. A breakfast in a hotel invoice is proposed from the invoice ("Übernehmen").
- **Mileage:** date, from, to, reason, km, there and back. The route is the record.
  - Own car 0,30 €/km, motorcycle or moped 0,20 €/km; a bicycle has no flat rate.
  - **A family member's car:** the flat rate, flagged _Fremdes Fahrzeug – mit Steuerberatung klären_, with its owner and who bears its running costs.
  - A company car or a rental gets no mileage (fuel and rental are receipts).
- **Receipts** of the trip with who paid them, the allowance per day, and **what the trip comes to**: allowances + mileage + overnight flat rates + receipts paid privately.

What a trip lacks (times, a reason, km) is named, and the trip is saved all the same.

## Meal allowances

By the trip's times, per calendar day (§ 9 Abs. 4a EStG; 14 € and 28 € since 2020, 12 € and 24 € before):

- one day without a night away: more than 8 hours, the partial rate;
- across midnight without a night away: the hours of both days add up and count for the day with most of them;
- with nights away: the days of departure and arrival the partial rate, each day between the full one;
- a meal provided cuts the day by 20 % (breakfast) or 40 % (lunch, dinner) of the full-day rate, down to nothing at most;
- **three-month rule:** at the same place of activity, the allowance ends three months after the first day there; four weeks away start the count again. Whether the place is visited three days a week or more is not checked: the cut days carry their reason, for the tax adviser.

## Receipts on a trip

On a receipt, **"Zu einer Reise …"** assigns it to a trip (trips around its date first) with who paid it – the company where a bank payment covers it, else privately; or starts a new trip from it with its destination and times as read.

- **Another currency:** a receipt counts in euros, never its amount as euros: by the outlay it was booked as ([outlays.md](outlays.md)), the payment it is linked to, or a rate kept on the receipt – fetched from the bridge (ECB, for the ruble the Bank of Russia) or typed as people say it, "1 EUR = 95,23 RUB". Without one it counts for nothing and the statement waits for it. Foreign VAT is no German input VAT.
- **Hospitality:** **"Als Bewirtung erfassen …"** on a restaurant bill, with or without a trip: place, participants, occasion, a tip and who received it. The net costs and the tip are split 70 % deductible, the rest not; the VAT counts in full. What the law asks for and is missing is named.

## Recognising travel

Nothing is assigned or created by itself; everything below proposes, a click decides.

- **Reading a receipt** (with AI, in the extraction that runs anyway) gives a travel cost's kind (train, bus, flight, hotel, restaurant, fuel, taxi, parking, event …), the route and times there and back, a hotel's nights and whether breakfast is included. See [ai.md](ai.md).
- **Without AI,** words that tickets and bills print in German, English, Russian, Ukrainian, Polish, Czech, Turkish, Arabic, Spanish, Italian and French give a receipt its kind – from its file name, subject, sender, and the text of an unread PDF, read in the browser. A hint only: no route, no times, no question.
- **Trip proposals,** by rules: fares and hotels that fit together by days and route become one proposal ("Reise nach Musterstadt, 08.04. 07:12 – 09.04. 20:41"), with the taxi, fuel, parking, restaurant and event receipts of those days. Monday there and Wednesday back is one trip; two day trips in one week are two. One click makes the trip, or adds the receipts to a trip already there; **"Keine Reise"** dismisses a proposal for good.
- **Appointments from invitations:** a calendar part (`.ics`) of a mail to the accounting address becomes an appointment – title, place and times only, never attendees, organiser or links. It gives a proposal on its days its occasion; on Reisen, one somewhere else is offered as **"Reise dazu anlegen"**. Online appointments and those without a place never hint at a trip. Invitations reach Belege by being sent or forwarded to the accounting address.

## The statement

One statement per traveller and month, on Reisen:

- **Before:** the totals – allowances, mileage, receipts paid privately, those booked as outlays (paid back there), those paid by the company (listed, not paid back) – and **checks**: a trip without times, destination or reason, a hospitality bill with gaps, a private receipt without an amount or without a rate block it; a day abroad without a rate or with another country's, a family member's car or another currency are warnings printed on it.
- **"Abrechnung erstellen"** numbers it (`RK-2026-001`), draws a German A4 PDF in the look of the Eigenbelege – trips with times, allowance per day, mileage, receipts, hospitality, totals, input VAT by rate, the rates used with their sources, the warnings, a line to sign – and keeps it as a receipt for the payout.
- A made statement keeps everything it printed, the rates included, and is **not changed**. A correction is a new statement with a new number that refers to it; the old one stays, marked replaced.

## Bookkeeping

The statement is booked on the traveller's account **"Reisekosten <name>"**, an account without an import. Its ledger account is the traveller's clearing account: an employee's own, the owner's from the legal form where none is set (Buchhaltung): the shareholder clearing account of a UG/GmbH, 1890 for a sole proprietor or partnership. An employee's statement uses the employee accounts (466x) whatever the legal form. The hospitality bills of no trip are in the owner's statement only. Each line an outflow on the month's last day, in euros:

|                                                  | UG/GmbH (the managing shareholder is employed) | Sole proprietor, partnership |
| ------------------------------------------------ | ---------------------------------------------- | ---------------------------- |
| Fares, fuel, parking, taxi                       | 4663                                           | 4673                         |
| Accommodation (an employee's flat rates too)     | 4666                                           | 4676                         |
| Meal allowances (month's total, no VAT)          | 4664                                           | 4674                         |
| Mileage (month's total, no VAT)                  | 4668                                           | 4673                         |
| Other on a trip                                  | 4660                                           | 4670                         |
| Hospitality: 70 % of net plus the VAT / the rest | 4650 / 4654                                    | 4650 / 4654                  |

- A receipt paid privately is booked with its gross and the BU key of its German VAT, linked to it; allowances and mileage are linked to the statement.
- Receipts booked as outlays and those paid by the company are not booked again. A receipt on a trip paid from a business account is suggested its travel account too.
- Each line is suggested its account; **"Konten … übernehmen"** in the export confirms them with the other automatic suggestions. A correction reverses the lines of the statement it replaces, then books its own.
- The lines go into the month's DATEV Buchungsstapel, the statement and its receipts into the ZIP ([export.md](export.md)).

## The payout

The bank transfer to the traveller is linked to the statement's PDF, as any payment to its receipt. On the transfer, **"Zahlt Reisekosten aus …"** offers the open statements, the one its purpose names (`RK-…`) ticked, else those whose amounts add up to it – only the traveller's whose IBAN digits the receiving account ends in, where it does.

- Several transfers pay one statement in parts; one transfer can pay several, the oldest first; too much is said as such. A correction takes over what was paid on the statement it replaces.
- The payout is booked against the traveller's clearing account: an employee's own; the owner's own where set, else by the money's way, as a private repayment.
- Reisen says whether the statement is paid out, in part or too much.

## Advances

Money paid to a traveller before a trip ([#381](https://github.com/Le-Space/belege/issues/381)). On the payment, **"Vorschuss für Reisekosten …"** marks it, for a person (by the IBAN digits where they match) and, if it is known, for a trip.

- It needs no receipt of its own: the statement documents it. It is booked against the traveller's clearing account, as the payout is.
- **Settled with the statements:** an advance for a trip goes on the statement that has the trip, all of it; one for no trip goes on the traveller's statements, the oldest first, as far as their costs go. What no statement takes yet is shown on the payment as not accounted for.
- **The statement** shows "Bereits als Vorschuss gezahlt" and what is left to pay out; the PDF lists the advances. More advance than costs leaves a claim on the traveller, said on the statement. A correction takes over the advances of the statement it replaces.
- "Kein Vorschuss" takes the mark back; the payment waits for a receipt again.

## Open points

On Reisen, and counted on Home and Rückfragen:

- a ticket, flight or hotel read as such without a trip (not one a proposal covers or that was dismissed);
- a trip without times, or with gaps;
- a hospitality bill without what the law asks for;
- a statement not paid out two weeks after it was made.

## Not yet

- Pay above the statutory allowances: Belege pays back exactly those and receipts at their amount, so it names nothing as wage-tax relevant; the tax adviser confirms.
- A company credit card's statement taken line by line.

The rates, accounts and the treatment of a family member's car are to be confirmed with the tax adviser; this describes what Belege does, not tax advice.
