# Bankkonten: Kontoauszug-Dateien, Hibiscus, Enable Banking

_English: [banking.md](banking.md)_

Zahlungen kommen auf drei Wegen in Belege. Alle füllen dieselben Bücher, und ein Konto wird nicht doppelt angelegt, nur weil es auf einem zweiten Weg kommt.

| Weg                      | Braucht                               | Banken                         | Wann abgerufen wird          |
| ------------------------ | ------------------------------------- | ------------------------------ | ---------------------------- |
| Kontoauszug-Datei (CAMT) | nichts: wird im Browser gelesen       | jede, die CAMT.053 exportiert  | wenn du eine Datei hochlädst |
| Hibiscus                 | die Bridge, Hibiscus/Jameica, FinTS   | deutsche Banken mit FinTS/HBCI | bei „Synchronisieren“        |
| Enable Banking           | die Bridge und deine eigene Anwendung | Banken in Europa (PSD2)        | bei „Umsätze holen“          |

Alle drei stehen unter _Integrationen → Bank_.

## Kontoauszug-Dateien (CAMT.053)

Exportiere den Kontoauszug im Online-Banking als CAMT.053 (XML) und lade ihn unter _Integrationen → Bank_ hoch. Die Datei wird im Browser gelesen und nie hochgeladen. Das Konto kennt Belege an einem Hash seiner IBAN. Nennt ein Auszug keine IBAN (etwa Wise), nimmt Belege stattdessen die andere Kontokennung der Bank. Ein Konto in anderer Währung behält seine Beträge und wird zum Tageskurs bewertet, den die Bridge kennt (die Kurse stehen in [crypto.de.md](crypto.de.md)).

Nennt der Auszug einer Bank keine IBAN, trag die IBAN des Kontos unter _Einstellungen → Eigene IBANs_ ein. Dann werden Umbuchungen zwischen deinen eigenen Konten erkannt.

**Besonders Wise:** Seine Auszüge nennen die eigene IBAN des Kontos nie. Ohne sie verlangt eine Zahlung vom Bankkonto zu Wise einen Beleg; die Bank nennt den Empfänger oft „Wise Europe SA“. Der Rückweg wird erkannt, weil Wise ihn unter eurem Firmennamen schickt. Das nutzt Belege: Eine IBAN, die Geld unter eurem Firmennamen schickt, wird auf Home als „Ist das ein eigenes Konto?“ angeboten, zusammen mit den offenen Zahlungen, die sie erklären würde. „Ja, eigenes Konto“ speichert sie als eigene IBAN, und jede Zahlung dorthin ist von da an eine eigene Umbuchung (Konto 1360). „Nein, nicht unseres“ beendet das Angebot, etwa bei einem Kunden, dessen Name eurem nur ähnelt. Ohne den Klick wird nichts gespeichert.

## Hibiscus

Hibiscus (in Jameica) ruft deine deutschen Bankkonten per FinTS ab, und die Bridge liest sie dort. Einmal einrichten mit `pnpm setup:hibiscus`; die Einzelheiten stehen in [bridge/README.md](../bridge/README.md#setup-macos).

## Enable Banking

[Enable Banking](https://enablebanking.com) ist ein Kontoinformationsdienst (AIS) nach PSD2. Nach deiner Freigabe bei der Bank liest er Konten und Umsätze und reicht sie weiter. Er erreicht Banken, die Hibiscus nicht abruft, etwa Revolut, Wise und die meisten Banken außerhalb Deutschlands.

### Deine eigene Anwendung

Belege hat keinen Server und verwahrt keinen Schlüssel für dich. Deshalb **legt jede Installation ihre eigene Anwendung bei Enable Banking an**, und ihr privater Schlüssel bleibt in deiner Bridge – wie beim Sprachmodell und bei Kraken.

**Für die eigenen Konten: Produktion, eingeschränkt.** Eine Anwendung für die _Produktion_ wird im **eingeschränkten Modus** aktiv, sobald du deine eigenen Konten im Control Panel verbindest („Link accounts“); sie steht dann auf „Active“ und „Restricted“. So erreicht sie genau die dort verbundenen Konten – das, was Belege braucht; die Anleitungen von [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/) und [Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) beschreiben diesen Modus als kostenlos. Die Einschränkung aufzuheben (Konten anderer Leute) braucht die Freischaltung durch Enable Banking und deren Bedingungen. Eine _Sandbox_-Anwendung erreicht nur Testbanken mit erfundenen Daten; sie ist zum Ausprobieren, nicht für deine Bücher.

1. **Anwendung anlegen** im Control Panel von Enable Banking.
   - **Umgebung:** Production.
   - **Redirect-URL:** `https://belege.le-space.de/integrationen/bank/verbunden`, oder dieselbe Seite auf deiner eigenen Domain. Eine Produktiv-Anwendung nimmt nur https, also weder `localhost` noch `127.0.0.1` (eine Sandbox-Anwendung auch http).
   - **Der Schlüssel:** Entweder erzeugt ihn das Panel im Browser, und du lädst eine private Schlüsseldatei (`.pem`) herunter, oder du lädst ein eigenes Zertifikat hoch:

     ```bash
     openssl req -x509 -newkey rsa:4096 -nodes -keyout private.key -out public.crt -days 3650 -subj "/CN=belege"
     ```

     Dann kommt `public.crt` ins Panel, und `private.key` ist die Datei, die die Bridge braucht. Bewahre die Schlüsseldatei sicher auf: Enable Banking kann sie nicht noch einmal herausgeben.

   - **Konten im Control Panel verbinden** („Link accounts“): Bank wählen, anmelden, freigeben. Das macht die Anwendung im eingeschränkten Modus aktiv, für genau diese Konten. Mach das **vor** dem Verbinden in Belege: Ohne diesen Schritt bietet Enable Banking später keine Konten an.

2. **Bridge einrichten:**

   ```bash
   pnpm setup:enablebanking
   ```

   Das Setup fragt nach der Application-ID, dem Pfad des privaten Schlüssels (nicht der `.crt`) und der Redirect-URL. Ein Testaufruf sagt dann:
   - ob der Schlüssel angenommen wird;
   - welche Umgebung es ist (Sandbox oder Produktion);
   - ob die Anwendung freigeschaltet ist;
   - ob die Redirect-URL eingetragen ist.

   Der Schlüssel wird versiegelt in `~/.config/belege/enablebanking.sealed` abgelegt (AES-256-GCM, Rechte 0600). Den Schlüssel zum Öffnen hält der macOS-Schlüsselbund bzw. die Windows-Anmeldeinformationsverwaltung. Danach die Bridge neu starten.

3. **Bank verbinden** in der App unter _Integrationen → Bank → Über Enable Banking_:
   - Land und Bank wählen, bei Banken mit beidem auch die Kontoart;
   - „Bei der Bank freigeben“ klicken;
   - bei der Bank anmelden und Lesezugriff erlauben; die Freigabe gilt höchstens 180 Tage;
   - die Bank schickt dich zurück in die App; Belege noch einmal entsperren, und die Bank ist verbunden.
4. **Konten freigeben**, die in die Bücher dürfen:

   ```bash
   pnpm setup:enablebanking -- --accounts
   ```

   Das zeigt die verbundenen Konten (Bank, Name, letzte vier Stellen der IBAN) und fragt nach den IBAN-Endungen, die freigegeben werden – wie bei `setup:hibiscus`. Jedes andere Konto bleibt in der Bridge, so kommt ein Privatkonto bei derselben Bank nie in die Bücher. Danach die Bridge neu starten.

5. **Abrufen** mit „Umsätze holen“:
   - beim ersten Mal die letzten 90 Tage, danach ab einer Woche vor dem letzten Abruf, oder ab einem Tag, den du wählst;
   - nur gebuchte Umsätze; vorgemerkte werden gezählt und kommen, sobald die Bank sie bucht;
   - Banken erlauben nur wenige unbeaufsichtigte Abrufe am Tag, deshalb ruft Belege nur auf deinen Klick ab.

### Ein Konto, egal auf welchem Weg

Ein Konto kennt Belege an einem Hash seiner IBAN, nie an der IBAN selbst.

- **Hat eine Kontoauszug-Datei das Konto schon gebracht,** führt Enable Banking es weiter. Der Abruf beginnt am Tag nach der letzten Buchung aus der Datei, sodass sich beide nie überschneiden.
- **Kommt dasselbe Konto auch über Hibiscus,** käme es doppelt. Die Bank-Seite warnt, wenn ein Hibiscus-Konto auf dieselben vier Stellen endet; ruf es nur auf einem Weg ab.

### Wenn die Freigabe endet

Die Freigabe bei der Bank endet nach höchstens 180 Tagen.

- Zwei Wochen vorher sagt _Braucht dich_ Bescheid, danach steht dort ein Fehler.
- „Erneuern“ auf der Bank-Seite fragt die Bank erneut. Die neue Freigabe ersetzt die alte; die alte wird auch bei Enable Banking beendet.
- Konto und Buchungen bleiben, wie sie sind.

„Trennen“ beendet eine Freigabe sofort. Schon geholte Umsätze bleiben in den Büchern.

### Was wo liegt

| Was                                                               | Wo                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Application-ID, Redirect-URL, freigegebene IBAN-Endungen          | `~/.config/belege/bridge.json` (0600)                                                                                                  |
| Privater Schlüssel und Sitzungen, mit den vollen IBANs der Konten | `~/.config/belege/enablebanking.sealed` (0600, AES-256-GCM); sein Schlüssel im Schlüsselbund bzw. in der Anmeldeinformationsverwaltung |
| Verbundene Banken, Ende der Freigaben, letzte vier Stellen        | die App, in ihrem versiegelten Speicher                                                                                                |
| Umsätze freigegebener Konten                                      | die Bücher der App, wie jede andere Buchung                                                                                            |

**Was den Rechner verlässt:**

- **An Enable Banking:** welche Bank du verbindest, deine Konten dort, die Umsätze freigegebener und abgerufener Konten und die IP-Adresse dieses Rechners. Die Umsätze laufen über seine Server.
- **An deine Bank:** deine Anmeldung und die Freigabe, auf ihrer eigenen Seite. Dein Bank-Passwort sehen weder Belege noch die Bridge.
- **Nie:** Belege, Buchungen aus anderen Quellen, sonst etwas aus deinen Büchern.

**Wer mit wem spricht:** Nur die Bridge spricht mit `api.enablebanking.com`. Jede Anfrage ist mit dem Schlüssel deiner Anwendung signiert (ein RS256-JWT, zehn Minuten gültig). Der Browser geht nur zur Bank und zurück.

**Der Einmal-Code:** Die Bank schickt den Browser mit einem Einmal-Code in der Adresse zurück. Diese Adresse läuft auch über das Gateway, das die App ausliefert. Die Seite nimmt den Code sofort aus der Adresse. Die Bridge nimmt ihn nur für eine Freigabe an, die sie selbst begonnen hat, nur einmal und nur binnen 30 Minuten. Ohne den Schlüssel deiner Anwendung ist der Code wertlos.

### Wenn etwas nicht klappt

| Meldung                                                                       | Was tun                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „That is the public certificate you gave Enable Banking“                      | den privaten Schlüssel angeben, mit dem es erzeugt wurde (`private.key`, die `-keyout`-Datei), nicht die `.crt`                                                                       |
| „…: there is no file there“                                                   | den Pfad ohne Anführungszeichen angeben; `~` ist dein Benutzerordner; ein relativer Pfad beginnt in `bridge/`                                                                         |
| „Enable Banking did not accept the key“                                       | gehört der Schlüssel zum Zertifikat im Panel? `openssl x509 -in public.crt -noout -pubkey \| openssl sha256` mit `openssl pkey -in private.key -pubout \| openssl sha256` vergleichen |
| „not active yet“, oder nach dem Verbinden zeigt die Bank keine Konten         | Konten im Control Panel verbinden („Link accounts“); dann ist die Anwendung eingeschränkt aktiv, für genau diese Konten                                                               |
| „SANDBOX“ in der Antwort des Setups                                           | eine Sandbox-Anwendung erreicht nur Testbanken; für die eigenen Konten eine Produktiv-Anwendung anlegen                                                                               |
| „… is not among the application's redirect URLs“                              | die URL im Control Panel eintragen, genau so wie angegeben                                                                                                                            |
| „Noch verlässt kein Konto die Bridge“                                         | `pnpm setup:enablebanking -- --accounts`, dann die Bridge neu starten                                                                                                                 |
| „Diese Antwort gehört nicht zu der Freigabe …“ oder „… older than 30 minutes“ | die Freigabe auf der Bank-Seite neu beginnen                                                                                                                                          |
| „allows no more requests for now“                                             | das Tageslimit der Bank; später noch einmal                                                                                                                                           |
