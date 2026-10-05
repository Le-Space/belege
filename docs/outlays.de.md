# Private Auslagen

_English: [outlays.md](outlays.md)_

Manche Kosten des Unternehmens bezahlt die Geschäftsführung privat: bar im Ausland, mit einer privaten Karte. Dieses Geld kann Belege nicht einlesen, also würde ein solcher Beleg ewig auf eine Bankzahlung warten. **„Privat ausgelegt …“** am Beleg bucht ihn auf ein eigenes Konto, _Auslagen Geschäftsführung_, und ordnet den Beleg dieser Buchung zu. Der Beleg ist gedeckt.

## Einen Beleg als Auslage buchen

Belege → der Beleg → _Privat ausgelegt …_:

- **Bezahlt:** bar, mit privater Karte oder anders. Das steht an der Buchung (`Privat ausgelegt (bar) · Rechnung …`).
- **Am:** das Datum des Belegs, änderbar.
- **Betrag:** der Bruttobetrag des Belegs. Eine Ausgabe geht vom Konto ab, eine Gutschrift kommt hinzu.
- **Andere Währung:**
  - Belege fragt die Bridge nach dem EZB-Referenzkurs des Tages und bucht den Euro-Betrag damit.
  - Wo die EZB keinen hat (der Rubel: kein Kurs seit dem 1. März 2022), wird der Kurs von Hand eingetragen (EUR je Einheit), mit seiner Herkunft: Kartenabrechnung, Wechselbeleg.
  - Originalbetrag, Kurs und Kursquelle bleiben an der Buchung.
- **Rückgängig:** _Auslage rückgängig machen_ löscht die Buchung und gibt den Beleg frei, falls doch noch eine Zahlung auftaucht. Erneutes Buchen legt eine neue Buchung an.

## Das Konto

- _Auslagen Geschäftsführung_ ist ein Konto ohne Import (`source: outlay`): Seine Buchungen kommen nur aus Belegen. Es erscheint in Zahlungen, im Kontofilter und im Export wie jedes Konto.
- **Sachkonto:** aus der Rechtsform unter _Buchhaltung_:
  - eine UG/GmbH bucht gegen ihr Gesellschafter-Verrechnungskonto;
  - Einzelunternehmen und Personengesellschaften gegen 1890 (Privateinlage).
  - Bis das gesetzt ist, fragt der Export danach wie bei jedem Konto.
- **Das Aufwandskonto jeder Buchung** wird wie üblich vorgeschlagen und bestätigt.

## Noch nicht (Issue #293)

- Einen Beleg als „privat, nicht geschäftlich“ markieren.
- Auslagen zurückzahlen: eine Überweisung, abgeglichen mit offenen Auslagen.
- Eine Kursquelle für Währungen ohne EZB-Kurs außer von Hand.
- Angestellte als weitere Personen.

Konten und Kurse sind mit der Steuerberatung abzustimmen; das beschreibt, was Belege tut, keine Steuerberatung.
