# Backup bei Aleph Cloud

_English: [backup.md](backup.md)_

Ein Backup enthält alles, was Belege in diesem Browser hält: die acht Datenbanken der Bücher und jede Belegdatei, auch die per Mail gekommenen. Es ist eine Datei, versiegelt mit einem Schlüssel aus deinem Passkey. Aleph Cloud bewahrt sie auf, und ohne deinen Passkey kann sie niemand öffnen, auch Aleph nicht.

## Einmal einrichten

1. Im Terminal, im Ordner von Belege: `pnpm setup:aleph`. Die Bridge erzeugt einen eigenen Backup-Schlüssel und hält ihn im Schlüsselbund. Sie zeigt dessen Adresse an, nie den Schlüssel selbst. Diese Adresse ist das Aleph-Konto, das das Aufbewahren der Backups bezahlt. Es ist nicht deine Wallet.
2. Lade Credits auf diese Adresse (app.aleph.cloud → Credits) oder schick ALEPH an sie. Aleph bewahrt ein Backup nur auf, solange das Konto zahlen kann. Pro Backup werden keine Token bewegt: Aleph prüft nur, ob das Konto zahlen kann.
3. Starte die Bridge neu (`pnpm bridge`).

## Sichern

_Integrationen → Backup → „Jetzt sichern“_. Der Browser packt und versiegelt das Backup, lädt es direkt zu Alephs IPFS-Host hoch und bittet die Bridge, Aleph mit dem Aufbewahren zu beauftragen. Die Bridge unterschreibt diesen Auftrag (eine STORE-Nachricht) mit ihrem Backup-Schlüssel. Das Backup selbst läuft nie über die Bridge.

Die Seite zeigt die CID des Backups; heb sie irgendwo auf.

## Wiederherstellen

_Integrationen → Backup → „Wiederherstellen“_, nach dem Entsperren mit **demselben Passkey** (auf einem neuen Gerät „Passkey wiederherstellen“). Die Liste zeigt:

- die Backups, die das Aleph-Konto der Bridge aufbewahren ließ (Bridge neu koppeln: Ein leerer Browser hat keine Kopplung);
- die Backups aus diesem Browser.

Eine CID lässt sich auch eintippen. Nach einer Rückfrage holt der Browser die versiegelte Datei von Alephs Gateway, öffnet sie mit dem Schlüssel aus dem Passkey und spielt alle Datenbanken und Belegdateien zurück. Er **führt zusammen**: Was hier in den Büchern ist, bleibt; was das Backup enthält, kommt dazu; gelöscht wird nichts. Danach lädt die Seite neu, und der Passkey öffnet die Bücher wieder.

Ein Backup eines anderen Passkeys lässt sich nicht öffnen („mit einem anderen gemacht“), und eines mit fremden Büchern wird abgelehnt.

## Was hinausgeht

- **An Alephs IPFS-Host, aus dem Browser:** die versiegelte Datei. Aleph sieht ihre Größe und die IP-Adresse dieses Computers, nicht den Inhalt.
- **An die Aleph-API, von der Bridge:** die STORE-Nachricht mit der Adresse des Backup-Schlüssels und der CID der Datei.

## Technisch

- **Inhalt:** jeder Block genau so, wie er gespeichert ist. Eine Wiederherstellung bringt also dieselben CIDs, dieselben signierten Einträge und denselben Schreiber zurück:
  - die Log-Einträge jeder Datenbank (schon mit dem Datenbankschlüssel versiegelt), ihr Manifest und ihr Access-Controller sowie die Identität jedes Schreibers;
  - Wurzel und 1-MiB-Stücke jeder Belegdatei (schon mit dem Blob-Schlüssel versiegelt);
  - ein dag-cbor-Manifest: die Metadaten der Storage-Bridge (jede Datenbank mit Adresse, Manifest und Heads, aus `bundleDatabases`), die Belegdateien, die App-Version und das Datum.
- **Wiederherstellen:** `restoreFromBlocks` der Storage-Bridge spielt die Datenbanken aus dem geöffneten Backup zurück. Lässt sich ein Head nicht einhängen, bricht die Wiederherstellung mit dem Grund ab, statt Erfolg zu melden.
- **Einträge früherer Sitzungen:** OrbitDB 4.0.0 merkt sich verifizierte Identitäten nach `signatures.id` und lehnt eine abweichende mit derselben ID ab. Eine Passkey-Identität hat in jeder Sitzung dieselbe `signatures.id`, aber eine neue WebAuthn-Zusicherung; Einträge einer früheren Sitzung (aus einem Backup oder per Sync von einem eigenen Gerät) wurden deshalb abgelehnt. Belege prüft so eine Identität noch einmal so, wie OrbitDB eine ungespeicherte prüft (Form, ID-Signatur, Passkey-Bindung im Provider), nur ohne den Vergleich ([orbitdb/orbitdb#1258](https://github.com/orbitdb/orbitdb/issues/1258); `session-identities.js`).
- **Format:** eine CAR-Datei, geschrieben von `@le-space/orbitdb-storage-bridge`, als Ganzes versiegelt mit AES-256-GCM. Der Schlüssel wird mit HKDF aus dem PRF-Ergebnis des Passkeys abgeleitet (`belege/backup-key/v1`). Die Datei ist `belegeB1 ‖ Nonce ‖ Chiffretext`.
- **Upload:** das `aleph`-Backend der Storage-Bridge, `POST https://ipfs.aleph.cloud/api/v0/add`, ohne Schlüssel.
- **Aufbewahren:** Die Bridge unterschreibt die STORE-Nachricht mit `personal_sign` im Kanal `BELEGE-BACKUP` (`POST /backup/aleph/pin`, [bridge/README.md](../bridge/README.md)).
- **Fehlende Blöcke:** Für ein Backup wird nichts aus dem Netz geholt. Ein Block, den dieser Browser nicht hat, zählt als fehlend, und die Seite sagt es.
