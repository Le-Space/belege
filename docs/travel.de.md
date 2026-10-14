# Reisekosten

_English: [travel.md](travel.md)_

Reise- und Bewirtungsbelege passen nicht zu „eine Zahlung, ein Beleg“. Eine Reise hat viele Belege, oft privat bezahlt; Verpflegungspauschalen und Kilometer haben gar keinen Beleg; eine Bewirtung braucht Angaben, bevor sie zählt; und was die Firma erstattet, ist eine Überweisung für einen ganzen Monat. **Reisen** sammelt die Reisen eines Monats, rechnet aus, was sie ergeben, erstellt die Reisekostenabrechnung und bucht sie ([#213](https://github.com/Le-Space/belege/issues/213)).

Wer reist, steht unter **Einstellungen → Reisende** ([#380](https://github.com/Le-Space/belege/issues/380)):

- **Der Inhaber** bzw. Gesellschafter-Geschäftsführer: angelegt mit der ersten Reise oder mit der ersten angestellten Person.
- **Angestellte:** jede mit ihrem eigenen **Gegenkonto**, auf das ihre Abrechnungen gebucht werden. Es wird mit der Steuerberatung festgelegt, etwa ein Personenkonto. Ohne Gegenkonto lässt sich für sie keine Abrechnung erstellen.
- **Die letzten vier Ziffern der IBAN** jeder Person erkennen die Überweisung der Erstattung.

Bei mehr als einer Person sagen die Reisen-Seite, die Reise und am Beleg „Zu einer Reise …“, wessen Reise es ist. Die Pauschalen sind die gesetzlichen, im Ausland die des jährlichen BMF-Schreibens.

## Reisen

**Reisen** (aus Belege und von Home) zeigt einen Monat: seine Reisen mit dem, was sie ergeben, die Bewirtungen, die von den Belegen vorgeschlagenen Reisen, Termine aus Einladungen, die offenen Punkte und die Abrechnung des Monats.

Die Seite einer Reise enthält:

- **Kopf:** Ziel, geschäftlicher Anlass, Abfahrt und Rückkehr (Datum und Uhrzeit), die Tätigkeitsstätte (ein Kunde, eine Baustelle: für die Dreimonatsregel), ob übernachtet wurde.
- **Ausland:** jeder Grenzübertritt mit Uhrzeit und Ländercode; daneben steht der Name des Landes, damit ein Tippfehler auffällt. Ein Auslandstag bekommt den Satz des Landes, das vor Mitternacht zuletzt erreicht wurde; der Rückreisetag den des letzten Auslandsorts. Hat ein Land Städte mit eigenen Sätzen (Moskau, Paris, New York City …), wählt der Grenzübertritt eine davon; jeder andere Ort ist das übrige Land.
  - **Sätze:** die Ländertabelle des BMF-Schreibens für das Jahr (ab 2025), genau wie gedruckt, mit dem Schreiben als Quelle. Gestellte Mahlzeiten kürzen einen Tag um den Satz für einen vollen Tag in seinem Land.
  - **Länder, die das Schreiben nicht nennt:** Mikronesien bekommt die Sätze der Philippinen, die Staaten im Amtsbezirk von Trinidad und Tobago dessen Sätze (so steht es im Schreiben); ein Übersee- oder Außengebiet die des Mutterlands (Guadeloupe → Frankreich, Hongkong gehört zu China); jedes andere Land die von Luxemburg. Die letzten beiden sind Hinweise für die Steuerberatung.
  - Ein Tag vor 2025 hat in Belege kein Schreiben: Er bleibt ohne Betrag und wird genannt.
  - Die Übernachtungspauschalen im Ausland gelten nur für die Erstattung durch einen Arbeitgeber, nicht für den Inhaber: Sie stehen in der Tabelle, werden aber noch nicht verwendet.
- **Gestellte Mahlzeiten:** pro Tag. Ein Frühstück in der Hotelrechnung wird aus der Rechnung vorgeschlagen („Übernehmen“).
- **Kilometer:** Datum, von, nach, Anlass, km, hin und zurück. Die Strecke ist der Beleg.
  - Eigener PKW 0,30 €/km, Motorrad oder Moped 0,20 €/km; ein Fahrrad hat keine Pauschale.
  - **Auto eines Familienangehörigen:** die Pauschale, markiert mit _Fremdes Fahrzeug – mit Steuerberatung klären_, mit Halter und wer die laufenden Kosten trägt.
  - Firmenwagen und Mietwagen bekommen keine Kilometer (Tanken und Miete sind Belege).
- **Belege** der Reise mit wer bezahlt hat, die Pauschale pro Tag und **was die Reise ergibt**: Pauschalen + Kilometer + privat bezahlte Belege.

Was einer Reise fehlt (Zeiten, ein Anlass, km), wird genannt; gespeichert wird sie trotzdem.

## Verpflegungspauschalen

Nach den Zeiten der Reise, pro Kalendertag (§ 9 Abs. 4a EStG; 14 € und 28 € seit 2020, davor 12 € und 24 €):

- ein Tag ohne Übernachtung: mehr als 8 Stunden, der Teilsatz;
- über Mitternacht ohne Übernachtung: die Stunden beider Tage zählen zusammen, für den Tag mit den meisten davon;
- mit Übernachtungen: An- und Abreisetag der Teilsatz, jeder Tag dazwischen der volle;
- eine gestellte Mahlzeit kürzt den Tag um 20 % (Frühstück) oder 40 % (Mittag-, Abendessen) des vollen Tagessatzes, höchstens auf null;
- **Dreimonatsregel:** an derselben Tätigkeitsstätte endet die Pauschale drei Monate nach dem ersten Tag dort; vier Wochen Abwesenheit lassen die Zählung neu beginnen. Ob die Stätte an drei Tagen pro Woche oder öfter aufgesucht wird, prüft Belege nicht: die gekürzten Tage tragen ihren Grund, für die Steuerberatung.

## Belege auf einer Reise

Am Beleg ordnet **„Zu einer Reise …“** ihn einer Reise zu (Reisen um sein Datum zuerst), mit wer bezahlt hat – die Firma, wo eine Bankzahlung ihn deckt, sonst privat; oder legt aus ihm eine neue Reise an, mit Ziel und Zeiten wie gelesen.

- **Andere Währung:** ein Beleg zählt in Euro, nie sein Betrag als Euro: nach der Auslage, als die er gebucht ist ([outlays.de.md](outlays.de.md)), nach der verknüpften Zahlung oder nach einem Kurs am Beleg – von der Bridge geholt (EZB, für den Rubel die Bank of Russia) oder eingetragen, wie man ihn sagt: „1 EUR = 95,23 RUB“. Ohne Kurs zählt er nichts, und die Abrechnung wartet darauf. Ausländische Umsatzsteuer ist keine deutsche Vorsteuer.
- **Bewirtung:** **„Als Bewirtung erfassen …“** an einer Restaurantrechnung, mit oder ohne Reise: Ort, Teilnehmer, Anlass, Trinkgeld und wer es bekam. Netto und Trinkgeld werden zu 70 % abziehbar aufgeteilt, der Rest nicht; die Umsatzsteuer zählt voll. Was das Gesetz verlangt und fehlt, wird genannt.

## Reisen erkennen

Nichts wird von selbst zugeordnet oder angelegt; alles hier schlägt vor, ein Klick entscheidet.

- **Das Auslesen** (mit KI, im ohnehin laufenden Auslesen) liefert die Art einer Reiseausgabe (Bahn, Bus, Flug, Hotel, Restaurant, Tanken, Taxi, Parken, Event …), Strecke und Zeiten hin und zurück, die Nächte einer Hotelrechnung und ob das Frühstück inklusive ist. Siehe [ai.de.md](ai.de.md).
- **Ohne KI** geben Wörter, die Tickets und Rechnungen drucken, auf Deutsch, Englisch, Russisch, Ukrainisch, Polnisch, Tschechisch, Türkisch, Arabisch, Spanisch, Italienisch und Französisch, einem Beleg seine Art – aus Dateiname, Betreff, Absender und dem Text eines nicht ausgelesenen PDFs, gelesen im Browser. Nur ein Hinweis: keine Strecke, keine Zeiten, keine Rückfrage.
- **Reisevorschläge,** nach Regeln: Fahrten und Hotels, die nach Tagen und Strecke zusammenpassen, werden ein Vorschlag („Reise nach Musterstadt, 08.04. 07:12 – 09.04. 20:41“), mit den Taxi-, Tank-, Park-, Restaurant- und Eventbelegen dieser Tage. Montag hin und Mittwoch zurück ist eine Reise; zwei Tagesreisen in einer Woche sind zwei. Ein Klick legt die Reise an oder fügt die Belege einer bestehenden hinzu; **„Keine Reise“** lehnt einen Vorschlag dauerhaft ab.
- **Termine aus Einladungen:** ein Kalenderteil (`.ics`) einer Mail an die Buchhaltungsadresse wird ein Termin – nur Titel, Ort und Zeiten, nie Teilnehmer, Veranstalter oder Links. Er gibt einem Vorschlag an seinen Tagen den Anlass; auf Reisen wird einer an einem anderen Ort als **„Reise dazu anlegen“** angeboten. Online-Termine und solche ohne Ort weisen nie auf eine Reise hin. Einladungen erreichen Belege, indem sie an die Buchhaltungsadresse gehen oder dorthin weitergeleitet werden.

## Die Abrechnung

Eine Abrechnung pro Reisender und Monat, auf Reisen:

- **Vorher:** die Summen – Pauschalen, Kilometer, privat bezahlte Belege, als Auslage gebuchte (dort erstattet), von der Firma bezahlte (aufgeführt, nicht erstattet) – und **Prüfungen**: eine Reise ohne Zeiten, Ziel oder Anlass, eine Bewirtung mit Lücken, ein privater Beleg ohne Betrag oder ohne Kurs sperren sie; ein Auslandstag ohne Satz oder mit dem eines anderen Landes, das Auto eines Familienangehörigen oder eine andere Währung sind Hinweise, die mit aufs PDF kommen.
- **„Abrechnung erstellen“** nummeriert sie (`RK-2026-001`), zeichnet ein deutsches A4-PDF im Stil der Eigenbelege – Reisen mit Zeiten, Pauschale pro Tag, Kilometer, Belege, Bewirtungen, Summen, Vorsteuer nach Satz, die angewandten Sätze mit Rechtsquelle, die Hinweise, eine Unterschriftslinie – und legt es als Beleg für die Auszahlung ab.
- Eine erstellte Abrechnung behält alles, was sie gedruckt hat, auch die Sätze, und wird **nicht geändert**. Eine Korrektur ist eine neue Abrechnung mit neuer Nummer, die auf sie verweist; die alte bleibt, als ersetzt markiert.

## Buchhaltung

Die Abrechnung wird auf dem Konto des Reisenden gebucht, **„Reisekosten <Name>“**, einem Konto ohne Import. Sein Sachkonto ist das Gegenkonto der Person: bei Angestellten ihr eigenes, beim Inhaber, wenn keins eingetragen ist, das der Rechtsform (Buchhaltung): das Gesellschafter-Verrechnungskonto einer UG/GmbH, 1890 für Einzelunternehmen und Personengesellschaften. Die Abrechnung einer angestellten Person nutzt die Arbeitnehmer-Konten (466x), gleich welche Rechtsform. Bewirtungen ohne Reise stehen nur in der Abrechnung des Inhabers. Jede Zeile ein Abgang am Monatsletzten, in Euro:

|                                                | UG/GmbH (der Gesellschafter-Geschäftsführer ist angestellt) | Einzelunternehmen, Personengesellschaft |
| ---------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Fahrt, Tanken, Parken, Taxi                    | 4663                                                        | 4673                                    |
| Übernachtung                                   | 4666                                                        | 4676                                    |
| Verpflegungspauschalen (Monatssumme, ohne USt) | 4664                                                        | 4674                                    |
| Kilometer (Monatssumme, ohne USt)              | 4668                                                        | 4673                                    |
| Sonstiges auf einer Reise                      | 4660                                                        | 4670                                    |
| Bewirtung: 70 % netto plus USt / der Rest      | 4650 / 4654                                                 | 4650 / 4654                             |

- Ein privat bezahlter Beleg wird mit seinem Brutto und dem BU-Schlüssel seiner deutschen Umsatzsteuer gebucht und mit ihm verknüpft; Pauschalen und Kilometer mit der Abrechnung.
- Als Auslage gebuchte und von der Firma bezahlte Belege werden nicht noch einmal gebucht. Ein Beleg auf einer Reise, vom Geschäftskonto bezahlt, bekommt sein Reisekostenkonto ebenfalls vorgeschlagen.
- Jede Zeile bekommt ihr Konto vorgeschlagen; **„Konten … übernehmen“** im Export bestätigt sie mit den anderen automatischen Vorschlägen. Eine Korrektur storniert die Zeilen der ersetzten Abrechnung und bucht dann ihre eigenen.
- Die Zeilen gehen in den DATEV-Buchungsstapel des Monats, die Abrechnung und ihre Belege ins ZIP ([export.de.md](export.de.md)).

## Die Auszahlung

Die Überweisung an den Reisenden wird mit dem PDF der Abrechnung verknüpft, wie jede Zahlung mit ihrem Beleg. An der Überweisung bietet **„Zahlt Reisekosten aus …“** die offenen Abrechnungen an, angehakt die, deren Nummer (`RK-…`) der Verwendungszweck nennt, sonst die, deren Beträge aufgehen – nur die der Person, auf deren IBAN-Endziffern das Empfängerkonto endet, wo es das tut.

- Mehrere Überweisungen zahlen eine Abrechnung in Teilen; eine Überweisung kann mehrere zahlen, die ältesten zuerst; zu viel wird so genannt. Eine Korrektur übernimmt, was auf die ersetzte Abrechnung gezahlt wurde.
- Die Auszahlung wird gegen das Verrechnungskonto gebucht, nach dem Weg des Geldes, wie eine private Rückzahlung.
- Reisen sagt, ob die Abrechnung ausgezahlt ist, teilweise oder zu viel.

## Offene Punkte

Auf Reisen, gezählt auf Home und unter Rückfragen:

- ein als Ticket, Flug oder Hotel gelesener Beleg ohne Reise (nicht einer, den ein Vorschlag abdeckt oder der abgelehnt wurde);
- eine Reise ohne Zeiten oder mit Lücken;
- eine Bewirtung ohne das, was das Gesetz verlangt;
- eine Abrechnung, zwei Wochen nach dem Erstellen nicht ausgezahlt.

## Noch nicht

- Die Übernachtungspauschalen ohne Hotelrechnung für Angestellte (nächster Schritt von #380).
- Erstattungen über den gesetzlichen Pauschalen: Belege erstattet genau diese und Belege in ihrer Höhe, nennt also nichts als lohnsteuerpflichtig; das bestätigt die Steuerberatung.
- Vorschüsse vor einer Reise, und die Abrechnung einer Firmenkreditkarte Zeile für Zeile.

Sätze, Konten und die Behandlung des Autos von Familienangehörigen sind mit der Steuerberatung abzustimmen; das beschreibt, was Belege tut, keine Steuerberatung.
