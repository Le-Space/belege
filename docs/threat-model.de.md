# Wogegen Belege schützt, und wogegen nicht

_English: [threat-model.md](threat-model.md)_

Belege hält die Bücher eines Unternehmens im Browser. Sie sind mit Schlüsseln versiegelt, die aus der Wurzel der Bücher kommen. Die Wurzel öffnet dein Passkey ([keys.de.md](keys.de.md)). Diese Seite sagt offen, gegen welche Risiken das hilft und gegen welche nicht. So kannst du entscheiden, wo und wie du Belege nutzt. Schwachstellen in Belege selbst meldest du bitte vertraulich ([SECURITY.md](../SECURITY.md)).

## Wogegen Belege schützt

- **Gegen alle, die die Daten speichern oder weiterreichen.** Das sind Aleph Cloud, Relays, IPFS-Knoten und eigene Geräte unterwegs. Sie bekommen nur versiegelte Datensätze, versiegelte Log-Einträge und versiegelte Backups, nie die Schlüssel ([backup.de.md](backup.de.md), [device-proof.de.md](device-proof.de.md)).
- **Gegen eine Kopie des Browserprofils oder der Festplatte.** Kein Schlüssel wird gespeichert. Ohne einen Passkey der Bücher oder ihre Wiederherstellungswörter bleibt versiegelt, was gespeichert ist.
- **Gegen fremde Geräte.** Die Bücher bekommt nur ein Gerät, das den Schlüssel der Bücher nachweist. Und auch dann nur, wenn die Bücher es kennen oder jemand es zulässt.
- **Gegenüber dem Sprachmodell.** Text für ein gehostetes Modell wird vorher geschwärzt. Ein Modell in einer attestierten Enklave liest ihn nur dort ([ai.de.md](ai.de.md)).
- **Gegen eine gestohlene Bridge, was die Bücher angeht.** Die Bridge hält die Zugänge zu Bank, Postfach und Sprachmodell, aber nicht die Schlüssel der Bücher. Ist sie per Einladung gekoppelt, hält sie einen eigenen Schlüssel. Er zeigt deinen Geräten, dass sie deine Bridge ist, und öffnet keine Bücher und kein Gerät. „Kopplung lösen“ macht ihn wertlos ([keys.de.md](keys.de.md#was-die-bridge-hält-und-warum)).

## Wogegen Belege nicht schützen kann

- **Ein Gerät oder ein Browser, die nicht in deiner Hand sind.** Das können Schadsoftware sein, jemand am entsperrten Gerät oder eine **Browser-Erweiterung**, die auf der Website laufen darf. Sie sehen, was die Seite sieht: die offenen Bücher und die Antwort des Passkeys beim Entsperren, und damit die Schlüssel. Das gilt für jede Web-Anwendung, auch fürs Onlinebanking. Die Schlüssel lassen sich danach nur mit [neuen Schlüsseln für die Bücher](keys.de.md#neue-schlüssel-für-die-bücher) wechseln. Darum ist es besser, das zu vermeiden, als es hinterher zu reparieren.
- **Eine veränderte Version der App.** Die App kommt von belege.le-space.de. Ein Build, der unterwegs verändert wurde, könnte dasselbe wie eine Erweiterung. Jedes Release nennt auf seiner Release-Seite seine IPFS-CID. So lässt sich ein ausgelieferter Build mit dem veröffentlichten vergleichen.
- **Ein Mitglied, das kopiert, was es lesen durfte.** Ein Mitglied der Bücher, zum Beispiel die Buchhaltung, hat die Schlüssel zum Lesen ([keys.de.md](keys.de.md#mitglieder)). Was es gelesen oder kopiert hat, lässt sich nicht zurückholen. Nimmst du es heraus ([#614](https://github.com/Le-Space/belege/issues/614)), passiert Folgendes:
  - Sein Schreiben endet sofort.
  - Seine Geräte, auch ein neues, kommen nur herein, wenn du sie hereinlässt.
  - Was danach in die Bücher kommt, könnte es trotzdem lesen, falls es auf anderem Weg daran kommt. Das endet erst mit neuen Schlüsseln für die Bücher (_Einstellungen → Schlüssel_, [keys.de.md](keys.de.md#neue-schlüssel-für-die-bücher)).

  Lass deshalb nur Menschen herein, denen du auch den Ordner mit den Belegen geben würdest.

- **Der Verlust aller Passkeys.** Leg unter _Einstellungen → Schlüssel_ einen zweiten Passkey an, oder schreib dir dort die Wiederherstellungswörter auf Papier auf ([keys.de.md](keys.de.md)).

## Was du tun kannst

- **Ein Browserprofil nur für Belege, ohne Erweiterungen.** Das ist der einfachste und wirksamste Schritt. Alternativ lässt du im bestehenden Profil keine Erweiterung auf belege.le-space.de zu. In Chrome geht das unter Details der Erweiterung → „Websitezugriff“, in Safari unter Einstellungen → Erweiterungen, pro Website.
- **Auf Android** führt Chrome keine Erweiterungen aus. Installierst du Belege dort als App, ist es ihnen nicht ausgesetzt.
- **System und Browser aktuell halten** und das Gerät sperren, wenn du es verlässt.
- **Eine Desktop-App** ohne Browser-Erweiterungen ist als Alternative zur Web-App geplant. Einen Termin gibt es noch nicht.
