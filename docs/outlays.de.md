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
  - Für den Rubel hat die EZB seit dem 1. März 2022 keinen Kurs. Für RUB bietet die Bridge dann den **amtlichen Kurs der Bank of Russia** an, der an diesem Tag gilt (festgesetzt am Werktag davor; das Formular nennt sein Datum). Sie sieht nur den abgefragten Tag.
  - Wo keiner von beiden einen hat, oder wo ein Dokument den tatsächlich bezahlten Kurs zeigt (Kartenabrechnung, Wechselbeleg), wird der Kurs von Hand eingetragen (EUR je Einheit), mit seiner Herkunft. Ein Kurs aus einem Dokument geht vor: Er liegt näher an dem, was bezahlt wurde.
  - Originalbetrag, Kurs und Kursquelle bleiben an der Buchung.
- **Rückgängig:** _Auslage rückgängig machen_ löscht die Buchung und gibt den Beleg frei, falls doch noch eine Zahlung auftaucht. Erneutes Buchen legt eine neue Buchung an.

## Das Konto

- _Auslagen Geschäftsführung_ ist ein Konto ohne Import (`source: outlay`): Seine Buchungen kommen nur aus Belegen. Es erscheint in Zahlungen, im Kontofilter und im Export wie jedes Konto.
- **Sachkonto:** aus der Rechtsform unter _Buchhaltung_:
  - eine UG/GmbH bucht gegen ihr Gesellschafter-Verrechnungskonto;
  - Einzelunternehmen und Personengesellschaften gegen 1890 (Privateinlage).
  - Bis das gesetzt ist, fragt der Export danach wie bei jedem Konto.
- **Das Aufwandskonto jeder Buchung** wird wie üblich vorgeschlagen und bestätigt.

## Privat, nicht geschäftlich

Belege aus dem privaten Postfach liegen neben rein privaten. **„Privat, nicht geschäftlich“** am Beleg sortiert ihn als privat aus, auf Wunsch mit Grund (`private Reise`):

- er bleibt aus dem Abgleich, aus den Rückfragen und aus dem Export; eine Zuordnung wird gelöst;
- er erscheint als _Privat_ mit seinem Grund, und die Entscheidung steht im Protokoll;
- _Wieder aufnehmen_ holt ihn zurück.

Ein teils geschäftlicher Beleg (ein Hotel mit einer privaten Nacht) wird mit dem geschäftlichen Anteil als Auslage gebucht; die Aufteilung selbst gehört zu den Reisekosten (#213).

## Zurückzahlen

Die Firma überweist das Geld vom Geschäftskonto zurück. An dieser Überweisung listet **„Erstattet Auslagen …“** die offenen Auslagen:

- angehakt sind die, deren Summe genau den Betrag der Überweisung ergibt, die ältesten bevorzugt; sonst die ältesten, bis die Überweisung aufgebraucht ist. Die Haken lassen sich ändern, dann _Als Erstattung verknüpfen_;
- eine Überweisung kann mehrere Auslagen erstatten, mehrere Überweisungen eine Auslage. Es zählt die Summe über alles, was miteinander verknüpft ist; die ältesten Auslagen werden zuerst ausgeglichen;
- die Überweisung braucht keinen eigenen Beleg (Kennzeichen _Erstattung Auslagen_): Die Belege der Auslagen belegen sie. Sie wird gegen das Privatkonto der Rechtsform gebucht, wie eine private Rückzahlung: bei einer UG/GmbH das Gesellschafter-Verrechnungskonto, bei Einzelunternehmen und Personengesellschaften 1800 (Privatentnahme), denn ihre Auslagen waren Einlagen;
- jede Auslage zeigt, ob sie erstattet ist, teilweise oder noch nicht, und durch welche Überweisung; eine Verknüpfung lässt sich lösen (_lösen_);
- **Home** listet die noch nicht erstatteten Auslagen mit dem offenen Betrag.

## Noch nicht (Issue #293)

- Angestellte als weitere Personen.

Konten und Kurse sind mit der Steuerberatung abzustimmen; das beschreibt, was Belege tut, keine Steuerberatung.
