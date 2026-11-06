# Konten und der monatliche DATEV-Export

_English: [export.md](export.md)_

Einmal im Monat macht Belege eine ZIP-Datei für deine Buchhaltung. Darin liegen zwei Dinge:

- die Buchungen des Monats als **DATEV-Buchungsstapel**. Das ist eine CSV-Datei im Format EXTF, die DATEV und die meisten Buchhaltungsprogramme einlesen können.
- die Belege als Dateien.

Die ZIP-Datei entsteht in deinem Browser, und du lädst sie herunter. Nichts geht dabei an einen Server. Nichts geht an das Sprachmodell.

## Was im ZIP liegt

```
DATEV_2026-09.zip
├── DATEV/EXTF_Buchungsstapel_2026-09.csv   Windows-1252, für den Import
├── Belege/2026-09-001_Kabelnetz_Beispiel_GmbH.pdf
├── Belege/2026-09-002_….pdf
├── Kontoauszuege/KA-2026-09-1200_Konto_A.pdf     ein Auszug je Konto mit Buchungen im Monat
├── Kontoauszuege/KA-2026-09-1340_Kraken_BTC.pdf
└── Uebersicht_2026-09.csv                  UTF-8, zum Lesen: jede Buchung, ihr Konto, Belegnummer, wie der Beleg zugeordnet wurde
```

- **`DATEV/`** enthält den Buchungsstapel für den Import.
- **`Belege/`** enthält jeden zugeordneten Beleg. Vorn im Dateinamen steht seine Belegnummer, dahinter der Anbieter. Ein Bild bleibt ein Bild (PNG, JPG, …).
- **`Kontoauszuege/`** enthält einen Monatsauszug je Konto, siehe [Monatsauszüge](#monatsauszüge). Du kannst die Auszüge auf der Export-Seite abwählen. Standardmäßig sind sie dabei.
- **`Aktennotizen/`** gibt es nur, wenn im Monat eine private Zahlung vom Geschäftskonto ging. Dann liegt dort deine Notiz dazu als Textdatei. Sie ist der Beleg dieser Zahlung (#172).
- **`Uebersicht_<Monat>.csv`** ist zum Lesen gedacht. Sie nennt jede Buchung, ihr Konto, ihre Belegnummer und wie der Beleg zugeordnet wurde. Sie sagt auch, was nicht im Buchungsstapel steht und warum.

Der Name der ZIP-Datei sagt es, wenn sie nicht für die Buchhaltung ist:

- **`TEST_DATEV_…`**: Du hast Testbuchungen mit exportiert. So ein Paket ist zum Ausprobieren da.
- **`BEISPIEL_DATEV_…`**: Der Monat besteht nur aus Beispieldaten.

Code: `app/src/lib/export/build.js`.

### E-Rechnungen

Eine E-Rechnung ist eine Rechnung als XML-Datei. Bei ihr ist das XML das Original, das du aufbewahren musst.

- Eine **XRechnung** (#160) kommt so ins ZIP, wie sie kam: als `Belege/<Nummer>_<Anbieter>.xml`.
- Eine **ZUGFeRD- oder Factur-X-Rechnung** ist ein PDF mit eingebettetem XML. Sie kommt als PDF ins ZIP. Daneben liegt unter derselben Nummer ihr XML.
- Eine Rechnung, die die **Rechnungs-App** als XRechnung ausgestellt hat, kommt genauso hinein: ihr PDF und ihr XML als Original (#515).

### Belege aus einer E-Mail ohne Anhang

Manchmal steht eine Quittung im Text der Mail selbst, ohne Anhang. Belege bewahrt so eine Mail auf, wie sie ankam. Sie ist versiegelt wie jede andere Datei (#288). Im ZIP liegen dann zwei Dateien:

- `Belege/<Nummer>_<Anbieter>.eml`: die Mail selbst.
- ein PDF daraus mit Absender, Tag, Betreff und dem ganzen Text der Mail. Der Text kommt aus dem Textteil der Mail. Fehlt der, wird der HTML-Teil in Text umgewandelt. Das HTML selbst kommt nie ins PDF.

Ältere Belege haben das Original nicht:

- Ein Beleg, der importiert wurde, bevor Belege das Original behielt, hat nur einen Auszug vom Abruf. Der Auszug hat höchstens etwa 2.000 Zeichen.
- Das Original kommt dazu, wenn seine Mail wieder abgerufen wird. Oder du klickst im Beleg auf _Original holen_. Das geht, solange die Mail noch im Postfach liegt. Liegt sie nicht mehr dort, sagt es der Beleg.
- Bis dahin entsteht das PDF aus dem Auszug. Ist der Auszug gekürzt, steht das im PDF. Die Übersicht nennt das PDF „aus der Mail erzeugt“.

Die Bridge ist das kleine Programm auf deinem Rechner, das unter anderem dein Postfach abruft. Sie gibt eine ganze Mail nur heraus, wenn die Mail an die Buchhaltungsadresse ging.

## Vor dem Export

Drei Dinge brauchst du, bevor der erste Export geht.

### 1. Die Sachkonten deiner Bankkonten

Ein **Sachkonto** ist die Nummer, unter der ein Konto in deiner Buchhaltung geführt wird. Jedes Bankkonto braucht seines.

- Du trägst es unter _Einstellungen → Buchhaltung (DATEV)_ ein.
- Das Feld zeigt 1200, 1210, … als Platzhalter. Das sind übliche Nummern im Kontenrahmen SKR 03. Trag die Nummer ein, die deine Buchhaltung wirklich nutzt.

### 2. Die Kopfwerte

Am selben Ort stehen die Werte, die oben in jedem Buchungsstapel stehen:

- **Beraternummer** und **Mandantennummer**. Voreingestellt sind 1001 und 1. Das ist üblich, wenn eine Firma ihre Bücher selbst führt. Prüfe, was deine Buchhaltung erwartet.
- der Monat, in dem dein **Wirtschaftsjahr** beginnt. Voreingestellt ist Januar.
- die **Sachkontenlänge**, also wie viele Stellen deine Sachkonten haben. Voreingestellt ist 4.

### 3. Ein Konto für jede Buchung

Jede Buchung braucht ein Konto: das **Gegenkonto**, auf dem sie in der Buchhaltung landet. Du findest es in jeder Zahlung unter _Konto_. Die App schlägt ein Konto vor. Du bestätigst es mit _Übernehmen_.

So kommt der Vorschlag zustande:

- **Eigene Umbuchung** zwischen zwei deiner Konten → **1360** Geldtransit, ohne BU-Schlüssel.
- **Bankgebühr** → **4970** Nebenkosten des Geldverkehrs, ohne BU-Schlüssel.
- **Private Zahlung** vom Geschäftskonto oder ihre Rückzahlung → das Konto, das zu deiner Rechtsform passt (#172).
- **Lohn, Lohnsteuer, Sozialabgaben oder eine Steuerzahlung** → das Konto, unter dem sie gebucht werden, wo es bekannt ist (#233).
- **Reisekosten** → das Konto aus der Reisekostenabrechnung (#213).
- **_gelernt_**: das Konto, das du diesem Anbieter zuletzt gegeben hast. Belege erkennt den Anbieter am Beleg oder an der Gegenpartei auf dem Kontoauszug.
- **Sonst nichts.** Dann wählst du aus der SKR-03-Liste. Du kannst nach Nummer oder Name suchen. Oder du tippst eine beliebige Nummer mit 4 bis 8 Ziffern ein.

### Der BU-Schlüssel

Der **BU-Schlüssel** sagt der Buchhaltung, welche Umsatzsteuer zu einer Buchung gehört. Er kommt aus dem zugeordneten Beleg:

| Was auf dem Beleg steht         | Ausgabe (Geld geht hinaus) | Einnahme (Geld kommt herein) |
| ------------------------------- | -------------------------- | ---------------------------- |
| 19 % Umsatzsteuer               | 9                          | 3                            |
| 7 % Umsatzsteuer                | 8                          | 2                            |
| `reverse_charge` (§13b)         | 94                         | kein Schlüssel               |
| keine Umsatzsteuer              | kein Schlüssel             | kein Schlüssel               |
| mehrere oder andere Steuersätze | kein Schlüssel             | kein Schlüssel               |

Auf einem **Automatikkonto** gibt es nie einen Schlüssel. Bei einem Automatikkonto rechnet DATEV die Umsatzsteuer selbst. In SKR 03 sind das zum Beispiel 8400 und 8300.

Hat eine Buchung keinen Beleg, nimmt die App den Schlüssel, den sie für diesen Anbieter gelernt hat. Die Schlüssel lassen sich unter _Einstellungen → Buchhaltung (DATEV)_ ändern. Code: `app/src/lib/booking/suggest.js`, `tax-keys.js`.

### Was den Export aufhält und was nur ein Hinweis ist

Die Export-Seite zeigt, was noch fehlt. **Exportiert wird erst, wenn alles hier erledigt ist:**

- Jede Buchung des Monats hat ein übernommenes Konto. Mit dem [Sammelkonto](#optional-ein-sammelkonto-für-buchungen-ohne-konto-323) geht es auch ohne.
- Jedes Bankkonto mit Buchungen im Monat hat sein Sachkonto.
- Jede Krypto-Buchung hat einen Kurs. Ohne Kurs gibt es keinen Euro-Betrag (#162).
- Jede Buchung gehört zu einem Bankkonto in deinen Büchern.
- Im Monat stehen keine Beispieldaten neben echten Buchungen.

Auch Gebühren und Umbuchungen brauchen ein übernommenes Konto. Ihr Vorschlag kommt zwar automatisch, du bestätigst ihn aber trotzdem. Das geht für alle mit einem Klick: _Konten aus Umbuchung, Bankgebühr und Reisekostenabrechnung übernehmen_. Der Knopf übernimmt 1360 für Umbuchungen, 4970 für Bankgebühren und die Konten aus Reisekostenabrechnungen.

Warum keine Einstellung, die automatische Konten ohne Bestätigung nimmt? Das wäre ein Schalter mehr. Und eine falsche Einordnung käme ungesehen in die Bücher.

**Nur ein Hinweis sind:**

- Buchungen ohne Beleg und ohne „Kein Beleg nötig“.
- Belege des Monats, die keiner Zahlung zugeordnet sind. Sie kommen nicht in dieses ZIP.
- Belege, die nur Kopien schon zugeordneter Belege sind. Sortiere sie unter _Belege_ als Duplikat aus.
- Belege mit noch nicht bestätigtem Absender. Sie kommen nicht ins ZIP.

Der Export geht dann, aber schau dir diese Punkte an.

Code: `app/src/lib/export/plan.js`.

### Netzwerkgebühren einer Wallet auf einmal (#305)

Eine **Wallet** ist ein Konto auf einer Blockchain (kurz: Chain). Für jede Transaktion, die eine Wallet abschickt, nimmt die Chain eine kleine **Netzwerkgebühr**, oft etwa einen Cent. Das sind viele kleine Buchungen. Deshalb gibt es hier eine Ausnahme, die du selbst bestätigst:

- Klick in der Kontozeile einer Netzwerkgebühr auf _Für alle Netzwerkgebühren übernehmen_.
- Dann bekommt jede Netzwerkgebühr, die noch kein übernommenes Konto hat, dieses Konto.
- Das gilt auch für jede Gebühr, die eine spätere Synchronisierung bringt.
- _Regel aufheben_ nimmt das Konto bei diesen Gebühren wieder weg. Eine Gebühr, die du von Hand übernommen hast, behält ihr Konto.
- Bank- und Börsengebühren gehören nicht dazu.

Code: `app/src/lib/booking/fee-rule.js`.

### Optional: ein Sammelkonto für Buchungen ohne Konto (#323)

Der Normalfall bleibt: Jede Buchung bekommt vorher ihr Konto. Manchmal ist eine Buchung am Monatsende aber noch unklar. Dann kann der Export sie auf ein **Sammelkonto** legen, statt zu warten. Das ist üblich, wenn ein Stapel eingelesen wird, bevor jedes Gegenkonto feststeht.

**So schaltest du es ein:**

- **Einstellung:** Unter _Einstellungen → Buchhaltung (DATEV) → Sammelkonto für Buchungen ohne Konto_ trägst du eine Kontonummer ein. Standardmäßig ist das Feld leer. Belege schlägt keine Nummer vor. Welches Konto richtig ist, sagt dein Steuerberater. Bei SKR 03 ist es meist eines der Konten für durchlaufende oder ungeklärte Posten.
- **Export-Seite:** Dort erscheint dann _Buchungen ohne Konto auf das Sammelkonto … exportieren_. Das ist standardmäßig aus. Dein Browser merkt sich, wie du es eingestellt hast.

**Was sich ändert, wenn es an ist:**

- Eine Buchung ohne übernommenes Konto hält den Export nicht mehr auf. Die Prüfliste sagt als Hinweis, wie viele Buchungen auf das Sammelkonto gehen.
- Jede dieser Buchungen kommt mit dem Sammelkonto als Gegenkonto in den Stapel. Sie hat **keinen BU-Schlüssel**. Ihr Buchungstext beginnt mit `Ungeklärt:`. Ihr Beleg kommt wie sonst ins ZIP.
- Die Übersicht markiert sie mit _auf Sammelkonto, umbuchen_. Der Verlauf zählt sie.

**Was gleich bleibt:**

- Eine eigene Umbuchung, deren Gegenbuchung in den Büchern steht, geht wie immer gegen das Sachkonto der anderen Bank.
- Ein Bankkonto ohne Sachkonto hält den Export weiter auf.
- Buchungen ohne Beleg bleiben ein Hinweis.

**Wichtig:** Auf dem Sammelkonto gibt es keine Vorsteuer und kein Aufwandskonto. Deine Umsatzsteuer-Voranmeldung und dein Gewinn stimmen deshalb erst, wenn die Buchungen umgebucht sind. Zum Jahresende muss das Sammelkonto leer sein. Welches Konto ihr nehmt und wer umbucht, legt ihr mit dem Steuerberater fest. Das hier ist keine Steuerberatung.

## Import in deine Buchhaltung

Buchhaltungsprogramme und DATEV lesen einen Buchungsstapel über ihren DATEV-Import ein. Das Menü heißt in jedem Programm anders. In der Hilfe findest du es unter „DATEV“.

1. Lies `DATEV/EXTF_Buchungsstapel_<Monat>.csv` ein.
2. Prüfe die Buchungen in der Vorschau des Imports.
3. Häng die Belege aus `Belege/` an. Die Belegnummer steht im Feld _Belegfeld 1_ und vorn im Dateinamen.

Mach den ersten Import als Test. Nimm dafür eine Kopie der Firma, oder prüfe jede Zeile, bevor du buchst.

## Das Format

Dieser Teil ist für alle, die den Buchungsstapel prüfen oder anpassen wollen.

### Aufbau der Datei

- EXTF, Version 700, Kategorie 21 „Buchungsstapel“, Formatversion 13.
- Zeile 1 enthält 31 Kopffelder.
- Zeile 2 enthält die 125 Spaltenüberschriften.
- Danach folgt eine Zeile je Buchung mit 125 Feldern. Gefüllt sind die ersten 14 Felder und, wenn es eine Kostenstelle gibt, _KOST1_.

### Zeichen und Trennzeichen

- Zwischen den Feldern steht `;`. Nach jeder Zeile steht CRLF (der Zeilenumbruch von Windows).
- Text steht in doppelten Anführungszeichen. Ein Anführungszeichen im Text wird verdoppelt.
- Leere Felder bleiben ganz leer.
- Text, den eine Tabellenkalkulation als Formel lesen würde, bekommt vorn ein Apostroph. Das gilt auch für die Übersicht.
- Die Datei ist in Windows-1252 (ANSI) geschrieben. Ein Zeichen, das es dort nicht gibt, verliert seinen Akzent. Kyrillisch und Griechisch werden in lateinischen Buchstaben geschrieben (`Москва` → `Moskva`). Was dann noch fehlt, etwa Arabisch oder Chinesisch, wird `?`.
- Die PDFs im ZIP können mehr. Das sind die aus einer Mail gemachten Belege, die Kontoauszüge und die Eigenbelege. Sie zeigen Text in Latein, Kyrillisch, Griechisch und Arabisch. Dafür sind die Schriften DejaVu Sans und Noto Sans Arabic als Teilmengen eingebettet (`app/src/lib/pdf/fonts.js`).

### Betrag und Soll/Haben

- Der Betrag ist immer positiv. Er hat ein Dezimalkomma und keine Tausenderpunkte.
- **S/H (Soll/Haben) bezieht sich auf das Feld _Konto_.** Dort steht das Sachkonto der Bank. Geld herein ist S, Geld hinaus ist H.
- _Gegenkonto_ ist das übernommene Konto.
- Ist eine Buchung nicht in Euro, steht ihre Währung im Feld _WKZ Umsatz_.

### Die Felder einer Buchung

- **_Belegdatum_** (`TTMM`) ist der Buchungstag. Das Jahr nimmt DATEV aus dem Wirtschaftsjahr. Jede Zeile liegt im Zeitraum des Stapels.
- **_Belegfeld 1_** ist die Belegnummer `JJJJ-MM-NNN`, höchstens 36 Zeichen. Hat eine Buchung mehrere Belege, steht hier die Nummer des ersten. Alle kommen ins ZIP.
- **_Buchungstext_** ist der Anbieter auf dem Beleg. Gibt es keinen, ist es die Gegenpartei, sonst der Verwendungszweck. Höchstens 60 Zeichen.
  - Bei einer Krypto-Buchung steht am Ende die Menge, etwa `0,015 BTC`. Gekürzt wird vorher, damit die Menge nie abgeschnitten wird.
  - Lohn, Lohnsteuer, Sozialabgaben und Steuerzahlungen sagen stattdessen, was sie sind und für welchen Zeitraum, etwa „Lohn 12/2025“ mit dem Namen (#233).
- **_KOST1_** ist die Kostenstelle. Du gibst sie je eigener Wallet unter _Integrationen → Eigene Wallets_ an. Sie besteht aus Buchstaben und Ziffern, höchstens 36. Eine Umbuchung, die nur einmal zwischen zwei Banken exportiert wird, hat keine Kostenstelle.

### Buchungen ohne eigenen Beleg

Manche Buchungen haben keinen eigenen Beleg. Das sind etwa Bank- oder Börsengebühren, eigene Umbuchungen, Staking-Erträge oder eine Einnahme, zu der es noch keine Rechnung gibt.

- In _Belegfeld 1_ steht dann die Nummer des Monatsauszugs ihres Kontos: `KA-JJJJ-MM-<Sachkonto>`.
- Der Auszug liegt in `Kontoauszuege/`. Er ist der Beleg dieser Buchung.
- Wählst du die Kontoauszüge auf der Export-Seite ab, bleibt _Belegfeld 1_ bei diesen Buchungen leer. Es soll kein Dokument nennen, das nicht im ZIP liegt.

### Eigene Umbuchungen

Eine Umbuchung zwischen zwei deiner Konten hat zwei Seiten: Geld geht von einem Konto ab und kommt auf dem anderen an.

- Steht die Gegenbuchung in den Büchern und haben beide Seiten denselben Euro-Betrag, kommt die Umbuchung **nur einmal** in den Stapel.
- Exportiert wird die Seite des Bankkontos mit dem kleineren Sachkonto. Sie geht gegen das Sachkonto der anderen Bank, also zum Beispiel 1200 → 1210.
- Sie geht nicht über 1360. Mit nur einer Zeile bliebe 1360 sonst offen.
- Die andere Seite steht in der Übersicht als „nicht im Buchungsstapel“.
- Fehlt die Gegenbuchung in den Büchern, behält die Umbuchung 1360.
- Haben beide Seiten verschiedene Euro-Beträge, geht auch jede Seite gegen 1360. Das passiert etwa zwischen einer Börse und einer Wallet, die an verschiedenen Tagen bewertet wurden. Die Differenz bleibt dann auf 1360 sichtbar.

### Netzwerkgebühren als Sammelbuchung (#305)

Bei Akash, einer Blockchain für Rechenleistung, schreibt kein Lieferant eine Rechnung. Belege macht dafür einen monatlichen Verbrauchsnachweis als Eigenbeleg (siehe [crypto.de.md](crypto.de.md)). Die Netzwerkgebühren, die so ein Nachweis abdeckt, gehen zusammengefasst in den Stapel:

- eine Zeile je Nachweis, Konto, Gegenkonto, BU-Schlüssel und Kostenstelle;
- mit der Summe der Gebühren, am Tag der letzten Gebühr und mit der Belegnummer des Nachweises;
- als Buchungstext etwa „Netzwerkgebühren Akash 09/2026 (12 Tx)“.

Die einzelnen Gebühren stehen im Nachweis. Eine einzelne Gebühr bleibt eine eigene Zeile. Auf der Export-Seite lässt sich die Sammelbuchung abwählen. Standardmäßig ist sie an.

### Belegnummern

- Belegnummern werden in der Reihenfolge der Buchungen vergeben.
- Ist ein Beleg einmal exportiert, behält er seine Nummer. Ein zweiter Export desselben Monats gibt also dieselben Nummern.
- Ein Beleg, der später dazukommt, bekommt die nächste freie Nummer.

### Wo der Code liegt

- `app/src/lib/export/datev.js`: das ganze Format in einem Modul.
- `plan.js`: was in den Export kommt, und die Prüfliste.
- `build.js`: die ZIP-Datei. Sie entsteht mit [fflate](https://github.com/101arrowz/fflate). Das wird erst auf der Export-Seite geladen.
- `cp1252.js`: die Umwandlung nach Windows-1252.
- Die Konten liegen in `app/src/lib/booking/`.

### Was an einer Quelle geprüft ist und was nicht

- **Feldliste, Reihenfolge und Regeln** folgen dem quelloffenen Ruby-Gem [ledermann/datev](https://github.com/ledermann/datev). Geprüft sind Kopf, Buchungsfelder und seine Beispieldatei `EXTF_Buchungsstapel.csv` für Formatversion 13. Das Gem folgt der Entwicklerdokumentation von DATEV. Die Seiten von DATEV selbst ließen sich hier nicht lesen.
- **Zwei Überschriften** folgen dem Auftrag für diesen Export: `Basis-Umsatz` und `WKZ Basis-Umsatz`. Das Gem schreibt `Basisumsatz`. DATEV liest die Felder nach ihrer Position, nicht nach der Überschrift.
- **Leer bleiben** die Kopffelder 8–10 und 18 (Herkunft, Exportiert von, Importiert von, Diktatkürzel) und das Feld 27 (SKR). Will deine Buchhaltung sie haben, ist `headerLine` in `datev.js` die eine Stelle dafür.
- **Die SKR-03-Namen** im Katalog sind mit den öffentlichen Kontoseiten von buchungssatz.de verglichen. Mit dem Kontenrahmen von DATEV sind sie nicht verglichen.
- **Die BU-Schlüssel** 9, 8, 3, 2 und 94 für §13b sind die üblich dokumentierten Schlüssel für SKR 03. Quellen sind die DATEV-Community und Hilfeseiten von Buchhaltungssoftware. Bei DATEV selbst sind sie nicht geprüft.
- **Mit einem echten Import ist das noch nicht ausprobiert.** Der erste echte Import ist der Test.

## Monatsauszüge

Jedes Konto mit einer Buchung im Monat bekommt einen Auszug als PDF. Das gilt für Bankkonten, Börsenkonten und Wallets.

Der Auszug enthält:

- jede Buchung des Monats auf diesem Konto;
- zu jeder Buchung ihre Belegnummer oder das, was dafür steht, etwa _Umbuchung_, _Gebühr_ oder _Ertrag_;
- die Summen der Eingänge, der Ausgänge und des Monats.

Bei einem Bankkonto zeigt der Auszug, was in Belege gespeichert ist. Den Kontoauszug deiner Bank ersetzt er nicht.

Code: `app/src/lib/export/statement.js`, gezeichnet von `statement-pdf.js`.

### Kurse bei Krypto-Konten

Ein Krypto-Konto zeigt zusätzlich die Menge und den Kurs jeder Buchung. Hinter dem Kurs steht ein Kürzel für seine Quelle:

- **K** = Kraken
- **CG** = CoinGecko
- **EZB** = Referenzkurs der EZB
- **CBR** = Referenzkurs der Bank of Russia
- **NBK** = Referenzkurs der Nationalbank Kasachstans
- **CBR-X** = Kreuzkurs über den Rubel, aus den Kursen der Bank of Russia
- **H** = Preis des Handels
- **DEX** = Preis eines DEX-Pools (Uniswap) im Block der Buchung
- **MIG** = Wert der alten Token, die für eine Migration verbrannt wurden
- **M** = von Hand eingetragen

### Anfangs- und Endbestand

Der Bestand in der Kryptowährung (dem „Asset“) kommt, wo es geht, direkt aus der Quelle. Der Auszug sagt dann, woher:

- **_(laut Kraken)_:** aus dem Kraken-Ledger. Dort trägt jeder Eintrag den Bestand danach.
- **_(laut Explorer)_:** für die eigene Coin einer EVM-Wallet, die über Blockscout gelesen wird. Ein **Explorer** ist eine Website, die zeigt, was auf einer Chain passiert ist. Hier zählt sein eigener Bestandsverlauf. Er enthält auch Gebühren, die in den Transaktionslisten fehlen.
- **_(laut Wallet)_:** für eine andere Wallet, deren ganze Historie gelesen wurde. Dann ist es ihre aufsummierte Historie. Das gilt nur, wenn diese Summe genau den Bestand ergibt, den die Chain heute meldet. Beim CLI-Export von Monero ist es der laufende Kontostand der Wallet.

Stammen beide Bestände eines Monats aus der Quelle, wird der Monat abgestimmt. Anfangsbestand plus Buchungen des Monats müssen den Endbestand ergeben. Eine Lücke wird in ihrem Monat benannt.

Alle anderen Bestände rechnet Belege zurück: vom letzten Bestand, den die Börse oder Wallet gemeldet hat. Sie heißen _(errechnet)_. So ein Bestand stimmt nur, wenn jede Bewegung seitdem gebucht ist (#287).

Die Kraken-Bestände hält Belege ab der nächsten Synchronisierung fest. Für frühere Monate synchronisierst du neu, ab dem Monatsersten.

### Abgestimmt oder nicht abgestimmt

Der Endbestand wird abgestimmt, wo sich etwas Unabhängiges vergleichen lässt:

- **Bei Kraken:** Anfangsbestand plus Buchungen des Monats müssen Krakens Endbestand ergeben.
- **Bei einer Wallet, deren ganze Historie jede Synchronisierung liest:** Alle Buchungen von null an müssen den Endbestand ergeben, der aus heute zurückgerechnet ist.

Stimmt es, steht beim Bestand _abgestimmt_.

Stimmt es nicht, druckt der Auszug _Nicht abgestimmt_. Daneben stehen, was die Buchungen ergeben, und die Differenz. Die Export-Seite nennt das Konto. Dann fehlt eine Bewegung, etwa eine Gebühr, die die Quelle nicht meldet. Oder eine Buchung wurde gelöscht.

Ungeprüft und _errechnet_ bleiben:

- ein Bankkonto, denn seine Historie beginnt nicht bei null;
- die Teilhistorie eines gekürzten Nodes. Ein Node ist ein Server der Chain. Ein gekürzter Node kennt nur die jüngere Geschichte.

## Eigenbeleg

Manche Zahlungen haben keinen Beleg der Gegenseite. Ein Beispiel sind Gebühren auf einer Blockchain, denn sie stellt keine Rechnungen aus. Für so eine Zahlung bietet die Detailansicht der Zahlung **Eigenbeleg erstellen** an.

1. Du schreibst, was bezahlt wurde und warum es keinen Beleg gibt. Bei einer Krypto-Zahlung ist der Grund schon vorbelegt.
2. Belege macht daraus ein PDF.

Das PDF enthält:

- eine Nummer aus einem eigenen Nummernkreis (`EB-JJJJ-NNN`), Datum, Betrag und Konto;
- den Empfänger oder die zahlende Seite;
- bei Krypto: Menge, Kurs mit Quelle und die Transaktionsreferenz;
- bei einer Buchung einer eigenen Wallet außerdem die ganze Transaktion: den vollständigen Hash (die Kennung der Transaktion), Absender und Empfänger mit ihren vollständigen Adressen und jede Bewegung der Transaktion, die die Bücher kennen, samt Gebühr (#126);
- was bezahlt wurde und warum es keinen Beleg der Gegenseite gibt;
- wer ihn wann erstellt hat, mit einer Zeile für die Unterschrift.

Das PDF wird gespeichert wie ein hochgeladener Beleg. Es wird der Zahlung als deine Entscheidung zugeordnet. Der Export nummeriert es wie jeden anderen Beleg und legt es in `Belege/`.

Hast du Belege unter _Integrationen_ mit deiner Rechnungs-App gekoppelt, gibt es noch einen Weg: _Über die Rechnungs-App erstellen_. Dann erstellt die Rechnungs-App den Eigenbeleg, mit ihrem Nummernkreis und deinem Firmenkopf. Belege ordnet ihn der Zahlung zu.

Code: `app/src/lib/receipts/eigenbeleg.js`.

**Ein Eigenbeleg ist keine Rechnung.** Er berechtigt nicht zum Vorsteuerabzug.

## Kryptobewegungen in einem offenen Format

Unter dem DATEV-Export steht _Kryptobewegungen_. Dort lädst du alle Buchungen deiner Wallets und Börsenkonten herunter. Du wählst alle Jahre oder eines und dann **JSON** oder **CSV**. Das Format heißt [crypto-ledger](../schema/README.md) und ist offen. Schema und Beispiele stehen unter MIT-Lizenz. So können andere Programme dieselben Dateien lesen und schreiben.

Was in der Datei steht:

- **Ein Konto je Wallet oder Börsenkonto.** Eine Wallet wird nach dem Standard CAIP-10 benannt, ihre Chain nach CAIP-2. Ein Börsenkonto heißt etwa `kraken` oder `kraken/earn`. Belege führt intern ein Konto je Asset. Die Datei fasst sie unter ihrer Adresse zusammen.
- **Eine Bewegung je Buchung.** Die Menge steht als Dezimaltext mit Vorzeichen. Die Gebühr ist eine eigene Bewegung. Der Euro-Wert steht mit Kurs, Quelle und Zeitpunkt so da, wie er gebucht ist. Wo noch kein Kurs bekannt ist, steht `null`.
- **Gelöschte Buchungen fehlen.**
- **Der Transaktions-Hash** steht an Wallet-Bewegungen und an Ein- und Auszahlungen einer Börse. So lassen sich beide Seiten einer Übertragung zuordnen. Die eigene Referenz der Börse steht als `ref`.

Die Datei entsteht im Browser und wird heruntergeladen. Nichts wird verschickt.

### Eine Datei einlesen

_crypto-ledger-Datei einlesen_ nimmt eine solche Datei im JSON-Format, höchstens 50 MB. Sie kann aus einem anderen Programm kommen oder von Belege auf einem anderen Gerät.

- Belege bucht die Bewegungen auf die Konten, die auch eine Synchronisierung derselben Wallet oder desselben Kraken-Kontos nutzt. So erkennen Import und Synchronisierung die Buchungen des anderen an ihren IDs.
- Die Werte kommen so aus der Datei, wie sie sind, mit Kurs und Quelle.
- Eine Bewegung ohne Kurs wird mit offenem Euro-Betrag übernommen. An ihr steht dann „Kurs fehlt“.
- **Der Import ergänzt nur.** Hat das Konto die ID einer Bewegung schon, wird sie übersprungen und nie überschrieben. Das gilt, egal ob die Bewegung synchronisiert, früher eingelesen oder von Hand gelöscht wurde. Liest du dieselbe Datei zweimal ein, kommt nichts hinzu.
- Eine Chain oder Börse, die Belege noch nicht liest, wird genannt und ausgelassen.
- Die Datei muss in Euro bewertet sein.

Code: `app/src/lib/export/crypto-ledger.js`, `crypto-ledger-import.js`.

## Mit der Steuerberatung klären

- **Eigenbelege:** Werden sie für Zahlungen ohne Beleg anerkannt, etwa Blockchain-Gebühren oder Lease-Zahlungen? Und bis zu welchem Betrag?
- **Die Konten:** Der Katalog ist nur ein Ausgangspunkt. Ein Beispiel: 4964 heißt „Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)“. Passt das für Software-Abos?
- **Die BU-Schlüssel, vor allem §13b:** 94 ist der übliche Schlüssel für eine Leistung aus dem Ausland zu 19 %. Es gibt andere, etwa für Waren aus der EU.
- **Die Automatikkonten:** Welche hat dein Kontenrahmen? Belege behandelt 8400 und 8300 als solche und gibt ihnen keinen Schlüssel.
- **Die Kopfwerte:** Beraternummer, Mandantennummer, Sachkontenlänge und Wirtschaftsjahr, so wie deine Buchhaltung sie führt.
- **Das Belegdatum:** Ist der Buchungstag als _Belegdatum_ für dich richtig, oder das Datum des Belegs?

## Dein eigener Kontenplan

Unter _Einstellungen → Kontenplan_ liest die App den Kontenplan deines Buchhaltungsprogramms ein. Danach schlägt „Konto“ deine Konten mit deinen Bezeichnungen vor, statt der eingebauten SKR-03-Liste. Eine Nummer, die es in deinem Plan nicht gibt, wird markiert.

So kommst du an die Datei:

- **Ein Programm mit DATEV-Schnittstelle:** Exportiere dort die _Kontenbeschriftungen_. Das ist eine Datei, die mit `EXTF` beginnt (Datenkategorie 20). Auf Wunsch geht auch nur ein Kontenbereich. Diese CSV-Datei liest du ein. Die Menüs heißen je nach Programm anders.
- **Sonst:** jede CSV- oder Textdatei mit einer Spalte Kontonummern (4–8 Ziffern) und einer Spalte Bezeichnungen. Getrennt sind sie durch Semikolon, Komma oder Tab. UTF-8 und Windows-1252 werden beide gelesen.

Der Kontenplan bleibt verschlüsselt in deinen Büchern im Browser, wie jeder Datensatz. _Entfernen_ führt zurück zur SKR-03-Liste.

Code: `app/src/lib/booking/chart.js`.
