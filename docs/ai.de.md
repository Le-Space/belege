# Wo Belege KI einsetzt

_English: [ai.md](ai.md)_

**Le Space betreibt keine KI und sieht keine deiner Daten.** Belege hat keinen Server. Die Bridge ist ein kleines Programm auf deinem eigenen Rechner. Sie fragt das Sprachmodell, das **du** einstellst (`pnpm setup:llm`). Ein Sprachmodell ist die KI, die Texte liest und beantwortet. Du hast zwei Arten zur Wahl:

- ein öffentliches Modell im Internet, wie DeepSeek (voreingestellt);
- ein lokales Modell auf deinem eigenen Rechner, etwa mit Ollama oder LM Studio.

Jedes Modell mit einer Schnittstelle im OpenAI-Format (`/chat/completions`) geht. Die Verbindung läuft über https. Unverschlüsseltes http ist nur auf diesem Rechner erlaubt (`127.0.0.1`, `localhost` oder `[::1]`).

Ohne eingestelltes Modell läuft keiner der Schritte unten. Alles andere funktioniert weiter.

In der App trägt jeder Knopf, der das Modell fragt, das Zeichen **✦**. Fährst du mit der Maus darüber, steht da, was hinausgeht (`app/src/lib/AiMark.svelte`). Die Einwilligungsseite nennt dasselbe: einfach, und mit dem Schalter _Technisch_ im Detail.

## Welches Modell, derzeit

**Unser Rat heute: ein lokales Modell** (Ollama, LM Studio). Oder LibertAI vertraulich: Dort läuft das Modell in einer geprüften, abgeschotteten Umgebung (siehe unten). Belege fragt ein solches Modell nur bei Bedarf, wie bisher auf einen ✦-Klick.

### Lokal

Nichts verlässt deinen Rechner.

- Ein kleines Modell (8B, also 8 Milliarden Parameter) liest einfache Belege.
- Öfter schief gehen: mehrere Steuersätze, Reverse Charge, lange Texte und Belege in anderen Sprachen und Schriften (Russisch, Arabisch …). Die Prüfungen der Bridge fangen einen Teil davon ab.
- Die Anweisung an das Modell verlangt Belege in jeder Sprache (#366). Wie gut eine Sprache gelesen wird, hängt am Modell.

**Schritt für Schritt einrichten,** mit Download, Einstellungen und gemessener Geschwindigkeit: [ollama.de.md](ollama.de.md). Kurz gesagt: Auf einem Intel-Mac las `qwen3:30b-a3b-instruct-2507-q4_K_M` unsere erfundenen Belege richtig. Es brauchte etwa zwei Minuten pro Beleg. Auf ein Modell auf diesem Rechner wartet die Bridge bis zu 10 Minuten, auf eines anderswo bis zu 3 Minuten.

### Gehostet, ohne TEE (DeepSeek, voreingestellt)

Der Anbieter kann lesen, was die Bridge schickt. Die Schwärzung begrenzt das. Anonym macht sie einen Beleg aber nicht (siehe [Schwärzung](#schwärzung) unten).

### Gehostet, im TEE: LibertAI vertraulich (#416)

Ein TEE (Trusted Execution Environment) ist ein abgeschotteter Bereich im Rechner des Anbieters. Man nennt ihn auch Enklave. Nicht einmal der Anbieter kann hineinsehen. Die Enklave kann belegen, welches Programm in ihr läuft. Diesen Nachweis nennt man Attestierung.

Die Bridge prüft das selbst. `pnpm setup:llm`, Wahl 2, macht Folgendes:

1. Es sucht die Enklave in LibertAIs signiertem Verzeichnis (Manifest).
2. Es prüft die Signaturkette von AMD.
3. Es prüft, dass der Bericht der Enklave den TLS-Schlüssel bindet, den sie ausliefert.
4. Es prüft die Start-Messung, also den Fingerabdruck des gestarteten Abbilds.
5. Es prüft, dass niemand den Gast debuggen, also von außen hineinschauen kann.
6. Es zeigt dir Deployment, Messung und Quellstand.
7. Sagst du Ja, nagelt es diese Werte fest.

Danach geht jede Anfrage an genau diese Enklave. Die verschlüsselte TLS-Verbindung endet erst in ihr (`@libertai/confidential-inference`). Anfragen gehen nie über `api.libertai.io`. Jede neue Verbindung wird wieder geprüft.

Ersetzt LibertAI das Deployment, folgt die Bridge nicht von selbst. Anfragen schlagen dann mit `LLM_ATTESTATION_FAILED` fehl. Das bleibt so, bis du mit `setup:llm` das neue Deployment prüfst und auf ein Ja festnagelst. Die KI-Karte in der App zeigt die Festlegung und die letzte Prüfung.

**Modell:** `qwen3.8-27b-tee`. Es ist das einzige, das LibertAI für attestierte Nutzung veröffentlicht (geprüft am 23.10.2026). Den API-Schlüssel bekommst du auf console.libertai.io. Dort meldest du dich mit einer Wallet wie MetaMask oder per E-Mail an. Der Schlüssel kommt in den Schlüsselbund der Bridge. Ohne ihn antwortet die Enklave mit 401. Bezahlen pro Anfrage gibt es in der Enklave nicht.

**Was die Prüfung beweist und was nicht:**

- Sie beweist, welches Abbild läuft. Sie beweist nicht, was es tut. Dafür müsstest du es selbst neu bauen (`Libertai/confidential-inference`, VERIFYING.md).
- LibertAI sieht weiter die IP-Adresse dieses Macs, die Größe der Anfragen und ihre Zeiten.
- LibertAI kann den Dienst verweigern.
- Vertrauliche GPUs auf Aleph haben noch kein unabhängiges Audit.

**Voreingestellt ohne Schwärzung.** Zwischen diesem Mac und der attestierten Enklave kann niemand den Text lesen. `setup:llm` fragt deshalb, ob trotzdem geschwärzt werden soll, und schlägt Nein vor. Das Modell liest Namen und Adressen dann so, wie sie sind, wie ein lokales Modell. Antwortest du mit Ja, bleibt die Schwärzung wie bei jedem gehosteten Anbieter.

**Gemessen am 23.10.2026** an sechs erfundenen Belegen: deutsche und britische Rechnung, Bewirtungsbeleg, russische Bahnfahrkarte, französisches Hotel, Flugticket. Gemessen wurde mit Belegs eigener Anfrage.

- **5,8 s pro Beleg**, alle sechs richtig gelesen.
- Rund 1.400 Tokens hinein und 370 heraus. Ein Token ist ein Wortstück, nach dem der Anbieter abrechnet. Das sind etwa 0,04 Cent pro Beleg.
- Das gilt mit abgeschaltetem „Denken“ des Modells. So macht es die Bridge im TEE-Modus.
- Mit „Denken“ dauerte es 38 s und bis zu 6.000 Tokens, und zwei von sechs Belegen wurden nicht gelesen.
- Mit DeepSeek noch nicht verglichen.

## Mit KI

An diesen Stellen fragt Belege das Modell. Jede Stelle nennt, was sie auslöst, was an das Modell geht und was zurückkommt.

### Beleg auslesen

**Ausgelöst durch:**

- _Auslesen_, _Erneut auslesen_, _Alle neuen auslesen_ und _Belege der Reise neu auslesen_ (#693);
- _E-Mails abrufen_: neue Belege werden gleich danach gelesen, das lässt sich abschalten;
- Hochladen auf der Seite _Belege_ und neue Dateien im freigegebenen Ordner, solange „gleich auslesen“ an ist;
- _Beleg hochladen und dieser Zahlung zuordnen_;
- _Als Beleg übernehmen_;
- einen Treffer übernehmen bei _Beleg finden → Paperless_;
- _Rechnungen holen_.

**Was an das Modell geht:** der Text des Belegs, **geschwärzt**. Das ist die Textebene eines PDFs oder der Text der E-Mail. Bei einem Scan oder Foto aus Paperless-ngx ist es der Text, den Paperless erkannt hat. Dazu kommen als Hinweis Betreff, Absender, Dateiname und Eingangstag. Die Datei selbst geht nie hinaus.

**Was zurückkommt:**

- Anbieter, USt-IdNr., Rechnungs- und Kundennummer, Daten;
- Netto, USt und Brutto, Zahlweg;
- bei Reisen: Art, Strecke, Länder, Flughafencodes, Zeiten, Hotelnächte, Frühstück inklusive;
- oder `document_type: "none"` für eine E-Mail, die kein Beleg ist, zum Beispiel ein Anmelde-Link oder ein Newsletter.

Eine E-Rechnung (XRechnung, ZUGFeRD, Factur-X) braucht kein Modell. Belege liest ihr XML direkt im Browser (siehe [Ohne KI](#ohne-ki-feste-regeln)). Eine Mail, deren Absender die Prüfung nicht bestanden hat, liest die Bridge erst aus, wenn du den Absender bestätigt hast.

Der Code: `bridge/src/llm/extract.js`.

### „Mit KI weitersuchen“ im privaten Postfach

**Ausgelöst durch:** den Knopf. Er erscheint nur, wenn die normale Suche keinen klaren Treffer fand.

**Was an das Modell geht,** in zwei Schritten, jeweils geschwärzt:

1. Gegenpartei und Verwendungszweck der Buchung.
2. Für jeden Treffer, höchstens 15: Betreff, Absender-**Domain**, Namen der Anhänge und Eingangstag.

**Kein E-Mail-Text und keine vollständige Adresse.**

**Was zurückkommt:**

1. bis zu 4 Suchwörter und 3 Absender-Domains;
2. welcher Treffer der Beleg ist, wie sicher, und warum, in wenigen Worten.

Der Code: `bridge/src/llm/assist.js`, `POST /mail/assist`.

### „KI-Vorschlag“ unter „Beleg zuordnen“

**Ausgelöst durch:**

- den Knopf in der Liste der Belege zur Auswahl;
- _✦ KI-Vorschläge für alle offenen Rückfragen_ auf der Seite _Rückfragen_. Vorher fragt Belege nach, mit der Zahl der Anfragen und den Tokens der letzten Vorschläge. Je offene Rückfrage zu einem fehlenden Beleg geht eine Anfrage hinaus.

**Was an das Modell geht,** geschwärzt:

- Gegenpartei, Verwendungszweck, Betrag und Tag der Buchung;
- bis zu 25 Belege, die nach Betrag und Datum am nächsten liegen. Von jedem die ausgelesenen Felder: Anbieter, Betrag, Währung, Datum, Rechnungsnummer, Kurzbeschreibung.

**Was zurückkommt:** welcher Beleg passt, wie sicher, und warum, in wenigen Worten. Zuordnen tust du mit deinem Klick.

Der Code: `bridge/src/llm/match-assist.js`, `POST /match/assist`.

### „KI-Vorschlag“ unter „Als Gegenbuchung verknüpfen …“

**Ausgelöst durch:** den Knopf über der Liste möglicher Gegenseiten. Es geht um eine eigene Umbuchung in einer Zahlung, also Geld zwischen zwei deiner eigenen Konten.

**Was an das Modell geht:** die Buchung und bis zu 8 Kandidaten auf anderen Konten. Von jeder:

- Richtung, Euro-Betrag, Krypto-Menge und Asset, Tag;
- Kontoart: Bank, Börse oder Wallet mit Chain;
- Gegenpartei und Zweck.

Alles ist geschwärzt. Adressen, IBANs und Transaktions-Hashes schneidet die Bridge heraus.

**Was zurückkommt:** welche Buchung die andere Seite ist oder ob keine passt, wie sicher, und warum. Verknüpfen tust du mit deinem Klick.

Der Code: `bridge/src/llm/transfer-assist.js`, `POST /transfer/assist`.

### „Ungereimtheiten erklären“ im Lieferantenkonto

**Ausgelöst durch:** den Knopf auf der Seite eines Lieferantenkontos.

**Was an das Modell geht:** die Zeitleiste des Lieferanten. Das sind Daten, Beträge, Abrechnungszeiträume, Positionen, der laufende Saldo und die Befunde der festen Regeln. Alles ist geschwärzt. Rufnummern, Kunden- und Rechnungsnummern gehen nicht mit.

**Was zurückkommt:** höchstens sechs Hinweise, was nicht aufgeht und was du prüfen solltest. Gebucht wird nichts.

Der Code: `bridge/src/llm/vendor-assist.js`, `POST /vendor/assist`.

### „Reise prüfen“ auf einer Reise

**Ausgelöst durch:** den Knopf auf der Seite einer Reise (#693 d). Es gibt ihn nur, wenn das Modell auf dem Rechner der Bridge oder in einer attestierten Enklave läuft und nicht geschwärzt wird. Sonst lehnt die Bridge ab.

**Was an das Modell geht:** Zeiten, Ziel, Heimatland, Grenzübertritte und als Pauschale angehakte Nächte der Reise, ihre Fahrten (Art, von, nach, Zeiten), die ausgelesenen Felder ihrer Belege (Art, Anbieter, Tag, Ort, An- und Abreise, von, nach) und die offenen Rückfragen der Regeln. Das geht **ungeschwärzt** hin, denn eine ganze Reise ist ein Bewegungsprofil, das Schwärzen nicht verbirgt. Beträge, Nummern, Grund und Notiz gehen nicht mit.

**Was zurückkommt:** höchstens sechs Hinweise, was nicht passt oder fehlt, jeder mit den Fahrten oder Belegen, die er meint. Ein Name, der nicht gesendet wurde, fällt weg. Geändert, zugeordnet oder gebucht wird nichts.

Der Code: `bridge/src/llm/travel-assist.js`, `POST /travel/assist`.

### „Konto vorschlagen“ unter „Konto“ einer Zahlung

**Ausgelöst durch:** den Knopf unter „Konto“ einer Zahlung, nur wenn eine Bridge gekoppelt ist.

**Was an das Modell geht:** die Zahlung (Richtung, Betrag, Tag, eigenes Konto, Gegenpartei, Verwendungszweck), ihr Beleg, falls einer zugeordnet ist (Aussteller, Art, Steuersätze, bis zu 20 Positionen), die Konten, die Belege für Lieferanten schon gelernt hat (Lieferant → Konto), und die Kontenliste aus dem Feld „Konto“: dein eingelesener Kontenplan oder sonst die SKR-03-Liste, bis zu 600 Konten. Geschwärzt wird wie bei jedem Aufruf. Nur wenn das Modell auf deinem Rechner oder in einer bestätigten Enklave (TEE) läuft und du `setup:llm` gesagt hast, nicht zu schwärzen, geht der Text ungeschwärzt.

**Was zurückkommt:** bis zu zwei Konten aus der gesendeten Liste, wie sicher und warum. Ein Konto, das nicht in der Liste stand, verwirft die Bridge. „Einsetzen“ trägt es ins Feld ein; übernommen wird es erst mit „Übernehmen“, und erst dann lernt Belege den Lieferanten.

Der Code: `bridge/src/llm/booking-assist.js`, `POST /booking/assist`.

### Die Sammelläufe

Zwei Knöpfe arbeiten viele Einträge nacheinander ab: _Alle neuen auslesen_ und _✦ KI-Vorschläge für alle offenen Rückfragen_. Beide laufen in der App über eine gemeinsame Warteschlange, nicht auf der Seite selbst.

- **Sie laufen weiter,** wenn du eine andere Seite öffnest. Ein Reiter zeigt, wie weit sie sind: _Belege_ beim Auslesen (zum Beispiel `38/90`), _Home_ bei den Vorschlägen.
- **Ein zweiter Start** wartet, bis der laufende fertig ist.
- **_Abbrechen_** hält den Lauf an, sobald die laufenden Anfragen fertig sind.
- **Gleichzeitige Anfragen:** Ein Lauf schickt standardmäßig 2 Anfragen gleichzeitig. 1 bis 4 stellst du unter _Statistik → Gleichzeitige KI-Anfragen je Lauf_ ein.
- **Wenn der Anbieter bremst:** Manchmal begrenzt der Anbieter die Zahl der Anfragen. Taten das alle Modelle, antwortet die Bridge mit HTTP 429 `LLM_RATE_LIMIT`. Der Eintrag kommt dann zurück in die Warteschlange, und der Lauf macht eine Pause. Sie dauert erst 2 s und dann jeweils doppelt so lange, bis höchstens 30 s. Der Eintrag zählt dabei nicht als fehlgeschlagen. Erst nach sechs solchen Versuchen zählt er als fehlgeschlagen.
- **Sperren oder Neuladen:** Sperrst du die Bücher oder lädst du die Seite neu, hält der Lauf an. Was er noch nicht erledigt hatte, bleibt versiegelt in den Einstellungen gespeichert (`pendingJobs`). Nach dem nächsten Entsperren fragt _Home_: „Weitermachen?“. Von selbst startet nichts.
- **Deine Änderungen bleiben:** Jedes Auslesen schreibt auf den Beleg, wie er in dem Moment ist. Was du zwischendurch geändert hast, bleibt. Ein zwischendurch gelöschter Beleg bleibt gelöscht.

Der Code: `jobs/queue.js`, `receipts/extract-queue.svelte.js`, `matching/ai-suggest.svelte.js` (alle unter `app/src/lib/`).

### Schwärzung

Schwärzen heißt: Die Bridge ersetzt vertrauliche Angaben durch Platzhalter wie `[NAME]`, bevor Text hinausgeht. Das macht sie vor jedem Aufruf (`bridge/src/llm/redact.js`). Geschwärzt werden:

- die Namen auf ihrer eigenen Liste (die stellst du mit `pnpm setup:llm` ein);
- die Firmennamen aus den Einstellungen der App. Die App schickt sie mit dem Aufruf mit, sie werden zu `[FIRMA]`;
- Namen nach einer Anrede oder einem Etikett wie „Reisende:“. Das gilt auch auf Russisch, Ukrainisch, Polnisch, Tschechisch, Türkisch, Arabisch, Spanisch, Italienisch und Französisch, für Namen in jeder Schrift und für den `NACHNAME/VORNAME` einer Airline;
- Pass- und Ausweisnummern hinter ihrem Etikett;
- IBANs und Kartennummern, bis auf die letzten vier Stellen;
- E-Mail-Adressen. Bei fremden Adressen bleibt die Domain stehen;
- Telefonnummern;
- Geburtsdaten, Steuer-IDs und Steuernummern;
- Straßen, Postleitzahlen mit Ort;
- Links. Von ihnen bleibt nur der Host, also der Name der Website.

**Das begrenzt, was hinausgeht. Anonym macht es einen Text nicht.** Ein Name, der auf keiner Liste und hinter keinem Etikett steht, geht durch. Manches bleibt mit Absicht stehen, weil Auslesen und Zuordnen es brauchen: Anbieter, Beträge, Daten, Rechnungs- und Kundennummern und worum es im Beleg geht.

Ein Test hält erfundene Dokumente fest. Er sagt, was verborgen sein muss, was bleiben muss und welche Lücken bekannt sind. Die Zahlen darin ändern sich nur mit Begründung (`bridge/test/redact-scorecard.test.js`).

Soll gar nichts den Rechner verlassen, stell ein lokales Modell ein (Ollama, LM Studio).

**Keine Schwärzung für ein Modell auf diesem Rechner** ([#423](https://github.com/Le-Space/belege/issues/423)). Dann verlässt nichts den Rechner. Die Schwärzung würde nur das Auslesen verschlechtern: Das Modell sähe `[NAME]` und `[IBAN …1234]` statt dessen, was auf dem Beleg steht.

Das entscheidet die Einstellung `llm.redaction` in `bridge.json`:

- `pnpm setup:llm` fragt bei einer Adresse auf diesem Rechner (`127.0.0.1`, `localhost`, `[::1]`) nach, ob das Modell wirklich dort läuft. Denn ein Proxy auf 127.0.0.1 kann an einen Anbieter im Internet weiterleiten.
- Sagst du Ja, speichert es `off`: Es wird nicht geschwärzt. Sagst du Nein, speichert es `on`.
- `off` gilt nur für eine Adresse auf diesem Rechner oder für eine festgenagelte Enklave. Bei jeder anderen Adresse wird trotzdem geschwärzt.
- `auto` ist der Wert, solange `setup:llm` noch nicht gefragt hat, etwa bei einer Einstellung von vor #423. Dann wird geschwärzt, auch auf diesem Rechner.

Was gerade gilt, zeigt _Integrationen → KI – Beleg-Auslesen_.

**Die Antworten werden geprüft.** Sie kommen als JSON, einem festen Datenformat. Die Bridge prüft zum Beispiel: Netto plus USt ergibt Brutto, Daten sind echte Daten, ein Vorschlag ist einer der Kandidaten. Passt eine Antwort nicht, fragt die Bridge einmal das zweite Modell, falls eins eingestellt ist. Sonst wird die Antwort verworfen.

**Du siehst, was gesendet wurde.** Beim Beleg steht es unter _An die KI gesendet_, bei der Suche unter _Was an das Sprachmodell ging_. Der Verlauf nennt Modell, Dauer und Tokens jedes Aufrufs. Das Protokoll der Bridge enthält nur Zahlen.

### Wenn der Anbieter ablehnt

Manchmal scheitert nicht das Modell an einem Text, sondern der Anbieter lehnt ab. Die Bridge meldet das mit eigenem Code:

- **Guthaben aufgebraucht** (HTTP 402): `LLM_NO_CREDIT`;
- **API-Schlüssel nicht angenommen:** `LLM_AUTH`;
- **Modell unbekannt:** `LLM_MODEL`;
- **gar keine Antwort,** zum Beispiel ein lokales Ollama, das nicht läuft: `LLM_UNREACHABLE`.

In ihr Log schreibt die Bridge die Modelle und den Status der Versuche, nie den Text ([#417](https://github.com/Le-Space/belege/issues/417)).

Die App **hält den Lauf dann an** („Alle neuen auslesen“, die KI-Vorschläge):

- Kein weiterer Beleg und keine weitere Rückfrage geht hinaus.
- Keiner gilt als gescheitert.
- Die Meldung sagt, was zu tun ist: Guthaben aufladen, `pnpm setup:llm` ausführen oder den Dienst starten.
- Der Rest wartet auf _Home_ unter „Weitermachen“.

`GET /llm/status` merkt sich die letzte Ablehnung und wann sie war.

## Ohne KI (feste Regeln)

Vieles erledigt Belege ohne Sprachmodell, mit festen Regeln im Browser oder in der Bridge:

- **Zuordnen** von Belegen zu Buchungen. Belege vergibt Punkte für Betrag (auch in fremder Währung, zum EZB-Kurs), Rechnungs- und Kundennummer, IBAN, Anbieternamen, gelernten Anbieter und Datum. _Warum diese Zuordnung?_ begründet jede Zuordnung (`app/src/lib/matching/score.js`).
- **E-Rechnungen** (XRechnung, ZUGFeRD, Factur-X): Belege liest ihr XML direkt, ohne Bridge und ohne Modell (#160).
- **Rückfragen**, die Karenzzeit und die **Sortierung der Postfach-Treffer** (`hitScore` in `app/src/lib/matching/view.js`).
- **Umbuchungen, Bankgebühren, Darlehen** und deine eigenen Regeln (`app/src/lib/matching/classify.js`).
- **Dazulernen,** welche Gegenpartei welcher Anbieter ist. Das lernt Belege aus deinen Zuordnungen (`app/src/lib/matching/partners.js`).
- **Scam-Zeichen** an einer Beleg-Mail, siehe unten.
- **Reisen nach Stichworten,** siehe unten.
- **Kundenportale:** Anmelden, Aufzeichnen und Abspielen der Rezepte (`bridge/src/portals/`). Keine Bildschirmfotos und kein Seiteninhalt gehen an ein Modell.

### Scam-Zeichen

Belege prüft eine Beleg-Mail auf Zeichen von Betrug. Das Ergebnis ist ein Hinweis und nie ein Urteil (`app/src/lib/receipts/scam.js`).

**Starke Zeichen:**

- Die Absenderprüfung (SPF/DKIM/DMARC) ist fehlgeschlagen, und du hast den Absender nicht freigegeben.
- Die Absender-Domain ahmt die eines gelernten Anbieters nach: ein, zwei Zeichen anders, verwechselbare Zeichen oder eine andere Endung.
- Ein gelernter Anbieter schreibt von einer anderen Domain.
- Die Rechnung nennt eine IBAN, auf die an diesen Anbieter nie gezahlt wurde. Eigene Konten zählen nicht, denn eine Lastschrift nennt sie.

**Schwache Zeichen:**

- eine Rechnung von einer Freemail-Adresse;
- drängende Worte;
- Links zu anderen Hosts.

Ein starkes oder zwei schwache Zeichen ergeben _Verdacht_. Der Beleg wird dann nicht nach Punkten zugeordnet, sondern zur Rückfrage. Das bleibt so, bis du ihn zuordnest oder _Ist in Ordnung_ sagst.

Als bekannt gelten nur die Domains gelernter Anbieter. Denn auch die nachgemachte Domain eines Betrügers besteht SPF.

### Reisen nach Stichworten

Belege erkennt Reisekosten auch ohne Modell, an typischen Wörtern (`app/src/lib/travel/words.js`, #366). Das sind Wörter, die auf Tickets, Bordkarten, Hotel- und Restaurantrechnungen stehen. Belege kennt sie auf Deutsch, Englisch, Russisch, Ukrainisch, Polnisch, Tschechisch, Türkisch, Arabisch, Spanisch, Italienisch und Französisch.

- **Wo gesucht wird:** im Dateinamen, Betreff, Absender und Auszug eines Belegs. Dazu in der Textebene eines PDFs, das kein Modell gelesen hat.
- **Wie:** Diesen Text liest der Browser einmal, wenn du den Beleg öffnest. Behalten werden nur die Art und die gefundenen Wörter (`travelGuess`).
- **Was dabei herauskommt:** eine Art, zum Beispiel Bahn, Flug oder Hotel. Sie steht als Hinweis am Beleg. Sie wird nie zur Rückfrage oder Zuordnung. Strecke, Zeiten oder Beträge ergibt sie nicht.

### Das letzte Wort hast du

Ein KI-Ergebnis ist nie das letzte Wort. Ausgelesene Werte stehen zusammen mit dem Modell am Beleg. Einen KI-Vorschlag übernimmt Belege erst auf deinen Klick.

### Was die KI verbraucht und gekostet hat

Die Karte _Speicher und KI_ (auf der Startseite und unter `/statistik`) zählt die Tokens jedes KI-Aufrufs im Verlauf:

- heute, in den letzten 7 Tagen und in diesem Monat;
- nach Zweck;
- je ausgelesenem Beleg.

Die Preise dazu stehen in einer Tabelle in den Einstellungen (`aiPrices`). Du kannst sie dort ändern. Voreingestellt sind die veröffentlichten DeepSeek-Preise vom 27. September 2026:

- je Million Tokens;
- getrennt nach Eingabe, Eingabe aus dem Cache des Anbieters und Ausgabe;
- in der Nebenzeit zum halben Preis. Nebenzeit ist an Werktagen außerhalb von 01–04 und 06–10 Uhr UTC, und am ganzen Wochenende.

Chinesische Feiertage sind ebenfalls Nebenzeit. Belege kennt sie nicht. Die Zahl ist deshalb eine Schätzung.

Modell und Tokens jedes Aufrufs stehen am Ereignis im Verlauf (`calls`). Ältere Ereignisse haben nur eine Summe und zählen als geschätzt.

Dieselbe Seite zeigt, wie viel dieser Browser speichert: Belegdateien und den Rest. Dort kannst du auch dauerhafte Speicherung beim Browser beantragen.

## Rechtliches

Die EU-KI-Verordnung verlangt Transparenz vor allem in zwei Fällen: bei KI, die mit Menschen spricht oder Inhalte erzeugt, und bei Hochrisiko-Anwendungen. Das Auslesen von Belegen für die eigene Buchhaltung gehört nach unserer Einschätzung nicht dazu. Wir legen es trotzdem offen. Nach der DSGVO musst du ohnehin wissen, wohin Daten gehen. Das ist keine Rechtsberatung.
