# Wie du Belege nutzen kannst

_English: [use-cases.md](use-cases.md)_

Belege läuft im Browser. Für vieles reicht das. Für Bank, Postfach und KI kommt ein kleines
Programm auf deinem Rechner dazu, die Bridge. Hier steht, welche Wege es gibt, was du jeweils
brauchst und was dabei deinen Rechner verlässt. Du kannst klein anfangen und später mehr
dazunehmen.

## 1. Nur der Browser

Du öffnest belege.le-space.de, legst einen Passkey an und arbeitest los. Kontoauszüge lädst du
als CAMT-Datei aus dem Online-Banking hoch, Belege als PDF oder Foto, oder Belege liest einen
Ordner auf deinem Rechner. Belege ordnet Zahlungen und Belege einander zu und macht jeden Monat
ein DATEV-Paket. Reisekosten gehen auch.

- **Du brauchst:** einen Browser und einen Passkey.
- **Was hinausgeht:** nichts. Deine Bücher liegen nur in diesem Browser, verschlüsselt mit
  deinem Passkey.

## 2. Ein Rechner mit Bridge

Die Bridge läuft auf deinem Rechner und macht, was ein Browser nicht darf. Sie holt Umsätze
von deiner Bank (über Hibiscus oder Enable Banking), Belege aus deinem Postfach, aus Paperless
oder aus Kundenportalen. Sie fragt ein Sprachmodell, damit es Belege ausliest und Vorschläge
macht. Und sie liest Kraken, eigene Wallets und Aleph-Konten, nur lesend.

- **Du brauchst:** die Bridge auf einem Mac oder Windows-Rechner (`pnpm bridge`), einmal
  gekoppelt mit dem Code, den sie zeigt.
- **Was hinausgeht:** die Anfragen der Bridge an deine Bank, dein Postfach und die Dienste, die
  du einrichtest. Für die KI hast du die Wahl: ein Modell auf deinem Rechner (dann geht nichts
  hinaus), ein gehostetes Modell mit Schwärzung vorher, oder LibertAI in einer geprüften
  Enklave. Passwörter und Schlüssel bleiben im Schlüsselbund deines Rechners.

## 3. Mehrere eigene Geräte

Dieselben Bücher auf Rechner und Telefon, oder auf zwei Rechnern. Ein Gerät bekommt die Bücher
erst, wenn es zeigt, dass es deinen Passkey hat. Wo sich die Geräte treffen, wählst du:

- über ein Relay von Le Space (dann klappt es auch unterwegs),
- über das Relay in deiner Bridge (nur in deinem eigenen Netz),
- per QR-Code, ganz ohne Relay (zwei Geräte im selben Netz),
- oder alles zusammen; ein neues Gerät kommt dann nur über dein eigenes Netz herein.

- **Du brauchst:** auf jedem Gerät denselben Passkey und „Eigene Geräte synchronisieren“.
- **Was hinausgeht:** nur verschlüsselte Daten zwischen deinen Geräten. Ein Relay sieht, dass
  zwei Geräte miteinander reden, nie was.

## 4. Das Telefon nutzt die Bridge deines Rechners

Auf dem Telefon läuft keine Bridge. Es kann die deines Rechners nutzen, auf einem von zwei
Wegen.

**Die Bridge als eigenes Gerät.** Du koppelst die Bridge per Einladung (Integrationen →
Bridge). Dann erreicht dein Telefon sie über ein Relay, auch unterwegs, und am Rechner muss kein
Browser offen sein. Die Bridge bekommt dafür einen eigenen Schlüssel. Er zeigt, dass sie deine
Bridge ist, und öffnet keine Bücher.

- **Was hinausgeht:** Die Bridge verbindet sich selbst mit den Relays deiner Bücher. Was sie mit
  deinen Geräten austauscht, ist verschlüsselt.

**Über den offenen Rechner.** Du willst, dass die Bridge nie selbst ins Netz geht? Dann startest
du sie mit `pnpm bridge --no-node`. Am Rechner schaltest du unter Eigene Geräte „Bridge dieses
Rechners für eigene Geräte freigeben“ ein. Dein Telefon fragt dann den Belege-Tab am Rechner, und
der fragt die Bridge. Das geht nur, solange dieser Tab offen und entsperrt ist, und das Telefon
darf nur lesen und fragen, nichts einrichten oder löschen.

- **Was hinausgeht:** Die Bridge spricht nur mit deinem Rechner. Telefon und Rechner tauschen
  sich verschlüsselt aus, wie bei der Synchronisation.

## 5. Absichern und zurückholen

Ein verschlüsseltes Backup deiner Bücher und Belege liegt bei Aleph Cloud, auf Wunsch automatisch.
Auf einem leeren Gerät holst du es mit deinem Passkey zurück, oder mit den 24
Wiederherstellungswörtern, wenn der Passkey weg ist. Einen zweiten Passkey kannst du als Ersatz
anlegen.

- **Du brauchst:** einmal die Bridge, um das Konto bei Aleph einzurichten, und Credits dort.
  Gibst du danach den Schlüssel deines Browsers für dieses Konto frei, sichert er auch ohne
  Bridge ([backup.de.md](backup.de.md)). Zum Zurückholen brauchst du die Adresse des Kontos.
- **Was hinausgeht:** nur die verschlüsselte Sicherung. Aleph kann sie nicht lesen.

## 6. Mit anderen arbeiten

- **Steuerberatung:** jeden Monat das DATEV-Paket mit den Belegen.
- **Assistenz:** eine Lese-Freigabe für ein Jahr, geschwärzt und mit Ablaufzeit. Du kannst sie
  jederzeit beenden. Dafür muss die Bridge laufen.
- **Rechnungs-App von Le Space:** Sie liefert Eigenbelege und erfährt, welche ihrer Rechnungen
  bezahlt sind.

## 7. Die Buchhaltung arbeitet in deinen Büchern

Deine Buchhaltung kommt mit ihrem eigenen Passkey in deine Bücher (_Integrationen →
Zusammenarbeit_). Sie macht einen Beitrittscode, du nimmst sie auf und schickst die Antwort
zurück. Ab dann öffnet sie deine Bücher neben ihren eigenen, ordnet Belege zu, erstellt
Eigenbelege, exportiert und sichert. Sie schreibt unter eigenem Namen. Passkeys,
Wiederherstellungswörter und weitere Personen einladen bleiben bei dir.

- **Du brauchst:** Geräte-Sync auf beiden Seiten; beide Geräte gleichzeitig online, damit sich die
  Bücher abgleichen.
- **Was hinausgeht:** dasselbe wie bei mehreren eigenen Geräten – versiegelt, über ein
  Relay oder direkt. Beitrittscode und Antwort gehen den Weg, auf dem du sie schickst; die Antwort
  ist für das Gerät versiegelt, das den Code gemacht hat.
- **Mehr:** [keys.de.md](keys.de.md#mitglieder),
  [backup.de.md](backup.de.md#mitglieder-sichern-und-stellen-wieder-her).

## Was noch kommt

Noch nicht fertig, aber geplant: die Bridge als eigene Maschine in der Cloud, geprüft und
gekoppelt wie auf deinem Rechner. Ein KI-Dienst von Le Space. Bezahlen mit Le Space Credits.
Weitere Rollen in
gemeinsamen Büchern – etwa die Steuerberatung nur lesend.
