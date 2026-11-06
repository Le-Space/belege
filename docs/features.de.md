# Funktionen

[English](features.md) · **Deutsch**

Was Le Space Belege heute kann, nach Themen geordnet. Eine kürzere Fassung dieser Liste steht im Datenschutz-Hinweis der App (_Was Le Space Belege kann_).

## Datenschutz und Speicherung

- **Passkey statt Passwort.** Jeder Eintrag und jede Belegdatei ist versiegelt (AES-GCM). Die Schlüssel kommen aus der Wurzel der Bücher, die dein Passkey über den Tresor öffnet. Kein privater Schlüssel liegt auf dem Gerät. Siehe [keys.de.md](keys.de.md).
- **Local-first.** Die Bücher liegen in diesem Browser (OrbitDB und Helia auf IndexedDB). Le Space betreibt keinen Server dafür.
- **Das Netzwerk in deiner Hand.** Das Abzeichen oben zeigt, was online ist. Ein Klick pausiert alles. Eigene Geräte und die Rechnungs-App lassen sich einzeln an- und ausschalten ([#180](https://github.com/Le-Space/belege/issues/180)).

## Schlüssel und Backup

- **Mehr als ein Weg hinein.** Du kannst weitere Passkeys anlegen, zum Beispiel einen Sicherheitsschlüssel, und dir 24 Wiederherstellungswörter aufschreiben. Jeder Passkey und die Wörter öffnen dieselben Bücher, auch auf einem leeren Gerät.
- **Backup bei Aleph Cloud,** versiegelt, bevor es das Gerät verlässt. Nach dem ersten Vollbackup geht nur hoch, was neu ist. Auf Wunsch sichert Belege automatisch, fünf Minuten nach der letzten Änderung. Die Karte zeigt, ob alles gesichert ist und wie lange die Credits reichen. Reichen sie keine 30 Tage mehr, warnt der Kopf der App. Siehe [backup.de.md](backup.de.md).
- **Wiederherstellen** mit einem Passkey oder den Wörtern dieser Bücher. Belege führt zusammen und löscht nichts.
- **Neue Schlüssel für die Bücher,** zum Beispiel nachdem ein Mitglied gegangen ist. Ältere Backups lassen sich danach weiter wiederherstellen.
- **Umzug** in die Bücher eines anderen Passkeys, mit einer versiegelten Umzugsdatei.

## Zahlungen

- **Woher die Zahlungen kommen:**
  - Bankumsätze aus [Hibiscus](https://github.com/willuhn/hibiscus) über die Bridge, nur freigegebene Konten;
  - Banken in Europa über **Enable Banking**, mit eigener Anwendung, über die Bridge, nur freigegebene Konten ([banking.de.md](banking.de.md));
  - Kontoauszüge als **CAMT.053** (Revolut, GLS, …), im Browser eingelesen;
  - **Firmenkreditkarten** als eigene Konten, ihre Abrechnungen aus der CSV des Herausgebers.
- **Ein Geschäftsjahr nach dem anderen**, mit Jahresumschalter. Zusammengehörige Buchungen sind einen Klick entfernt: beide Seiten einer Umbuchung, die Seiten eines Handels, eine Gebühr.
- **Private Zahlungen** vom Geschäftskonto werden markiert, dokumentiert und verrechnet ([#172](https://github.com/Le-Space/belege/issues/172)).

## Belege

- **Woher die Belege kommen:**
  - aus dem Buchhaltungs-Postfach (IMAP, nur lesend);
  - per Upload;
  - aus einem geteilten Ordner, den die App jede Minute prüft. Neue Dateien dort liest die KI nur aus, solange „gleich auslesen“ an ist;
  - aus deinem eigenen **Paperless-ngx** über die Bridge ([#318](https://github.com/Le-Space/belege/issues/318), `pnpm setup:paperless`), siehe unten;
  - aus Kundenportalen über einen Browser auf dem Rechner der Bridge: Vodafone MeinKabel, und eigene Portale, deren Weg du einmal aufzeichnest;
  - auf Klick aus der Suche im privaten Postfach, direkt von der Buchung aus.
- **Paperless-ngx** im Einzelnen:
  - Belege holt, was seit dem letzten Abruf neu ist, beim Öffnen der Belege-Seite und auf Klick.
  - Die Originaldatei ist der Beleg. Ein Mail-Anhang, der auch in Paperless landete, wird an seinen Bytes als doppelt erkannt.
  - Ein Scan oder Foto ohne Textebene wird mit dem Text gelesen, den Paperless erkannt hat.
  - Solange Paperless an ist, ruft Belege das Postfach nicht selbst ab, das machen die Mailregeln von Paperless. Schaltest du es trotzdem ein, bleiben Dokumente mit den genannten Tags draußen.
  - An einer Zahlung fragt _Beleg finden → Paperless_ die Volltextsuche von Paperless, mit dem Suchtext oder sonst mit der Gegenpartei. Einen Treffer übernimmt Belege wie einen Upload: ausgelesen, dieser Zahlung zugeordnet und als aus Paperless gekennzeichnet.
- **Geprüft:**
  - Mails ohne gültiges DKIM/SPF warten auf eine Freigabe. Anzeichen für Betrug nennt Belege.
  - Kopien einer Rechnung werden markiert, und jeder Beleg lässt sich beiseitelegen.
- **E-Rechnungen (XRechnung)** ([#160](https://github.com/Le-Space/belege/issues/160)):
  - Eine XML-Rechnung in UBL oder CII, hochgeladen oder aus dem Postfach, wird als Original aufbewahrt und sofort ohne KI gelesen: Verkäufer, Nummer, Daten, USt, Positionen, Summe.
  - Sie erscheint als schlichte Ansicht ihrer Felder und geht so in den Export, wie sie kam: als XML.
  - Ein **ZUGFeRD/Factur-X**-PDF wird aus dem eingebetteten XML gelesen. Das XML wird neben dem PDF aufbewahrt und mit exportiert.
  - Ein PDF von einem nicht bestätigten Absender wird erst nach der Bestätigung geöffnet.
  - Factur-X MINIMUM und BASIC WL werden gelesen, aber nicht als E-Rechnung nach EN 16931 bezeichnet.
- **Eigenbeleg:** ein selbst erstellter Beleg für eine Zahlung ohne Beleg. Bei Krypto mit Hash, beiden Adressen und Gas, und mit der Transaktion als QR-Code.

## Abgleich

- **Eine Punktzahl** aus Betrag, Rechnungs- und Kundennummer, IBAN, Lieferant und Datum. Sichere Paare werden verknüpft. Der Rest wird eine Frage auf der Startseite.
- **Keinen Beleg brauchen:**
  - Umbuchungen zwischen eigenen Konten, erkannt an Gegenbuchung, Referenz oder IBAN, auch Zwillinge, über Chains hinweg (IBC, Bridges, Swaps über Chains) und von Hand verknüpft;
  - Bankgebühren;
  - Erstattungen, gepaart mit ihrer Belastung;
  - Staub;
  - deine eigenen Regeln.
- **Lieferantenkonten** für Guthaben- und Sammelabrechnungen: eine Zeitleiste mit laufendem Saldo. Sie nennt, was nicht aufgeht.
- **Lernen** aus deinen Verknüpfungen: welche Gegenpartei welcher Lieferant ist und welche Gebühren Gebühren sind.

## KI, nur auf Klick (✦)

- **An fünf Stellen:**
  1. den Text eines Belegs auslesen;
  2. _Mit KI weitersuchen_ im privaten Postfach;
  3. _KI-Vorschlag_ für einen Beleg;
  4. _KI-Vorschlag_ für die Gegenbuchung einer Umbuchung;
  5. _Ungereimtheiten erklären_ in einem Lieferantenkonto.
- **Dein eigenes Modell**, eingerichtet in der Bridge (DeepSeek, Ollama, …). Vor dem Senden wird geschwärzt. Das begrenzt, was hinausgeht, anonym macht es den Text aber nicht. Ein lokales Modell schickt nichts hinaus. Le Space betreibt keine KI.
- **Verbrauch im Blick:** Tokens und Kosten je Tag, Woche, Monat und Beleg. Siehe [ai.de.md](ai.de.md).

## Krypto

- **Quellen:**
  - Kraken;
  - eigene Wallets auf Cosmos-Chains (Nym, Akash, samt älterer Akash-Geschichte);
  - EVM-Chains (Ethereum, Base, Arbitrum, OP Mainnet, Polygon), über Blockscout oder Alchemy;
  - Bitcoin (xpub/ypub/zpub);
  - Filecoin per Adresse, über Filfox, mit USDFC und Tausch über SushiSwap.
- **Jede Buchung in Euro**, mit genauer Menge und dem Tageskurs samt Quelle:
  - CoinGecko, Kraken oder EZB (für den Rubel die Bank of Russia, für den Tenge die Nationalbank Kasachstans, sonst ein Kreuzkurs über den Rubel);
  - ein DEX-Pool im Block der Buchung (Uniswap V2, V3 und V4, gegen ETH oder USDC);
  - die andere Seite eines Handels oder die verbrannten alten Token einer Migration;
  - von Hand.
- **Erkannt werden** DEX-Swaps, Swaps über Chains, Token-Migrationen und Staub. Absender mit ähnlich aussehender Adresse benennt Belege.
- **Aleph-Cloud-Guthaben** als Monatsauszug je Konto. Siehe [crypto.de.md](crypto.de.md).

## Vorbereitende Buchhaltung und Export

- **Jede Buchung** bekommt ein SKR-03-Konto und einen BU-Schlüssel. Belege schlägt sie vor, du bestätigst. Deinen eigenen Kontenrahmen kannst du einlesen.
- **Umsatzsteuer auf der Startseite** ([#195](https://github.com/Le-Space/belege/issues/195)), je Monat oder Quartal und fürs Jahr. Eine Hilfe für die Voranmeldung, nicht die Voranmeldung selbst:
  - die Vorsteuer aus den Belegen (19 % und 7 %, nach Belegdatum);
  - die Umsatzsteuer aus den Rechnungen der Rechnungs-App, wenn das Geld kommt (Ist, voreingestellt) oder am Rechnungsdatum (Soll), wie unter Buchhaltung eingestellt;
  - daraus die Zahllast oder Erstattung.
- **Eigene Rechnungen unter den Belegen** ([#354](https://github.com/Le-Space/belege/issues/354)), hochgeladen oder aus dem Postfach, erkennt Belege am Firmennamen, an der Markierung `[FIRMA]` des Modells oder an der eigenen USt-IdNr unter Buchhaltung. Ihre Steuer zählt als Umsatzsteuer, nie als Vorsteuer. Der Beleg sagt es, und du kannst es umstellen.
- **Internationales und Sonderfälle** zeigt Belege getrennt, mit ihren Belegen:
  - innergemeinschaftliche Lieferungen, mit den Zeilen für die Zusammenfassende Meldung je Zeitraum und USt-IdNr der Kundin oder des Kunden;
  - Drittland-Umsätze, §13b im Inland, steuerfreie Umsätze und innergemeinschaftliche Erwerbe;
  - was sich nicht ohne Raten einordnen lässt, etwa eine EU-Rechnung ohne USt-IdNr der Kundin oder des Kunden, mit Link.

  Ausländische Steuer, §13b, noch nicht bezahlte Rechnungen und Rechnungen, deren Steuer die App nicht geliefert hat, stehen gesondert. Als Kleinunternehmer (§19 UStG) siehst du stattdessen den Umsatz gegen die Grenzen.

- **Jeden Monat ein ZIP:** ein DATEV-Buchungsstapel (EXTF) für deine Buchhaltung, die Belege als PDF und ein Auszug je Konto. Siehe [export.de.md](export.de.md).

## Reisekosten

- **Reisen** ([#213](https://github.com/Le-Space/belege/issues/213)) mit ihren Belegen:
  - die gesetzlichen Verpflegungspauschalen nach Zeiten und Ländern (gestellte Mahlzeiten, Dreimonatsregel);
  - Kilometer, das Auto von Familienangehörigen für die Steuerberatung markiert;
  - Bewirtungen mit ihrer Aufteilung.

  Ein Beleg in anderer Währung zählt in Euro, nach Zahlung, Auslage oder Kurs.

- **Erkannt, nie von selbst zugeordnet:** Art, Strecke, Länder und Zeiten einer Reiseausgabe aus dem Auslesen, ohne KI aus ihren Wörtern in elf Sprachen. Grenzübertritte kommen aus den Fahrkarten. Reisen schlägt Belege nach Datum und Strecke vor. Termine kommen aus Kalendereinladungen (nur Titel, Ort und Zeiten).
- **Eine Abrechnung pro Monat** als nummeriertes deutsches PDF. Sie wird auf SKR-03-Reisekostenkonten nach Rechtsform gegen das Verrechnungskonto des Reisenden gebucht, und die Auszahlung wird ihr zugeordnet. Siehe [travel.de.md](travel.de.md).

## Geräte und Zusammenarbeit

- **Dieselben Bücher auf Telefon und Rechner.** Ein Gerät bekommt sie erst, wenn es den Schlüssel der Bücher beweist, und nur, wenn die Bücher es kennen oder jemand es zulässt. Geräte kommen per QR-Code dazu und gehen mit einem Klick wieder. Siehe [device-proof.de.md](device-proof.de.md).
- **Wo sich Geräte treffen** ([#148](https://github.com/Le-Space/belege/issues/148)):
  - an den öffentlichen Le-Space-Relays;
  - am Relay deiner eigenen Bridge, nur im eigenen Netz (`pnpm setup:relay`, WebRTC-Direct, kein Zertifikat zu installieren);
  - ganz ohne Relay, indem zwei Geräte QR-Codes tauschen, direkt im Netz-Menü oben. Die Einladung ist ein Link, den die Kamera des Telefons öffnet. Nach dem Entsperren zeigt das Menü dort gleich die Antwort. Auf dem iPhone geht das besser aus der App vom Home-Bildschirm, die ihre Bücher getrennt von Safari hält;
  - oder über alle Wege. Ein Gerät, das die Bücher noch nicht kennen, kommt dann nur per QR oder über das Relay der eigenen Bridge herein.
- **Die Bridge auch vom Telefon.** Die Bridge hat einen eigenen Knoten und ist über die Relays erreichbar, auch wenn am Rechner kein Browser offen ist. Alternativ gibt ein offener Tab am Rechner sie an die eigenen Geräte weiter. Belege lässt sich als App installieren (PWA), und die App-Hülle funktioniert offline.
- **Mitglieder** ([#641](https://github.com/Le-Space/belege/issues/641)): Eine zweite Person kommt mit ihrem eigenen Passkey in deine Bücher. Du wählst beim Aufnehmen:
  - **Schreibt mit**, zum Beispiel die Buchhaltung: liest, schreibt unter eigenem Namen und macht Backups. Deine Bridge nutzt sie nur, wenn du das ankreuzt.
  - **Liest mit**, zum Beispiel eine Assistenz: liest und gleicht ab, sonst nichts.

  Du kannst ein Mitglied jederzeit herausnehmen. Siehe [keys.de.md](keys.de.md#mitglieder).

- **Rechnungs-App (UCEP):** Sie erstellt Eigenbelege für Belege und erfährt, welche ihrer Rechnungen bezahlt sind. Eine Rechnung, die sie als XRechnung ausgestellt hat, kommt mit ihrem XML. Das XML liegt als Original neben dem PDF und geht mit in den Export ([#515](https://github.com/Le-Space/belege/issues/515)).
- **Einblick für einen KI-Assistenten** auf diesem Rechner, zum Beispiel Claude Code: Er sieht Zahlungen, Belege und Rückfragen eines Jahres, statt mit Bildschirmfotos zu arbeiten. Du wählst, was er sieht und wie lange. Die Bridge hält die Freigabe nur im Arbeitsspeicher und zählt jeden Abruf. Was er liest, geht als Gesprächsinhalt an seinen Anbieter.

## Sprache

- **Deutsch und Englisch** ([#192](https://github.com/Le-Space/belege/issues/192)), oben umschaltbar, sofort und offline. Beim ersten Besuch gilt die Sprache des Browsers. Beträge, Datumsangaben und Krypto-Mengen folgen der Sprache. Dokumente für die deutsche Buchhaltung bleiben deutsch: der Eigenbeleg, die Kontoauszüge und der DATEV-Export.
