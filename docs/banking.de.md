# Bankkonten: Kontoauszug-Dateien, Hibiscus, Enable Banking

_English: [banking.md](banking.md)_

Zahlungen kommen auf drei Wegen in Belege. Alle drei füllen dieselben Bücher. Kommt ein Konto auf einem zweiten Weg, legt Belege es nicht doppelt an.

- **Kontoauszug-Datei (CAMT):**
  - Du brauchst nichts weiter. Belege liest die Datei im Browser.
  - Geht mit jeder Bank, die Auszüge im Format CAMT.053 exportiert.
  - Neue Umsätze kommen, wenn du eine Datei hochlädst.
- **Hibiscus:**
  - Du brauchst die Bridge, Hibiscus in Jameica und FinTS. Die Bridge ist das kleine Programm von Belege auf deinem Rechner. FinTS (früher HBCI) ist die Schnittstelle, über die deutsche Banken Umsätze an Programme geben.
  - Geht mit deutschen Banken, die FinTS/HBCI anbieten.
  - Neue Umsätze kommen bei „Synchronisieren“.
- **Enable Banking:**
  - Du brauchst die Bridge und deine eigene Anwendung bei Enable Banking.
  - Geht mit Banken in Europa (PSD2).
  - Neue Umsätze kommen bei „Umsätze holen“.

Alle drei findest du unter _Integrationen → Bank_. Dort stehen auch die Firmenkreditkarten.

## Kontoauszug-Dateien (CAMT.053)

Exportiere den Kontoauszug in deinem Online-Banking als CAMT.053. Das ist eine XML-Datei. Lade sie unter _Integrationen → Bank_ hoch. Belege liest die Datei im Browser. Sie wird nie hochgeladen.

Belege erkennt das Konto an einem Hash seiner IBAN. Ein Hash ist eine Art Fingerabdruck: Er passt nur zu dieser IBAN, verrät sie aber nicht. Nennt ein Auszug keine IBAN (etwa bei Wise), nimmt Belege stattdessen die andere Kontokennung der Bank.

Ein Konto in einer anderen Währung behält seine Beträge. Belege bewertet sie in Euro, zum Tageskurs, den die Bridge kennt. Woher die Kurse kommen, steht in [crypto.de.md](crypto.de.md).

Nennt der Auszug einer Bank keine IBAN, trag die IBAN des Kontos unter _Einstellungen → Eigene IBANs_ ein. Dann erkennt Belege Umbuchungen zwischen deinen eigenen Konten.

### Besonders Wise

Die Auszüge von Wise nennen die eigene IBAN des Kontos nie. Das hat Folgen:

- Ohne diese IBAN verlangt eine Zahlung vom Bankkonto zu Wise einen Beleg. Die Bank nennt den Empfänger oft „Wise Europe SA“.
- Der Rückweg wird erkannt. Wise schickt das Geld nämlich unter eurem Firmennamen.

Das nutzt Belege. Schickt eine IBAN Geld unter eurem Firmennamen, fragt Home: „Ist das ein eigenes Konto?“ Dazu zeigt Home die offenen Zahlungen, die sich damit erklären würden.

- „Ja, eigenes Konto“ speichert die IBAN als eigene IBAN. Jede Zahlung dorthin ist von da an eine eigene Umbuchung (Konto 1360).
- „Nein, nicht unseres“ beendet die Frage. Das passt etwa bei einem Kunden, dessen Name eurem nur ähnelt.
- Ohne deinen Klick wird nichts gespeichert.

## Firmenkreditkarten

Eine Firmenkreditkarte ist ein eigenes Konto ([#382](https://github.com/Le-Space/belege/issues/382)).

So legst du sie an: Unter _Integrationen → Bank → Firmenkreditkarten_ gibst du ihr einen Namen und die letzten vier Ziffern der Kartennummer. Dann liest du ihre Abrechnung ein. Das ist der **CSV**-Export des Kartenherausgebers. Belege liest ihn nur im Browser und lädt ihn nie hoch.

**Spalten.** Belege erkennt die Spalten an ihren üblichen deutschen und englischen Namen:

- Belegdatum / Transaction date
- Buchungsdatum
- Beschreibung / Merchant
- Betrag / Amount, oder getrennt Soll/Haben bzw. Debit/Credit
- Währung, Originalbetrag, Originalwährung, Kurs
- Referenz

Zeilen über der Tabelle überspringt Belege, etwa die Angaben zu Karte und Zeitraum. Vor dem Import siehst du die Zeilen. Eine Spalte, die Belege nicht erkannt hat, kannst du von Hand wählen. Diese Wahl gilt auch für die nächste Abrechnung der Karte.

**Belastungen sind Ausgaben.** Die meisten Herausgeber führen sie als positive Beträge. Belege dreht deshalb das Vorzeichen um, wenn die meisten Zeilen positiv sind und keine Soll/Haben-Spalten etwas anderes sagen. Vor dem Import kannst du das mit einem Kästchen ändern.

**Jede Zeile ist eine Zahlung** des Kartenkontos.

- Der Abgleich verknüpft sie mit ihrem Beleg, wie jede andere Zahlung. Der Beleg gilt dann als **von der Firma bezahlt**.
- Ein Beleg in fremder Währung bekommt **die Euro, die die Karte belastet hat** ([travel.de.md](travel.de.md)).
- Ein Betrag in fremder Währung bleibt mit Währung und Kurs des Herausgebers erhalten.
- Eine Zeile ohne Beleg fragt nach einem, wie jede Zahlung.

**Die monatliche Abbuchung** auf dem Bankkonto ist eine eigene Umbuchung zur Karte (Konto 1360). Sie fragt nicht nach einem Beleg. Belege findet die passende Abbuchung so:

- Die Kartenabrechnung hat eine Ausgleichszeile, etwa „Zahlung erhalten“ oder „Lastschrift“. Belege speichert sie als Buchungsart _Kartenausgleich_. Dann paart Belege beide über den Betrag, wenn sie wenige Tage auseinander liegen.
- Sonst sucht Belege im Text der Abbuchung die letzten vier Ziffern der Kartennummer. Dazu muss dort auch ein Kartenwort stehen, etwa Kreditkarte, Kartenabrechnung, Visa, Mastercard, Amex oder card. Vier Ziffern allein genügen nie.
- Eine Ausgleichszeile, deren Abbuchung nicht in den Büchern ist, braucht ebenfalls keinen Beleg.

**Dieselbe Abrechnung noch einmal** einzulesen fügt nur Neues hinzu.

**Das Sachkonto der Karte** trägst du unter _Einstellungen → Buchhaltung_ ein, wie bei einem Bankkonto. Welches Konto das ist, klärst du mit deiner Steuerberatung.

Noch nicht möglich: Abrechnungen als PDF.

## Hibiscus

Hibiscus ist ein Programm für Online-Banking. Es läuft in Jameica. Hibiscus ruft deine deutschen Bankkonten per FinTS ab, und die Bridge liest die Umsätze dort.

Du richtest es einmal ein, mit `pnpm setup:hibiscus`. Die Einzelheiten stehen in [bridge/README.md](../bridge/README.md#setup-macos).

## Enable Banking

[Enable Banking](https://enablebanking.com) ist ein Kontoinformationsdienst (AIS) nach PSD2. PSD2 ist die EU-Richtlinie, nach der Banken solchen Diensten Lesezugriff geben müssen. Du gibst den Zugriff bei deiner Bank frei. Dann liest Enable Banking deine Konten und Umsätze und reicht sie weiter.

Enable Banking erreicht Banken, die Hibiscus nicht abruft, etwa Revolut, Wise und die meisten Banken außerhalb Deutschlands.

### Deine eigene Anwendung

Belege hat keinen Server und verwahrt keinen Schlüssel für dich. Deshalb **legt jede Installation ihre eigene Anwendung bei Enable Banking an**. Ihr privater Schlüssel bleibt in deiner Bridge. Beim Sprachmodell und bei Kraken ist es genauso.

**Für die eigenen Konten: Produktion, eingeschränkt.**

- Du legst eine Anwendung für die _Produktion_ an.
- Sie wird aktiv, sobald du im Control Panel von Enable Banking deine eigenen Konten verbindest („Link accounts“). Sie steht dann auf „Active“ und „Restricted“, also im **eingeschränkten Modus**.
- In diesem Modus erreicht sie genau die dort verbundenen Konten. Mehr braucht Belege nicht.
- Die Anleitungen von [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/) und [Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) beschreiben diesen Modus als kostenlos.
- Für die Konten anderer Leute müsste die Einschränkung weg. Das braucht die Freischaltung durch Enable Banking und deren Bedingungen.

Eine _Sandbox_-Anwendung erreicht nur Testbanken mit erfundenen Daten. Sie ist zum Ausprobieren da, nicht für deine Bücher.

#### 1. Anwendung anlegen

Leg im Control Panel von Enable Banking eine Anwendung an:

- **Umgebung:** Production.
- **Redirect-URL:** `https://belege.le-space.de/integrationen/bank/verbunden`, oder dieselbe Seite auf deiner eigenen Domain. Auf diese Adresse schickt die Bank dich nach der Freigabe zurück. Eine Produktiv-Anwendung nimmt nur https, also weder `localhost` noch `127.0.0.1`. Eine Sandbox-Anwendung nimmt auch http.
- **Der Schlüssel:** Dafür gibt es zwei Wege.
  - Das Panel erzeugt ihn im Browser. Du lädst dann eine private Schlüsseldatei (`.pem`) herunter.
  - Oder du lädst ein eigenes Zertifikat hoch:

    ```bash
    openssl req -x509 -newkey rsa:4096 -nodes -keyout private.key -out public.crt -days 3650 -subj "/CN=belege"
    ```

    Dann kommt `public.crt` ins Panel. `private.key` ist die Datei, die die Bridge braucht.

  Bewahre die Schlüsseldatei sicher auf. Enable Banking kann sie nicht noch einmal herausgeben.

- **Konten im Control Panel verbinden** („Link accounts“): Bank wählen, anmelden, freigeben. Damit wird die Anwendung im eingeschränkten Modus aktiv, für genau diese Konten. Mach das **vor** dem Verbinden in Belege. Ohne diesen Schritt bietet Enable Banking später keine Konten an.

#### 2. Bridge einrichten

```bash
pnpm setup:enablebanking
```

Das Setup fragt nach drei Dingen:

- der Application-ID,
- dem Pfad des privaten Schlüssels (nicht der `.crt`),
- der Redirect-URL.

Dann macht es einen Testaufruf. Der sagt dir:

- ob Enable Banking den Schlüssel annimmt;
- welche Umgebung es ist (Sandbox oder Produktion);
- ob die Anwendung freigeschaltet ist;
- ob die Redirect-URL eingetragen ist.

Den Schlüssel legt das Setup versiegelt in `~/.config/belege/enablebanking.sealed` ab. Versiegelt heißt: verschlüsselt mit AES-256-GCM, lesbar nur für dein Benutzerkonto (Rechte 0600). Den Schlüssel zum Öffnen hält der macOS-Schlüsselbund bzw. die Windows-Anmeldeinformationsverwaltung.

Starte danach die Bridge neu.

#### 3. Bank verbinden

In der App unter _Integrationen → Bank → Über Enable Banking_:

1. Wähle Land und Bank. Bietet die Bank Geschäfts- und Privatkonten an, wählst du auch die Kontoart.
2. Klick auf „Bei der Bank freigeben“.
3. Melde dich bei der Bank an und erlaube den Lesezugriff. Die Freigabe gilt höchstens 180 Tage.
4. Die Bank schickt dich zurück in die App. Entsperre Belege noch einmal. Dann ist die Bank verbunden.

#### 4. Konten freigeben

Leg fest, welche Konten in die Bücher dürfen:

```bash
pnpm setup:enablebanking -- --accounts
```

Das zeigt die verbundenen Konten: Bank, Name und die letzten vier Stellen der IBAN. Dann fragt es nach den IBAN-Endungen, die du freigibst. Das geht wie bei `setup:hibiscus`.

Jedes andere Konto bleibt in der Bridge. So kommt zum Beispiel ein Privatkonto bei derselben Bank nie in die Bücher.

Starte danach die Bridge neu.

#### 5. Abrufen

Klick auf „Umsätze holen“.

- Beim ersten Mal holt Belege die letzten 90 Tage. Danach holt es ab einer Woche vor dem letzten Abruf. Du kannst auch selbst einen Tag wählen.
- Belege holt nur gebuchte Umsätze. Vorgemerkte Umsätze zählt es nur. Sie kommen, sobald die Bank sie bucht.
- Banken erlauben nur wenige Abrufe am Tag, bei denen du nicht dabei bist. Deshalb ruft Belege nur ab, wenn du klickst.

### Ein Konto, egal auf welchem Weg

Belege erkennt ein Konto an einem Hash seiner IBAN, nie an der IBAN selbst.

- **Eine Kontoauszug-Datei hat das Konto schon gebracht:** Dann führt Enable Banking dieses Konto weiter. Der Abruf beginnt am Tag nach der letzten Buchung aus der Datei. So überschneiden sich beide nie.
- **Dasselbe Konto kommt auch über Hibiscus:** Dann käme es doppelt. Die Bank-Seite warnt, wenn ein Hibiscus-Konto auf dieselben vier Stellen endet. Ruf so ein Konto nur auf einem Weg ab.

### Wenn die Freigabe endet

Die Freigabe bei der Bank endet nach höchstens 180 Tagen.

- Zwei Wochen vorher sagt _Braucht dich_ Bescheid. Ist sie abgelaufen, steht dort ein Fehler.
- „Erneuern“ auf der Bank-Seite fragt die Bank erneut. Die neue Freigabe ersetzt die alte. Auch bei Enable Banking wird die alte beendet.
- Konto und Buchungen bleiben, wie sie sind.

„Trennen“ beendet eine Freigabe sofort. Schon geholte Umsätze bleiben in den Büchern.

### Was wo liegt

- **Application-ID, Redirect-URL, freigegebene IBAN-Endungen:** in `~/.config/belege/bridge.json` (Rechte 0600).
- **Privater Schlüssel und Sitzungen, mit den vollen IBANs der Konten:** in `~/.config/belege/enablebanking.sealed` (Rechte 0600, AES-256-GCM). Der Schlüssel dazu liegt im Schlüsselbund bzw. in der Anmeldeinformationsverwaltung.
- **Verbundene Banken, Ende der Freigaben, letzte vier Stellen:** in der App, in ihrem versiegelten Speicher.
- **Umsätze freigegebener Konten:** in den Büchern der App, wie jede andere Buchung.

### Was den Rechner verlässt

- **An Enable Banking:** welche Bank du verbindest, deine Konten dort, die Umsätze freigegebener und abgerufener Konten und die IP-Adresse dieses Rechners. Die Umsätze laufen über die Server von Enable Banking.
- **An deine Bank:** deine Anmeldung und die Freigabe, auf der Seite der Bank. Dein Bank-Passwort sehen weder Belege noch die Bridge.
- **Nie:** Belege, Buchungen aus anderen Quellen oder sonst etwas aus deinen Büchern.

### Wer mit wem spricht

Nur die Bridge spricht mit `api.enablebanking.com`. Jede Anfrage ist mit dem Schlüssel deiner Anwendung signiert. Technisch ist das ein RS256-JWT, ein signierter Ausweis, der zehn Minuten gilt. Der Browser geht nur zur Bank und zurück.

### Der Einmal-Code

Die Bank schickt den Browser mit einem Einmal-Code in der Adresse zurück.

- Diese Adresse läuft auch über das Gateway, das die App ausliefert.
- Die Seite nimmt den Code sofort aus der Adresse.
- Die Bridge nimmt ihn nur für eine Freigabe an, die sie selbst begonnen hat. Sie nimmt ihn nur einmal an und nur binnen 30 Minuten.
- Ohne den Schlüssel deiner Anwendung ist der Code wertlos.

### Wenn etwas nicht klappt

- **„That is the public certificate you gave Enable Banking“:** Gib den privaten Schlüssel an, mit dem das Zertifikat erzeugt wurde. Das ist `private.key`, die `-keyout`-Datei, nicht die `.crt`.
- **„…: there is no file there“:** Gib den Pfad ohne Anführungszeichen an. `~` ist dein Benutzerordner. Ein relativer Pfad beginnt im Ordner `bridge/`.
- **„Enable Banking did not accept the key“:** Prüfe, ob der Schlüssel zum Zertifikat im Panel gehört. Vergleiche dazu die Ausgaben dieser beiden Befehle:
  - `openssl x509 -in public.crt -noout -pubkey | openssl sha256`
  - `openssl pkey -in private.key -pubout | openssl sha256`
- **„not active yet“, oder die Bank zeigt nach dem Verbinden keine Konten:** Verbinde die Konten im Control Panel („Link accounts“). Dann ist die Anwendung eingeschränkt aktiv, für genau diese Konten.
- **„SANDBOX“ in der Antwort des Setups:** Eine Sandbox-Anwendung erreicht nur Testbanken. Leg für deine eigenen Konten eine Produktiv-Anwendung an.
- **„… is not among the application's redirect URLs“:** Trag die URL im Control Panel ein, genau so, wie du sie angegeben hast.
- **„Noch verlässt kein Konto die Bridge“:** Führe `pnpm setup:enablebanking -- --accounts` aus und starte dann die Bridge neu.
- **„Diese Antwort gehört nicht zu der Freigabe …“ oder „… older than 30 minutes“:** Beginne die Freigabe auf der Bank-Seite neu.
- **„allows no more requests for now“:** Das Tageslimit der Bank ist erreicht. Versuch es später noch einmal.
