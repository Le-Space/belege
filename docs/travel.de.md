# Reisekosten

_English: [travel.md](travel.md)_

Reise- und Bewirtungsbelege passen nicht zur Regel „eine Zahlung, ein Beleg“:

- Eine Reise hat viele Belege. Oft hast du sie privat bezahlt.
- Verpflegungspauschalen und Kilometer haben gar keinen Beleg.
- Eine Bewirtung braucht erst bestimmte Angaben, bevor sie zählt.
- Was die Firma dir erstattet, kommt als eine Überweisung für einen ganzen Monat.

Dafür gibt es **Reisen**. Die Seite sammelt die Reisen eines Monats und rechnet aus, was sie ergeben. Sie erstellt die Reisekostenabrechnung und bucht sie ([#213](https://github.com/Le-Space/belege/issues/213)).

## Wer reist

Wer reist, trägst du unter **Einstellungen → Reisende** ein ([#380](https://github.com/Le-Space/belege/issues/380)):

- **Der Inhaber** oder der Gesellschafter-Geschäftsführer. Belege legt ihn mit der ersten Reise an, oder wenn du die erste angestellte Person einträgst.
- **Angestellte.** Jede angestellte Person hat ihr eigenes **Gegenkonto**. Das ist das Konto, auf das ihre Abrechnungen gebucht werden, zum Beispiel ein Personenkonto. Welches es ist, legst du mit der Steuerberatung fest. Ohne Gegenkonto kannst du für diese Person keine Abrechnung erstellen.
- **Die letzten vier Ziffern der IBAN** jeder Person. Daran erkennt Belege die Überweisung, mit der du ihr die Kosten erstattest.

Reisen mehrere Personen, zeigt Belege an drei Stellen, wessen Reise es ist: auf der Seite Reisen, auf der Reise selbst und am Beleg unter „Zu einer Reise …“.

Die Pauschalen sind die gesetzlichen. Für das Ausland gelten die Sätze aus dem jährlichen Schreiben des Bundesfinanzministeriums (kurz: BMF-Schreiben).

## Reisen

Du öffnest **Reisen** über den Tab **Reisen** (mit Koffer) zwischen Belege und Export. Der Tab erscheint, sobald es eine Reise, eine reisende Person oder einen Reisevorschlag gibt. Wer nie reist, sieht ihn nicht. Seine Zahl sagt, wie viele Vorschläge und Rückfragen dort warten ([#693](https://github.com/Le-Space/belege/issues/693)). Auch von Belege und Home aus führt ein Link hin. Die Seite zeigt einen Monat:

- seine Reisen, jede mit dem, was sie ergibt;
- die Bewirtungen;
- Reisen, die Belege aus deinen Belegen vorschlägt;
- Termine aus Einladungen;
- die offenen Punkte;
- die Abrechnung des Monats.

### Die Seite einer Reise

**Kopf.** Hier stehen Ziel, geschäftlicher Anlass, Abfahrt und Rückkehr mit Datum und Uhrzeit. Sind Ziel, Abfahrt oder Rückkehr leer und wissen die Belege der Reise mehr, zeigt Belege **„Aus den Fahrkarten: …“** mit **„Übernehmen“** ([#693](https://github.com/Le-Space/belege/issues/693)). Das passiert etwa bei einer Reise, die angelegt wurde, bevor ihre Belege ausgelesen waren. Abfahrt ist die erste gedruckte Abfahrt, Rückkehr die letzte Ankunft. Kommt später eine Fahrkarte dazu, die früher abfährt oder später ankommt, etwa der Zug zum Flughafen, bietet Belege auch das an: „Abfahrt … statt …“. Ohne Hotel ist das Ziel der Ort, an dem du am längsten bleibst, nicht die Umsteigestadt. Eine Rückkehr schlägt Belege nur vor, wenn eine Fahrkarte zurück zum Ausgangsort führt. Das Kaufdatum eines Tickets ist nie die Abfahrt. Dazu kommt die Tätigkeitsstätte, also der Ort, an dem du arbeitest, zum Beispiel ein Kunde oder eine Baustelle. Sie zählt für die Dreimonatsregel (siehe unten). Und du hältst fest, ob du übernachtet hast.

**Ausland.** Du trägst jeden Grenzübertritt mit Uhrzeit und Ländercode ein. Daneben steht der Name des Landes, damit dir ein Tippfehler auffällt.

Die meisten Grenzübertritte schlägt Belege aus den Fahrkarten vor ([#693](https://github.com/Le-Space/belege/issues/693)):

- Kommt eine Fahrt mit Zug, Bus, Flugzeug, Nahverkehr oder Taxi in einem anderen Land an, ist das ein Grenzübertritt zur Ankunftszeit. Beim Flug zählt das Land ab der Landung. Bei Zug und Bus liegt die Grenze vor der Ankunft; die Ankunft ist der späteste Zeitpunkt, und du kannst ihn ändern.
- Ein Inlandsflug ist kein Grenzübertritt. Die Rückfahrt einer Rückfahrkarte schon.
- **„Übernehmen“** trägt die vorgeschlagenen Grenzübertritte an der Reise ein. Eine Reise aus einem Vorschlag hat sie schon.
- Über die Grenze mit dem Auto, dem Fahrrad oder zu Fuß gibt es keine Fahrkarte. Ist ein Beleg aus einem Land, in dem du laut den Grenzübertritten an diesem Tag nicht warst, etwa Tanken, Parken, Hotel oder Restaurant, sagt Belege das. Die Uhrzeit trägst du selbst ein; Belege rät sie nicht.
- Ohne einen Beleg aus dem Ausland erkennt Belege einen Grenzübertritt nicht.
- Belege, die vor dieser Änderung ausgelesen wurden, kennen ihr Land nicht. „Erneut auslesen“ holt es nach.

**Teilen oder zusammenführen** ([#693](https://github.com/Le-Space/belege/issues/693)). Unten auf der Seite einer Reise:

- **In zwei Reisen teilen:** Du gibst an, wann die erste Reise endet und wann die zweite beginnt. Kommt eine Fahrkarte nach Hause und fährt die nächste erst einen Tag oder später wieder ab, schlägt Belege genau diese Zeiten vor. Belege, Grenzübertritte, Mahlzeiten, Nächte und Kilometer gehen nach ihrer Zeit mit: vor dem Beginn der zweiten zur ersten, ab dann zur zweiten. Ein Beleg zählt mit seiner Abfahrt, ein Hotel mit dem Check-in, sonst mit seinem Tag.
- **Zusammenführen:** Angeboten werden Reisen derselben Person, höchstens eine Woche entfernt. Daraus wird eine Reise vom früheren Beginn bis zum späteren Ende, mit allem von beiden. Die andere Reise wird gelöscht.
- Geteilt und zusammengeführt wird die gespeicherte Reise. Was du gerade tippst, speicherst du vorher.
- Eine Reise in einer erstellten Abrechnung wird weder geteilt noch zusammengeführt.

- Ein Tag im Ausland bekommt den Satz des Landes, das du vor Mitternacht zuletzt erreicht hast.
- Der Tag der Rückreise bekommt den Satz des letzten Orts im Ausland.
- Manche Länder haben Städte mit eigenen Sätzen, etwa Moskau, Paris oder New York City. Dann wählst du beim Grenzübertritt eine dieser Städte. Jeder andere Ort gilt als „übriges Land“.

Woher die Sätze kommen:

- Belege nutzt die Ländertabelle des BMF-Schreibens für das jeweilige Jahr, ab 2025. Die Sätze stehen genau so drin wie gedruckt, mit dem Schreiben als Quelle.
- Gestellte Mahlzeiten kürzen einen Tag. Gerechnet wird mit dem Satz für einen vollen Tag in diesem Land.
- Ein Tag vor 2025 hat in Belege kein Schreiben. Er bleibt ohne Betrag, und Belege weist darauf hin.
- Die Übernachtungspauschalen im Ausland gelten nur, wenn ein Arbeitgeber erstattet. Für den Inhaber gelten sie nicht. Mehr dazu unter „Nächte ohne Hotelrechnung“.

Länder, die das Schreiben nicht nennt:

- Mikronesien bekommt die Sätze der Philippinen. So steht es im Schreiben.
- Die Staaten im Amtsbezirk von Trinidad und Tobago bekommen dessen Sätze. Auch das steht im Schreiben.
- Ein Übersee- oder Außengebiet bekommt die Sätze seines Mutterlands, zum Beispiel Guadeloupe die von Frankreich und Macao die von China.
- Jedes andere Land bekommt die Sätze von Luxemburg.
- Die letzten beiden Fälle sind Hinweise für die Steuerberatung.
- Hongkong führt das Schreiben als Stadt Chinas, mit eigenen Sätzen. Belege nimmt diese Sätze, ohne Hinweis.

**Nächte ohne Hotelrechnung.** Das gilt nur für Angestellte (#380).

- Du kreuzt jede Nacht einzeln an. Belege kreuzt nie von selbst an und nie für den Inhaber.
- Jede Nacht bekommt eine Pauschale: im Inland 20 € (R 9.7 Abs. 3 LStR). Im Ausland gilt der Übernachtungssatz des BMF-Schreibens für den Ort, an dem du um Mitternacht bist. Nennt der Grenzübertritt eine Stadt, gilt deren Satz.
- Gebucht wird mit der Monatsabrechnung, auf das Übernachtungskonto (4666), ohne Vorsteuer.
- Hängt an derselben Reise auch eine Hotelrechnung, zeigt Belege einen Hinweis. So wird keine Nacht doppelt erstattet.

**Gestellte Mahlzeiten.** Du trägst sie pro Tag ein. Steht ein Frühstück in der Hotelrechnung, schlägt Belege es vor. Mit „Übernehmen“ trägst du es ein.

**Kilometer.** Du trägst Datum, Start, Ziel, Anlass und Kilometer ein, und ob du hin und zurück gefahren bist. Die Strecke selbst ist der Beleg.

- Eigenes Auto: 0,30 € pro km. Motorrad oder Moped: 0,20 € pro km. Ein Fahrrad hat keine Pauschale.
- **Auto eines Familienangehörigen:** Es gibt die Pauschale. Sie ist aber markiert mit _Fremdes Fahrzeug – mit Steuerberatung klären_. Du gibst an, wem das Auto gehört und wer die laufenden Kosten trägt.
- Firmenwagen und Mietwagen bekommen keine Kilometer. Tanken und Miete sind dort normale Belege.

**Belege.** Die Reise listet ihre Belege und wer sie bezahlt hat. Dazu kommen die Pauschale pro Tag und **was die Reise ergibt**:

- **Zu erstatten:** Pauschalen + Kilometer + Übernachtungspauschalen + privat bezahlte Belege + privat bezahltes Trinkgeld.
- **Gesamtkosten der Reise:** dazu die als Auslage gebuchten Belege (sie werden über das Auslagenkonto erstattet) und die von der Firma bezahlten. Ein Beleg in fremder Währung ohne Kurs zählt nicht mit; Belege sagt das.
- **An dich insgesamt:** gibt es Auslagen, „Zu erstatten“ und die Auslagen zusammen – was du aus Abrechnung und Auslagenkonto zurückbekommst.
- Auf **Reisen** steht neben jeder Reise ihr Gesamtbetrag und darunter, was davon zu erstatten ist.

**Neu auslesen.** **„✦ Belege der Reise neu auslesen“** schickt alle Belege der Reise noch einmal an dein Sprachmodell, etwa nachdem das Auslesen etwas Neues gelernt hat. Es läuft wie „Alle neuen auslesen“ in der Warteschlange der App; was du am Beleg selbst geändert hast, bleibt. Ein Neuladen der Seite bricht den Lauf ab, und „Weitermachen“ bietet ihn nicht an: Dann klickst du noch einmal.

Fehlt einer Reise etwas, etwa Zeiten, ein Anlass oder Kilometer, sagt Belege das. Gespeichert wird die Reise trotzdem.

## Verpflegungspauschalen

Belege rechnet sie pro Kalendertag aus den Zeiten der Reise aus (§ 9 Abs. 4a EStG). Seit 2020 sind es 14 € und 28 €, davor 12 € und 24 €.

- **Ein Tag ohne Übernachtung:** Bei mehr als 8 Stunden gibt es den Teilsatz.
- **Über Mitternacht ohne Übernachtung:** Die Stunden beider Tage zählen zusammen. Sie gelten für den Tag mit den meisten Stunden.
- **Mit Übernachtungen:** Am Tag der Anreise und am Tag der Abreise gibt es den Teilsatz. Jeder Tag dazwischen bekommt den vollen Satz.
- **Gestellte Mahlzeit:** Ein Frühstück kürzt den Tag um 20 % des vollen Tagessatzes. Ein Mittag- oder Abendessen kürzt um 40 %. Weiter als auf null geht es nicht.
- **Dreimonatsregel:** An derselben Tätigkeitsstätte endet die Pauschale drei Monate nach dem ersten Tag dort. Bist du vier Wochen nicht dort, beginnt die Zählung neu. Ob du die Stätte an drei oder mehr Tagen pro Woche aufsuchst, prüft Belege nicht. Die gekürzten Tage nennen deshalb ihren Grund, für die Steuerberatung.

## Belege auf einer Reise

Am Beleg ordnest du ihn mit **„Zu einer Reise …“** einer Reise zu. Reisen um sein Datum stehen dabei oben. Du gibst an, wer bezahlt hat. Belege schlägt „die Firma“ vor, wenn eine Bankzahlung den Beleg deckt, sonst „privat“. Du kannst aus dem Beleg auch eine neue Reise anlegen. Ziel und Zeiten übernimmt Belege dann so, wie es sie gelesen hat.

**Andere Währung.** Ein Beleg zählt immer in Euro. Belege nimmt nie seinen Betrag einfach als Euro. Den Euro-Betrag nimmt es aus einer dieser Quellen:

- aus der Auslage, als die du ihn gebucht hast ([outlays.de.md](outlays.de.md));
- aus der verknüpften Zahlung;
- aus einem Kurs, den du am Beleg festhältst.

Den Kurs holt die Bridge, das Hilfsprogramm auf deinem Rechner. Quellen sind die Europäische Zentralbank (EZB), für den Rubel die Bank of Russia, für den Tenge die Nationalbank Kasachstans. Für einige weitere Währungen ist es ein Kreuzkurs über den Rubel, aus den Kursen der Bank of Russia. Du kannst den Kurs auch selbst eintragen, so wie man ihn sagt: „1 EUR = 95,23 RUB“. Ohne Kurs zählt der Beleg nichts, und die Abrechnung wartet darauf. Ausländische Umsatzsteuer ist keine deutsche Vorsteuer.

**Kurse für die ganze Reise** ([#693](https://github.com/Le-Space/belege/issues/693)). Haben Belege einer Reise noch keinen Euro-Betrag, zeigt die Reise **„Kurse holen“**. Die Bridge holt für jeden den Kurs seines Tages. Belege zeigt jeden mit Euro-Betrag, Kurs und Quelle. Gespeichert wird erst mit **„Übernehmen“**. Hat die Bridge für einen Tag keinen Kurs, steht das dort, und du trägst ihn am Beleg von Hand ein.

**Bewirtung.** An einer Restaurantrechnung wählst du **„Als Bewirtung erfassen …“**, mit oder ohne Reise. Du trägst Ort, Teilnehmer und Anlass ein, dazu ein Trinkgeld und wer es bekam.

- Netto und Trinkgeld werden aufgeteilt: 70 % sind abziehbar, der Rest nicht.
- Das Trinkgeld hat keinen eigenen Beleg. Belege nimmt an, dass du es selbst bezahlt hast, und erstattet es mit der Abrechnung. Nur wenn eine Zahlung vom Geschäftskonto am Beleg Rechnung und Trinkgeld zusammen deckt, war es auf der Firmenkarte und wird nicht erstattet.
- Die Umsatzsteuer zählt voll.
- Fehlt etwas, was das Gesetz verlangt, sagt Belege das.

## Reisen erkennen

Belege ordnet nichts von selbst zu und legt nichts von selbst an. Alles hier ist ein Vorschlag. Ein Klick von dir entscheidet.

**Das Auslesen mit KI.** Es läuft ohnehin für jeden Beleg. Bei einer Reiseausgabe liefert es zusätzlich:

- die Art, etwa Bahn, Bus, Flug, Hotel, Restaurant, Tanken, Taxi, Parken oder Event;
- Strecke und Zeiten für Hin- und Rückweg;
- das Land jedes Orts und bei Flügen die Flughafencodes. Daran erkennt Belege denselben Ort in anderer Schreibweise oder Schrift;
- die Nächte einer Hotelrechnung, und ob das Frühstück inklusive ist.

Siehe [ai.de.md](ai.de.md).

**Ohne KI.** Tickets und Rechnungen drucken typische Wörter. Belege kennt solche Wörter auf Deutsch, Englisch, Russisch, Ukrainisch, Polnisch, Tschechisch, Türkisch, Arabisch, Spanisch, Italienisch und Französisch. Es sucht sie in Dateiname, Betreff und Absender und im Text eines PDFs, das nicht ausgelesen wurde. Das geschieht im Browser. Daraus bekommt der Beleg seine Art, aber nur als Hinweis: keine Strecke, keine Zeiten, keine Rückfrage.

**Reisevorschläge.** Belege bildet sie nach festen Regeln:

- Fahrten und Hotels, die nach Tagen und Strecke zusammenpassen, werden ein Vorschlag, etwa „Reise nach Musterstadt, 08.04. 07:12 – 09.04. 20:41“.
- Dazu kommen die Belege dieser Tage für Taxi, Tanken, Parken, Mietwagen, Nahverkehr, Restaurant und Events.
- Montag hin und Mittwoch zurück ist eine Reise. Zwei Tagesreisen in einer Woche sind zwei Reisen.
- Ein **Konferenz- oder Veranstaltungsticket allein** ist ein eigener Vorschlag, etwa „Veranstaltung in Musterstadt, 15.04. 09:00“.
- Eine Restaurantrechnung allein löst keine Frage aus.

Jeden Vorschlag beantwortest du selbst, auf eine von drei Arten ([#425](https://github.com/Le-Space/belege/issues/425)):

- **„Als Reise anlegen“** legt die Reise an. Oder es fügt die Belege einer Reise hinzu, die es schon gibt.
- **„Geschäftlich, keine Reise“** behält die Belege als Betriebsausgaben. Der Vorschlag kommt nicht wieder.
- **„Privat“** sortiert jeden Beleg als privat aus, wie „Privat, nicht geschäftlich“ (#293). Hat eine Zahlung vom Geschäftskonto einen dieser Belege bezahlt, wird sie als privat markiert („Privat (Irrläufer)“, #172). Beides kannst du zurücknehmen.

**Termine aus Einladungen.** Eine Einladung enthält oft einen Kalenderteil (eine `.ics`-Datei). Kommt so eine Mail an die Buchhaltungsadresse, wird daraus ein Termin.

- Belege übernimmt nur Titel, Ort und Zeiten. Teilnehmer, Veranstalter und Links übernimmt es nie.
- Fällt ein Termin auf die Tage eines Vorschlags, gibt er ihm den Anlass.
- Liegt ein Termin an einem anderen Ort, bietet Reisen **„Reise dazu anlegen“** an.
- Online-Termine und Termine ohne Ort weisen nie auf eine Reise hin.
- Damit Belege eine Einladung sieht, schickst du sie an die Buchhaltungsadresse oder leitest sie dorthin weiter.

## Die Abrechnung

Es gibt eine Abrechnung pro Person und Monat. Du findest sie auf Reisen.

**Vorher** zeigt Belege die Summen:

- Pauschalen;
- Kilometer;
- privat bezahlte Belege;
- Trinkgeld, das du privat bezahlt hast;
- Belege, die als Auslage gebucht sind. Sie werden über das Auslagenkonto erstattet, nicht mit dieser Abrechnung. Soll ein Beleg mit der Reise erstattet werden, machst du am Beleg die Auslage rückgängig;
- Belege, die die Firma bezahlt hat (sie stehen drin, werden aber nicht erstattet).

Dazu kommen **Prüfungen**. Diese Punkte sperren die Abrechnung:

- eine Reise ohne Zeiten, ohne Ziel oder ohne Anlass;
- eine Reise ohne Übernachtung, die über mehr als eine Mitternacht geht: Dann stimmen die Zeiten oder die Angabe zur Übernachtung nicht;
- eine Bewirtung mit Lücken;
- ein privater Beleg ohne Betrag oder ohne Kurs.

Diese Punkte sind nur Hinweise. Sie werden mit aufs PDF gedruckt:

- ein Tag im Ausland ohne Satz oder mit dem Satz eines anderen Landes;
- das Auto eines Familienangehörigen;
- ein Beleg in anderer Währung.

**„Abrechnung erstellen“** gibt der Abrechnung eine Nummer, etwa `RK-2026-001`. Belege zeichnet daraus ein deutsches A4-PDF im Stil der Eigenbelege. Darauf stehen:

- die Reisen mit Zeiten, die Pauschale pro Tag, die Kilometer;
- die Belege und die Bewirtungen;
- die Summen und die Vorsteuer nach Steuersatz;
- die angewandten Sätze mit ihrer Rechtsquelle;
- die Hinweise;
- eine Linie für die Unterschrift.

Das PDF legt Belege als Beleg für die Auszahlung ab.

Eine erstellte Abrechnung behält alles, was sie gedruckt hat, auch die Sätze. Sie wird **nicht mehr geändert**. Eine Korrektur ist eine neue Abrechnung mit neuer Nummer. Sie verweist auf die alte. Die alte bleibt erhalten und ist als ersetzt markiert.

## Buchhaltung

Belege bucht die Abrechnung auf das Konto der reisenden Person: **„Reisekosten <Name>“**. Es ist ein Konto ohne Import.

Sein Sachkonto ist das Gegenkonto der Person:

- Bei Angestellten ist es ihr eigenes.
- Beim Inhaber gilt, wenn keins eingetragen ist, das Konto aus der Rechtsform unter Buchhaltung. Bei einer UG oder GmbH ist das das Gesellschafter-Verrechnungskonto. Bei Einzelunternehmen und Personengesellschaften ist es 1890.

Die Abrechnung einer angestellten Person nutzt immer die Arbeitnehmer-Konten (466x), egal welche Rechtsform. Bewirtungen ohne Reise stehen nur in der Abrechnung des Inhabers.

Jede Zeile ist ein Abgang am letzten Tag des Monats, in Euro. Die Konten (SKR 03):

| Was                                                 | UG/GmbH (Gesellschafter-Geschäftsführer ist angestellt) | Einzelunternehmen, Personengesellschaft |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| Fahrt, Tanken, Parken, Taxi                         | 4663                                                    | 4673                                    |
| Übernachtung (auch Pauschalen von Angestellten)     | 4666                                                    | 4676                                    |
| Verpflegungspauschalen (Monatssumme, ohne USt)      | 4664                                                    | 4674                                    |
| Kilometer (Monatssumme, ohne USt)                   | 4668                                                    | 4673                                    |
| Sonstiges auf einer Reise                           | 4660                                                    | 4670                                    |
| Bewirtung: 70 % / 30 % des Bruttos, jeweils mit USt | 4650 / 4654                                             | 4650 / 4654                             |

So wird gebucht:

- **Privat bezahlter Beleg:** mit seinem Brutto und dem BU-Schlüssel seiner deutschen Umsatzsteuer. Der BU-Schlüssel ist der Steuerschlüssel, an dem DATEV den Steuersatz erkennt. Die Buchung ist mit dem Beleg verknüpft. Pauschalen und Kilometer sind mit der Abrechnung verknüpft.
- **Bewirtung:** Sie wird je Steuersatz geteilt. 70 % des Bruttos gehen auf 4650, 30 % auf 4654, **beide mit dem Vorsteuer-Schlüssel**. DATEV rechnet die Steuer aus jeder Zeile heraus. So wird die ganze Vorsteuer abgezogen (§ 15 UStG). Begrenzt ist nur der Aufwand (§ 4 Abs. 5 Nr. 2 EStG). Eine Rechnung mit 7 % für Speisen und 19 % für Getränke ergibt deshalb vier Zeilen.
- **Trinkgeld, privat bezahlt:** 70 % auf 4650, 30 % auf 4654, ohne Steuerschlüssel, mit der Rechnung verknüpft.
- **Auslagen und Firmenzahlungen:** Belege, die als Auslage gebucht sind oder die die Firma bezahlt hat, werden nicht noch einmal gebucht. Ein Beleg auf einer Reise, den das Geschäftskonto bezahlt hat, bekommt sein Reisekostenkonto aber ebenfalls vorgeschlagen.
- **Vorschläge bestätigen:** Jede Zeile bekommt ihr Konto vorgeschlagen. Im Export bestätigst du sie mit **„Konten … übernehmen“**, zusammen mit den anderen automatischen Vorschlägen.
- **Korrektur:** Sie storniert die Zeilen der ersetzten Abrechnung und bucht dann ihre eigenen.
- **Export:** Die Zeilen gehen in den DATEV-Buchungsstapel des Monats. Die Abrechnung und ihre Belege gehen ins ZIP ([export.de.md](export.de.md)).

## Die Auszahlung

Die Überweisung an die reisende Person wird mit dem PDF der Abrechnung verknüpft. Das funktioniert wie bei jeder Zahlung mit ihrem Beleg.

An der Überweisung bietet **„Zahlt Reisekosten aus …“** die offenen Abrechnungen an. Angehakt ist:

- die Abrechnung, deren Nummer (`RK-…`) im Verwendungszweck steht;
- sonst die Abrechnungen, deren Beträge genau aufgehen;
- sonst die ältesten, bis der Betrag verbraucht ist.

Endet das Empfängerkonto auf die IBAN-Ziffern einer Person, bietet Belege nur deren Abrechnungen an.

- Mehrere Überweisungen können eine Abrechnung in Teilen zahlen.
- Eine Überweisung kann mehrere Abrechnungen zahlen, die ältesten zuerst.
- Ist es zu viel, sagt Belege das.
- Eine Korrektur übernimmt, was auf die ersetzte Abrechnung schon gezahlt wurde.
- Gebucht wird die Auszahlung gegen das Gegenkonto der Person. Bei Angestellten ist das ihr eigenes. Beim Inhaber ist es das eingetragene. Ist keins eingetragen, richtet es sich nach dem Weg des Geldes, wie bei einer privaten Rückzahlung.
- Reisen zeigt, ob die Abrechnung ausgezahlt ist, nur teilweise oder zu viel.

## Vorschüsse

Ein Vorschuss ist Geld, das eine Person vor einer Reise bekommt ([#381](https://github.com/Le-Space/belege/issues/381)). An der Zahlung markierst du es mit **„Vorschuss für Reisekosten …“**. Du wählst die Person. Passen die IBAN-Ziffern, schlägt Belege sie vor. Wenn du sie kennst, wählst du auch die Reise.

- Ein Vorschuss braucht keinen eigenen Beleg. Die Abrechnung belegt ihn.
- Gebucht wird er gegen das Gegenkonto der Person, wie die Auszahlung.

**Verrechnung mit den Abrechnungen:**

- Ein Vorschuss für eine Reise geht ganz auf die Abrechnung, die diese Reise enthält.
- Ein Vorschuss ohne Reise geht auf die Abrechnungen der Person, die älteste zuerst, so weit deren Kosten reichen.
- Was noch keine Abrechnung aufnimmt, steht an der Zahlung als „noch nicht abgerechnet“.

**In der Abrechnung:**

- Sie zeigt „Bereits als Vorschuss gezahlt“ und was noch auszuzahlen ist.
- Das PDF listet die Vorschüsse.
- Ist der Vorschuss höher als die Kosten, bleibt eine Forderung an die Person. Die Abrechnung sagt das.
- Eine Korrektur übernimmt die Vorschüsse der Abrechnung, die sie ersetzt.

„Kein Vorschuss“ nimmt die Markierung zurück. Die Zahlung wartet dann wieder auf einen Beleg.

## Offene Punkte

Sie stehen auf Reisen. Auf Home und unter Rückfragen werden sie mitgezählt.

- Ein Beleg ohne Reise, der als Fahrkarte für Bahn, Bus oder Flug, als Hotel, als Mietwagen oder als anderes Ticket gelesen wurde. Ausgenommen sind Belege, die ein Vorschlag schon abdeckt oder die du abgelehnt hast.
- Eine Reise ohne Zeiten oder mit Lücken. Jede Reise ist ein Punkt, der nennt, was fehlt, etwa „Reise ohne Rückkehr, geschäftlichen Anlass“.
- Eine Bewirtung ohne die Angaben, die das Gesetz verlangt.
- Eine Abrechnung, die zwei Wochen nach dem Erstellen noch nicht ausgezahlt ist.

## Noch nicht

- Erstattungen über den gesetzlichen Pauschalen. Belege erstattet genau diese Pauschalen und Belege in ihrer Höhe. Es nennt deshalb nichts als lohnsteuerpflichtig. Das bestätigt die Steuerberatung.

Sätze, Konten und die Behandlung des Autos von Familienangehörigen stimmst du mit der Steuerberatung ab. Diese Seite beschreibt, was Belege tut. Sie ist keine Steuerberatung.
