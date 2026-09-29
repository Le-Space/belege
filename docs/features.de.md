# Funktionen

[English](features.md) · **Deutsch**

Was Le Space Belege heute kann, nach Kategorien. Dieselbe Liste steht kürzer auch im Datenschutz-Hinweis der App (_Was Le Space Belege kann_).

## Datenschutz und Speicherung

- **Passkey statt Passwort.** Jeder Eintrag und jede Belegdatei ist versiegelt (AES-GCM), mit Schlüsseln aus der PRF-Antwort des Passkeys. Kein privater Schlüssel liegt auf dem Gerät.
- **Local-first.** Die Bücher liegen in diesem Browser (OrbitDB und Helia auf IndexedDB). Le Space betreibt keinen Server dafür.
- **Das Netzwerk in deiner Hand.** Das Abzeichen oben zeigt, was online ist. Ein Klick pausiert alles; eigene Geräte und die Rechnungs-App lassen sich einzeln an- und ausschalten ([#180](https://github.com/Le-Space/belege/issues/180)).

## Zahlungen

- **Bankumsätze** aus [Hibiscus](https://github.com/willuhn/hibiscus) über die Bridge (nur freigegebene Konten) und **Kontoauszüge als CAMT.053** (Revolut, GLS, …), im Browser eingelesen.
- **Ein Geschäftsjahr nach dem anderen**, mit Jahresumschalter. Zusammengehörige Buchungen (beide Seiten einer Umbuchung, die Seiten eines Handels, eine Gebühr) sind einen Klick entfernt.
- **Private Zahlungen** vom Geschäftskonto werden markiert, dokumentiert und verrechnet ([#172](https://github.com/Le-Space/belege/issues/172)).

## Belege

- **Von überall:**
  - aus dem Buchhaltungs-Postfach (IMAP, nur lesend), per Upload und aus einem geteilten Ordner;
  - aus Kundenportalen über einen Browser auf dem Rechner der Bridge: Vodafone MeinKabel, und eigene Portale, deren Weg du einmal aufzeichnest;
  - auf Klick aus der Suche im privaten Postfach, direkt von der Buchung aus.
- **Geprüft.**
  - Mails ohne gültiges DKIM/SPF warten auf eine Freigabe, und Anzeichen für Betrug werden genannt.
  - Kopien einer Rechnung werden markiert, und jeder Beleg lässt sich beiseitelegen.
- **Eigenbeleg:** ein selbst erstellter Beleg für eine Zahlung ohne Beleg. Bei Krypto mit Hash, beiden Adressen und Gas, und mit der Transaktion als QR-Code.

## Abgleich

- **Eine Punktzahl** aus Betrag, Rechnungs- und Kundennummer, IBAN, Lieferant und Datum. Sichere Paare werden verknüpft, der Rest wird eine Frage auf der Startseite.
- **Keinen Beleg brauchen:**
  - Umbuchungen zwischen eigenen Konten, erkannt an Gegenbuchung, Referenz oder IBAN – auch Zwillinge, über Chains hinweg (IBC, Bridges, Swaps über Chains) und von Hand verknüpft;
  - Bankgebühren;
  - Erstattungen, gepaart mit ihrer Belastung;
  - Staub;
  - deine eigenen Regeln.
- **Lieferantenkonten** für Guthaben- und Sammelabrechnungen: eine Zeitleiste mit laufendem Saldo, die nennt, was nicht aufgeht.
- **Lernen** aus deinen Verknüpfungen: welche Gegenpartei welcher Lieferant ist und welche Gebühren Gebühren sind.

## KI – nur auf Klick (✦)

- **Fünf Stellen:**
  1. den Text eines Belegs auslesen;
  2. _Mit KI weitersuchen_ im privaten Postfach;
  3. _KI-Vorschlag_ für einen Beleg;
  4. _KI-Vorschlag_ für die Gegenbuchung einer Umbuchung;
  5. _Ungereimtheiten erklären_ in einem Lieferantenkonto.
- **Dein eigenes Modell**, eingerichtet in der Bridge (DeepSeek, Ollama, …). Alles wird vor dem Senden geschwärzt. Le Space betreibt keine KI.
- **Verbrauch im Blick:** Tokens und Kosten je Tag, Woche, Monat und Beleg. Siehe [ai.de.md](ai.de.md).

## Krypto

- **Quellen:** Kraken und eigene Wallets auf Cosmos-Chains (Nym, Akash, samt älterer Akash-Geschichte), EVM-Chains (Ethereum, Base, Arbitrum, OP Mainnet, Polygon; über Blockscout oder Alchemy) und Bitcoin (xpub/ypub/zpub).
- **Jede Buchung in Euro**, mit genauer Menge und dem Tageskurs samt Quelle:
  - CoinGecko, Kraken oder EZB;
  - ein DEX-Pool im Block der Buchung (Uniswap V2, V3 und V4, gegen ETH oder USDC);
  - die andere Seite eines Handels oder die verbrannten alten Token einer Migration;
  - von Hand.
- **Erkannt werden:** DEX-Swaps, Swaps über Chains, Token-Migrationen und Staub; Absender mit ähnlich aussehender Adresse werden benannt.
- **Aleph-Cloud-Guthaben** als Monatsauszug je Konto. Siehe [crypto.de.md](crypto.de.md).

## Buchhaltung und Export

- **Jede Buchung** bekommt ein SKR-03-Konto und einen BU-Schlüssel: vorgeschlagen, von dir bestätigt. Dein eigener Kontenrahmen lässt sich einlesen.
- **Jeden Monat ein ZIP:** ein DATEV-Buchungsstapel (EXTF) für MonkeyOffice, die Belege als PDF und ein Auszug je Konto. Siehe [export.de.md](export.de.md).

## Geräte und Zusammenarbeit

- **Dieselben Bücher auf Telefon und Rechner.** Ein Gerät bekommt sie erst, wenn es den Passkey beweist. Geräte kommen per QR-Code dazu und gehen mit einem Klick wieder.
- **Wo sich Geräte treffen** ([#148](https://github.com/Le-Space/belege/issues/148)):
  - an den öffentlichen Le-Space-Relays;
  - am Relay deiner eigenen Bridge, nur im eigenen Netz (`pnpm setup:relay`, WebRTC-Direct, kein Zertifikat zu installieren);
  - ganz ohne Relay, indem sie zwei QR-Codes tauschen;
  - oder über alle, wobei ein Gerät, das die Bücher noch nicht kennen, nur per QR oder über den Relay der eigenen Bridge hereinkommt.
- **Das Telefon nutzt die Bridge des Rechners.** Belege lässt sich als App installieren (PWA), und die App-Hülle funktioniert offline.
- **Rechnungs-App (UCEP):** Sie erstellt Eigenbelege für Belege und erfährt, welche ihrer Rechnungen bezahlt sind.
- **Eine Lese-Freigabe** der Bücher für eine Assistenz, zeitlich begrenzt.

## Sprache

- **Deutsch und Englisch** ([#192](https://github.com/Le-Space/belege/issues/192)), oben umschaltbar, sofort und offline; beim ersten Besuch gilt die Sprache des Browsers. Beträge, Datumsangaben und Krypto-Mengen folgen der Sprache. Dokumente für die deutsche Buchhaltung bleiben deutsch: der Eigenbeleg, die Kontoauszüge und der DATEV-Export.
