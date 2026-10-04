# Backup bei Aleph Cloud

_English: [backup.md](backup.md)_

Ein Backup enthält alles, was Belege in diesem Browser hält: die acht Datenbanken der Bücher und jede Belegdatei, auch die per Mail gekommenen. Es ist eine Datei, versiegelt mit einem Schlüssel aus deinem Passkey. Aleph Cloud bewahrt sie auf. Öffnen kann sie nur derselbe Passkey, auch Aleph nicht.

## Was du zum Wiederherstellen brauchst

Auf einem leeren Gerät zwei Dinge:

1. **Denselben Passkey.** Der Schlüssel des Backups wird aus dem Passkey abgeleitet, mit dem es gemacht wurde. Ein anderer Passkey öffnet es nicht („mit einem anderen gemacht“).
2. **Die Adresse des Aleph-Kontos, das zahlt**, oder die CID des Backups. Über das Konto findet Belege die Backups: Es fragt Aleph nach den STORE-Nachrichten dieses Kontos im Kanal `BELEGE-BACKUP`. Die Adresse ist öffentlich, aber auf einem leeren Gerät der einzige Weg zu den Backups; schreib sie auf. `pnpm setup:aleph` zeigt sie, und eine gekoppelte Bridge nennt sie von selbst.

## Einmal einrichten

1. Im Terminal, im Ordner von Belege: `pnpm setup:aleph`. Die Bridge erzeugt einen eigenen Backup-Schlüssel und hält ihn im Schlüsselbund. Sie zeigt dessen Adresse an, nie den Schlüssel selbst. Diese Adresse ist das Aleph-Konto, das das Aufbewahren der Backups bezahlt. Es ist nicht deine Wallet.
2. Lade Credits auf diese Adresse (app.aleph.cloud → Credits).
   - Ein Backup wird mit Credits bezahlt. Aleph bewahrt es nur auf, solange das Konto welche hat.
   - Aleph lehnt ein neues Backup ab, wenn die Credits nicht für einen Tag reichen (etwa 54 Credits pro MiB und Tag). Die Seite sagt dann, wie viele es braucht.
   - Abgebucht wird stündlich. Pro Backup werden keine Token bewegt, und ALEPH auf dem Konto bezahlt es nicht.
3. Starte die Bridge neu (`pnpm bridge`) und kopple sie. _Integrationen → Backup_ übernimmt die Adresse des Kontos in die Einstellungen.
4. Gib den Schlüssel dieses Browsers frei. Die Seite zeigt ihn und den Befehl:

   ```sh
   pnpm setup:aleph -- --authorize <Adresse> --channel BELEGE-BACKUP
   ```

   Danach unterschreibt der Browser den Auftrag an Aleph selbst, und die Bridge muss für ein Backup nicht laufen. Bis zur Freigabe unterschreibt die Bridge, wie bisher.

## Sichern

_Integrationen → Backup → „Jetzt sichern“_.

1. Der Browser packt und versiegelt das Backup.
2. Er lädt es direkt zu Alephs IPFS-Host hoch.
3. Aleph wird beauftragt, die Datei aufzubewahren, mit einer STORE-Nachricht für das Konto, bezahlt mit Credits. Diese Nachricht unterschreibt der Schlüssel dieses Browsers, wenn das Konto ihn freigegeben hat, sonst die Bridge mit ihrem Backup-Schlüssel.

Das Backup selbst läuft nie über die Bridge. Die Seite zeigt die CID des Backups; heb sie irgendwo auf.

Der Schlüssel dieses Browsers wird hier erzeugt und versiegelt in den Einstellungen gehalten, wie das Bridge-Token. Er geht mit den Büchern auf eigene Geräte und in jedes Backup. Ein gestohlener Schlüssel könnte nur auf Kosten des Kontos Dateien in diesem einen Kanal aufbewahren lassen. Er öffnet kein Backup, denn die sind mit dem Schlüssel aus dem Passkey versiegelt, und er bewegt keine Guthaben. `pnpm setup:aleph -- --revoke <Adresse>` nimmt die Freigabe zurück.

## Wiederherstellen

_Integrationen → Backup → „Wiederherstellen“_, nach dem Entsperren mit **demselben Passkey**. Auf einem neuen Gerät heißt das: „Mit vorhandenem Passkey wiederherstellen“.

Die Liste zeigt:

- die Backups, die für das Konto aufbewahrt werden, egal ob die Bridge oder ein freigegebener Schlüssel sie geschickt hat. Der Browser fragt Aleph direkt danach, ohne Bridge. Die Adresse kommt aus den Einstellungen oder von der gekoppelten Bridge, oder du trägst sie ein;
- die Backups aus diesem Browser.

Eine CID lässt sich auch eintippen. Nach einer Rückfrage holt der Browser die versiegelte Datei von Alephs Gateway, öffnet sie mit dem Schlüssel aus dem Passkey und spielt alle Datenbanken und Belegdateien zurück. Er **führt zusammen**: Was hier in den Büchern ist, bleibt; was das Backup enthält, kommt dazu; gelöscht wird nichts. Danach lädt die Seite neu, und der Passkey öffnet die Bücher wieder.

Ein Backup eines anderen Passkeys lässt sich nicht öffnen („mit einem anderen gemacht“), und eines mit fremden Büchern wird abgelehnt.

## Einen anderen Schlüssel sichern lassen

Eine Anwendung kann aus dem Browser sichern, ohne dass die Bridge läuft. Sie hat einen eigenen Schlüssel, und das Konto der Bridge erlaubt diesem Schlüssel, auf seine Kosten Backups aufbewahren zu lassen. So macht es Belege selbst (Kanal `BELEGE-BACKUP`, siehe oben), und so macht es Le Space Invoice (Kanal `INVOICE-BACKUP`, Le-Space/invoice#28). Beide zeigen die Adresse ihres Schlüssels und den Befehl.

```sh
pnpm setup:aleph -- --authorize <Adresse> --channel INVOICE-BACKUP   # darf in diesem Kanal sichern
pnpm setup:aleph -- --grants                                         # wer darf
pnpm setup:aleph -- --revoke <Adresse>                               # zurücknehmen
```

Eine Freigabe ist ein Eintrag im `security`-Aggregat des Kontos bei Aleph, unterschrieben mit dem Backup-Schlüssel der Bridge: nur STORE, nur im genannten Kanal. Aleph berechnet dem Konto der Bridge, was dieser Schlüssel aufbewahren lässt, nicht dem Schlüssel (gemessen am 3.10.2026). Die Liste der Backups fragt Aleph nach dem zahlenden Konto; was so ein Schlüssel aufbewahren ließ, steht also mit darin.

## Was hinausgeht

- **An Alephs IPFS-Host, aus dem Browser:** die versiegelte Datei. Aleph sieht ihre Größe und die IP-Adresse dieses Computers, nicht den Inhalt.
- **An die Aleph-API, aus dem Browser:**
  - die STORE-Nachricht mit der Adresse des Schlüssels dieses Browsers, der Adresse des Kontos und der CID der Datei;
  - Abfragen der Freigabe und der Credits des Kontos und der Liste seiner Backups, mit seiner Adresse.
- **An die Aleph-API, von der Bridge:**
  - ohne Freigabe die STORE-Nachricht mit der Adresse ihres Backup-Schlüssels und der CID der Datei;
  - bei `--authorize` und `--revoke` die Liste der Schlüssel, die das Konto erlaubt.

## Technisch

- **Inhalt:** jeder Block genau so, wie er gespeichert ist. Eine Wiederherstellung bringt also dieselben CIDs, dieselben signierten Einträge und denselben Schreiber zurück:
  - die Log-Einträge jeder Datenbank (schon mit dem Datenbankschlüssel versiegelt), ihr Manifest und ihr Access-Controller sowie die Identität jedes Schreibers;
  - Wurzel und 1-MiB-Stücke jeder Belegdatei (schon mit dem Blob-Schlüssel versiegelt);
  - ein dag-cbor-Manifest: die Metadaten der Storage-Bridge (jede Datenbank mit Adresse, Manifest und Heads, aus `bundleDatabases`), die Belegdateien, die App-Version und das Datum.
- **Wiederherstellen:**
  - `restoreFromBlocks` der Storage-Bridge spielt die Datenbanken aus dem geöffneten Backup zurück.
  - Lässt sich ein Head nicht einhängen, bricht die Wiederherstellung mit dem Grund ab, statt Erfolg zu melden.
- **Einträge früherer Sitzungen:**
  - OrbitDB 4.0.0 merkt sich verifizierte Identitäten nach `signatures.id` und lehnt eine abweichende mit derselben ID ab.
  - Eine Passkey-Identität hat in jeder Sitzung dieselbe `signatures.id`, aber eine neue WebAuthn-Zusicherung. Einträge einer früheren Sitzung (aus einem Backup oder per Sync von einem eigenen Gerät) wurden deshalb abgelehnt.
  - Belege prüft so eine Identität noch einmal so, wie OrbitDB eine ungespeicherte prüft (Form, ID-Signatur, Passkey-Bindung im Provider), nur ohne den Vergleich ([orbitdb/orbitdb#1258](https://github.com/orbitdb/orbitdb/issues/1258); `session-identities.js`).
- **Format:** eine CAR-Datei, geschrieben von `@le-space/orbitdb-storage-bridge`, als Ganzes versiegelt mit AES-256-GCM. Der Schlüssel wird mit HKDF aus dem PRF-Ergebnis des Passkeys abgeleitet (`belege/backup-key/v1`). Die Datei ist `belegeB1 ‖ Nonce ‖ Chiffretext`.
- **Upload:** das `aleph`-Backend der Storage-Bridge, `POST https://ipfs.aleph.cloud/api/v0/add`, ohne Schlüssel.
- **Aufbewahren:**
  - Eine STORE-Nachricht im Kanal `BELEGE-BACKUP`, unterschrieben mit `personal_sign`. `content.address` ist das zahlende Konto, bezahlt wird mit Credits (`payment: { type: "credit" }`, Storage-Bridge 0.17.0). Ohne dieses Feld bucht Aleph sie als `hold`, und das deckt nur ALEPH auf dem Konto.
  - Mit Freigabe schickt sie der Browser selbst (`backup/keeper.js`), mit seinem secp256k1-Schlüssel aus den versiegelten Einstellungen (`backup/aleph-key`). Er verfolgt eine Antwort `pending`, bis Aleph entschieden hat; eine Ablehnung nennt die vorhandenen und die für einen Tag nötigen Credits.
  - Ohne Freigabe schickt sie die Bridge (`POST /backup/aleph/pin`, [bridge/README.md](../bridge/README.md)). Eine Ablehnung kommt dort als HTTP 402 `ALEPH_BACKUP_REJECTED` zurück.
- **Liste:** Der Browser fragt die Nachrichten-API von Aleph mit `owners=` (das zahlende Konto) statt `addresses=` (der Absender). STORE-Nachrichten, die ein anderer Schlüssel für das Konto geschickt hat, sind also dabei. Die gekoppelte Bridge nennt dem Browser das Konto und, in Tests, die Adressen von Aleph (`GET /backup/status`).
- **Fehlende Blöcke:** Für ein Backup wird nichts aus dem Netz geholt. Ein Block, den dieser Browser nicht hat, zählt als fehlend, und die Seite sagt es.
