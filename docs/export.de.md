# Konten und der monatliche DATEV-Export

_English: [export.md](export.md)_

Einmal im Monat macht Belege eine ZIP-Datei für die Buchhaltung: die Buchungen des Monats als **DATEV-Buchungsstapel** (EXTF-CSV) zum Import in **MonkeyOffice** und die Belege als Dateien. Die ZIP-Datei entsteht im Browser und wird heruntergeladen; nichts geht an einen Server, nichts an das Sprachmodell.

```
DATEV_2026-09.zip
├── DATEV/EXTF_Buchungsstapel_2026-09.csv   Windows-1252, für den Import
├── Belege/2026-09-001_Kabelnetz_Beispiel_GmbH.pdf
├── Belege/2026-09-002_….pdf
├── Kontoauszuege/KA-2026-09-1200_Konto_A.pdf     ein Auszug je Konto mit Buchungen im Monat
├── Kontoauszuege/KA-2026-09-1340_Kraken_BTC.pdf
└── Uebersicht_2026-09.csv                  UTF-8, zum Lesen: jede Buchung, ihr Konto, Belegnummer, wie der Beleg zugeordnet wurde
```

## Vor dem Export

1. **Sachkonten der Bankkonten** – _Integrationen → Eigene Anweisungen → Buchhaltung (MonkeyOffice / DATEV)_: für jedes Bankkonto die Nummer, unter der es in MonkeyOffice geführt wird. Das Feld zeigt 1200, 1210, … (SKR 03) nur als Platzhalter.
2. **Kopfwerte** – ebenda: Beraternummer und Mandantennummer (voreingestellt 1001 und 1, das nimmt MonkeyOffice für die eigene Buchhaltung meist an – prüfe, was dein MonkeyOffice erwartet), der Monat, in dem das Wirtschaftsjahr beginnt (Januar), die Sachkontenlänge (4).
3. **Ein Konto für jede Buchung** – in jeder Zahlung unter _Konto_. Die App schlägt vor, du übernimmst mit _Übernehmen_:
   - eigene Umbuchung → **1360** Geldtransit, Bankgebühr → **4970** Nebenkosten des Geldverkehrs, beide ohne BU-Schlüssel;
   - _gelernt_: das Konto, das du diesem Anbieter zuletzt gegeben hast (über den Anbieter des Belegs oder die Gegenpartei auf dem Kontoauszug);
   - sonst nichts: aus der SKR-03-Liste wählen (Suche nach Nummer oder Name) oder eine beliebige 4- bis 8-stellige Nummer eingeben.

   Der BU-Schlüssel kommt aus dem zugeordneten Beleg: USt 19 % → 9, 7 % → 8 bei Ausgaben; 19 % → 3, 7 % → 2 bei Einnahmen; `reverse_charge` → 94; kein Schlüssel ohne USt, bei mehreren oder ausländischen Sätzen und auf einem Automatikkonto (8400, 8300). Die Schlüssel lassen sich in den Einstellungen ändern.

Die Export-Seite zeigt, was fehlt. **Exportiert wird nur, wenn jede Buchung des Monats ein übernommenes Konto hat und jedes Bankkonto sein Sachkonto.** Gebühren und Umbuchungen sind keine Ausnahme: ihr Vorschlag ist automatisch, übernommen wird er trotzdem – ein Klick, _Konten aus Umbuchung und Bankgebühr übernehmen_, erledigt alle. (Die Alternative, eine Einstellung, die automatische Konten ohne Bestätigung nimmt, fiel weg: ein Schalter mehr, und eine falsche Einordnung käme ungesehen in die Bücher.) Buchungen ohne Beleg, Belege ohne Zahlung und noch nicht bestätigte Absender sind Hinweise: der Export geht, aber schau sie dir an.

## Import in MonkeyOffice

MonkeyOffice importiert DATEV-Buchungsstapel über seinen DATEV-Import (die Menünamen unterscheiden sich je nach Version; die Hilfe führt ihn unter „DATEV“). `DATEV/EXTF_Buchungsstapel_<Monat>.csv` importieren, die Buchungen in der Vorschau prüfen, dann die Belege aus `Belege/` über ihre Nummer anhängen (sie steht in _Belegfeld 1_ und vorn im Dateinamen). Der erste Import ist ein Test: in einer Kopie der Firma, oder jede Zeile vor dem Buchen prüfen.

## Das Format

- EXTF, Version 700, Kategorie 21 „Buchungsstapel“, Formatversion 13. Zeile 1: 31 Kopffelder; Zeile 2: die 125 Spaltenüberschriften; dann eine Zeile je Buchung mit 125 Feldern (nur die ersten 14 gefüllt).
- `;` zwischen den Feldern, CRLF nach jeder Zeile, Text in doppelten Anführungszeichen, innere verdoppelt, leere Felder ganz leer. Windows-1252 (ANSI); ein Zeichen, das es dort nicht gibt, verliert seinen Akzent oder wird `?`.
- Betrag positiv, Dezimalkomma, keine Tausenderpunkte. **S/H bezieht sich auf _Konto_**, das Sachkonto der Bank: Geld herein ist S, Geld hinaus ist H. _Gegenkonto_ ist das übernommene Konto.
- _Belegdatum_ `TTMM` = Buchungstag (das Jahr nimmt DATEV aus dem Wirtschaftsjahr, und jede Zeile liegt im Zeitraum des Stapels). _Belegfeld 1_ = Belegnummer `JJJJ-MM-NNN` (höchstens 36 Zeichen). _Buchungstext_ = Anbieter des Belegs, sonst Gegenpartei, sonst Verwendungszweck (höchstens 60).
- Eine Buchung mit mehreren Belegen: die Nummer des ersten in _Belegfeld 1_, alle in der ZIP-Datei.
- _KOST1_ (Kostenstelle): die Kostenstelle des Kontos der Buchung, je eigener Wallet unter _Integrationen → Eigene Wallets_ angegeben (Buchstaben und Ziffern, höchstens 36). Keine bei einer Umbuchung, die einmal zwischen zwei Banken exportiert wird.
- Eine Buchung ohne eigenen Beleg (Bank- oder Börsengebühr, eigene Umbuchung, Staking-Ertrag, Einnahme noch ohne Rechnung): die Auszug-Nummer ihres Kontos `KA-JJJJ-MM-<Sachkonto>` in _Belegfeld 1_. Der Auszug liegt in `Kontoauszuege/`.
- **Eine eigene Umbuchung**, deren Gegenbuchung in den Büchern steht, kommt **einmal** hinein: vom Bankkonto mit dem kleineren Sachkonto gegen das Sachkonto der anderen Bank (1200 → 1210, nicht über 1360: mit nur einer Zeile bliebe 1360 offen). Die andere Seite steht in der Übersicht als „nicht im Buchungsstapel“. Eine Umbuchung ohne Gegenbuchung in den Büchern behält 1360.
- Belegnummern werden in Buchungsreihenfolge vergeben und bleiben am Beleg, sobald er exportiert ist: ein zweiter Export des Monats gibt dieselben Nummern, ein später dazugekommener Beleg die nächste.
- Code: `app/src/lib/export/datev.js` (das ganze Format, ein Modul), `plan.js` (was hineinkommt, die Prüfliste), `build.js` (die ZIP-Datei, mit [fflate](https://github.com/101arrowz/fflate), erst auf der Export-Seite geladen), `cp1252.js`; Konten in `app/src/lib/booking/`.

### Was an einer Quelle geprüft ist und was nicht

- **Feldliste, Reihenfolge und Regeln** folgen dem quelloffenen Ruby-Gem [ledermann/datev](https://github.com/ledermann/datev) (Kopf, Buchungsfelder, seine Beispieldatei `EXTF_Buchungsstapel.csv` für Formatversion 13), das der DATEV-Entwicklerdokumentation folgt. Die DATEV-Seiten selbst ließen sich hier nicht lesen. Zwei Überschriften folgen dem Auftrag für diesen Export (`Basis-Umsatz`, `WKZ Basis-Umsatz`; das Gem schreibt `Basisumsatz`); DATEV liest nach Position.
- Kopffelder 8–10 und 18 (Herkunft, Exportiert von, Importiert von, Diktatkürzel) bleiben leer, 27 (SKR) auch. Will MonkeyOffice sie haben, ist `headerLine` in `datev.js` die eine Stelle.
- **SKR-03-Namen** im Katalog sind mit den öffentlichen Kontoseiten von buchungssatz.de verglichen, nicht mit dem DATEV-Kontenrahmen. **BU-Schlüssel** 9/8/3/2 und 94 für §13b sind die üblich dokumentierten SKR-03-Schlüssel (DATEV-Community, Hilfeseiten von Buchhaltungssoftware); nicht bei DATEV selbst geprüft.
- **Mit MonkeyOffice noch nicht getestet.** Der erste echte Import ist der Test.

## Monatsauszüge

Jedes Konto mit einer Buchung im Monat bekommt einen Auszug als PDF, egal ob Bankkonto, Börsenkonto oder Wallet (`app/src/lib/export/statement.js`, gezeichnet von `statement-pdf.js`). Er listet jede Buchung des Monats auf diesem Konto mit ihrer Belegnummer oder dem, was dafür steht (_Umbuchung_, _Gebühr_, _Ertrag_), und die Summen der Eingänge, der Ausgänge und des Monats.

Ein Krypto-Konto zeigt zusätzlich Menge und Kurs jeder Buchung mit der Quelle des Kurses (K = Kraken, CG = CoinGecko, EZB = EZB-Referenzkurs, H = Preis des Handels). Anfangs- und Endbestand im Asset werden aus dem letzten Bestand zurückgerechnet, den die Börse gemeldet hat.

Bei einem Bankkonto zeigt der Auszug, was Belege gespeichert hat. Den Kontoauszug der Bank ersetzt er nicht.

## Eigenbeleg

Für eine Zahlung ohne Beleg der Gegenseite, etwa Gebühren auf einer Blockchain, die keine Rechnungen ausstellt, bietet die Detailansicht der Zahlung **Eigenbeleg erstellen** (`app/src/lib/receipts/eigenbeleg.js`). Du schreibst, was bezahlt wurde und warum es keinen Beleg gibt; bei einer Krypto-Zahlung ist der Grund schon vorbelegt. Belege erzeugt daraus ein PDF mit:

- eigenem Nummernkreis (`EB-JJJJ-NNN`), Datum, Betrag und Konto;
- Empfänger bzw. zahlender Seite;
- bei Krypto: Menge, Kurs mit Quelle und Transaktionsreferenz;
- was bezahlt wurde und warum es keinen Fremdbeleg gibt;
- wer ihn wann erstellt hat, mit einer Zeile für die Unterschrift.

Das PDF wird wie ein hochgeladener Beleg gespeichert und der Zahlung als deine Entscheidung zugeordnet. Der Export nummeriert es wie jeden anderen Beleg und legt es in `Belege/`.

Ein Eigenbeleg ist keine Rechnung und berechtigt nicht zum Vorsteuerabzug.

## Mit der Steuerberatung klären

- Ob und bis zu welchem Betrag Eigenbelege für Zahlungen ohne Beleg anerkannt werden (Blockchain-Gebühren, Lease-Zahlungen).
- Die **Konten**: der Katalog ist ein Ausgangspunkt (z. B. 4964 heißt „Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)“ – passt das für Software-Abos?).
- Die **BU-Schlüssel**, vor allem **§13b**: 94 ist der übliche Schlüssel für eine Leistung aus dem Ausland zu 19 %; es gibt andere (etwa für Waren aus der EU). Welche Automatikkonten dein Kontenrahmen hat (8400 und 8300 gelten als solche: kein Schlüssel).
- **Beraternummer, Mandantennummer**, Sachkontenlänge und Wirtschaftsjahr, wie MonkeyOffice sie führt.
- Ob der Buchungstag als _Belegdatum_ für dich richtig ist oder das Datum des Belegs.

## Dein eigener Kontenplan

Unter _Integrationen → Eigene Anweisungen → Kontenplan_ liest die App den Kontenplan deines Buchhaltungsprogramms ein; danach schlägt „Konto“ deine Konten mit deinen Bezeichnungen vor statt der eingebauten SKR-03-Liste und markiert Nummern, die es in deinem Plan nicht gibt.

- **MonKey Office:** Seitenleiste → _Import & Export → Export DATEV → Kontenbeschriftungen_ (auf Wunsch nur ein Bereich _von Konto … bis Konto_) → die CSV-Datei einlesen.
- **Andere Programme mit DATEV-Schnittstelle:** der Export _Kontenbeschriftungen_ (eine Datei, die mit `EXTF` beginnt, Datenkategorie 20).
- **Sonst:** jede CSV- oder Textdatei mit einer Spalte Kontonummern (4–8 Ziffern) und einer Spalte Bezeichnungen, getrennt durch Semikolon, Komma oder Tab. UTF-8 und Windows-1252 werden beide gelesen.

Der Kontenplan bleibt verschlüsselt in deinen Büchern im Browser, wie jeder Datensatz. _Entfernen_ führt zurück zur SKR-03-Liste.
