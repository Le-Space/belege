# Wogegen Belege schützt, und wogegen nicht

_English: [threat-model.md](threat-model.md)_

Belege hält die Bücher eines Unternehmens im Browser, versiegelt mit Schlüsseln aus einem Passkey ([keys.de.md](keys.de.md)). Diese Seite sagt offen, gegen welche Risiken das hilft und gegen welche nicht – damit du entscheiden kannst, wo und wie du es nutzt. Schwachstellen in Belege selbst werden vertraulich gemeldet ([SECURITY.md](../SECURITY.md)).

## Wogegen Belege schützt

- **Gegen alle, die die Daten speichern oder weiterreichen.** Aleph Cloud, Relays, IPFS-Knoten, eigene Geräte unterwegs: Sie bekommen versiegelte Datensätze, versiegelte Log-Einträge und versiegelte Sicherungen, nie die Schlüssel ([backup.de.md](backup.de.md), [device-proof.de.md](device-proof.de.md)).
- **Gegen eine Kopie des Browserprofils oder der Festplatte.** Kein Schlüssel wird gespeichert. Ohne den Passkey bleibt versiegelt, was gespeichert ist.
- **Gegen fremde Geräte.** Die Bücher bekommt nur ein Gerät, das nachweist, dass es den Passkey hat.
- **Gegenüber dem Sprachmodell.** Text für ein gehostetes Modell wird vorher geschwärzt, und ein Modell in einer attestierten Enklave liest ihn nur dort ([ai.de.md](ai.de.md)).

## Wogegen Belege nicht schützen kann

- **Ein Gerät oder ein Browser, die nicht in deiner Hand sind.** Schadsoftware, jemand am entsperrten Gerät oder eine **Browser-Erweiterung**, die auf der Website laufen darf, sieht, was die Seite sieht: die offenen Bücher und die Antwort des Passkeys beim Entsperren – und damit die Schlüssel. Das gilt für jede Web-Anwendung, auch fürs Onlinebanking. Die daraus abgeleiteten Schlüssel lassen sich nicht wechseln, ohne die Bücher neu zu versiegeln; das ist also eher zu vermeiden als zu reparieren.
- **Eine veränderte Version der App.** Die App kommt von belege.le-space.de; ein Build, der unterwegs verändert wurde, könnte dasselbe wie eine Erweiterung. Jedes Release nennt auf seiner Release-Seite seine IPFS-CID, so lässt sich ein ausgelieferter Build mit dem veröffentlichten vergleichen.
- **Der Verlust aller Passkeys.** Leg unter _Einstellungen → Schlüssel_ einen zweiten an oder schreib dir dort Wiederherstellungswörter auf Papier auf ([keys.de.md](keys.de.md)).

## Was du tun kannst

- **Ein Browserprofil nur für Belege, ohne Erweiterungen.** Der einfachste und wirksamste Schritt. Alternativ im bestehenden Profil keine Erweiterung auf belege.le-space.de zulassen (Chrome: Details der Erweiterung → „Websitezugriff“; Safari: Einstellungen → Erweiterungen, pro Website).
- **Auf Android** führt Chrome keine Erweiterungen aus: Belege von dort als App installiert ist ihnen nicht ausgesetzt.
- **System und Browser aktuell halten** und das Gerät sperren, wenn du es verlässt.
- **Eine Desktop-App** ohne Browser-Erweiterungen ist als Alternative zur Web-App geplant; einen Termin gibt es noch nicht.
