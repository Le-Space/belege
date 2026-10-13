# Resilienz, gemessen

Wie die Bücher überleben: zwei Geräte eines Passkeys, die mit und ohne Relay replizieren, eine Netztrennung mit Schreibzugriffen auf beiden Seiten, ein Browser, der alles verloren hat und seine Bücher aus dem Archiv zurückbekommt, und die App selbst, die von IPFS kommt. Jede Zahl hier ist gemessen, mit erfundenen Büchern; was nicht gemessen wurde, steht dabei. Englisch: [resilience-report.md](resilience-report.md).

## Der Benchmark

`pnpm --filter @belege/app bench:resilience` (`RESILIENCE_SIZES=50,500` voreingestellt; `RESILIENCE_SCENARIOS=relay,qr,partition,recovery`, `RESILIENCE_ROUNDS=10`) baut den E2E-Build, startet den lokalen Test-Relay (`e2e/relay.js`) und für die Wiederherstellung die echte Bridge im Testmodus gegen ein Fake-Aleph auf 127.0.0.1 (`@belege/bridge/testing/aleph`). Zwei Browser-Kontexte stehen für einen Mac und ein Telefon mit einem synchronisierten Passkey (virtuelle Authenticatoren, `e2e/devices.js`). Bücher mit _n_ Buchungen werden durch den echten Store geschrieben (`window.__belegeE2E.bench.putMany`, nur in E2E-Builds), und jede Zeit wird am empfangenden Store selbst abgelesen (`bench.count`), nie an der Oberfläche. Ergebnisse liegen in `app/bench/results/<datum>-resilience-<szenario>-<größe>.json`; `node bench/delivery.mjs` schreibt `<datum>-delivery.json`. Beides ist nicht Teil der CI.

Rechner für alle Läufe: Intel i9-9880H (8 Kerne, 32 GB), headless Chromium, macOS, 13. Oktober 2026, Belege auf `bench/resilience` (v0.9.1 plus der Benchmark). Beide Geräte und der Relay laufen auf derselben Maschine: Die Zahlen messen App, Store und Protokolle, nicht ein Netz — die Laufzeit des eigenen Netzes kommt jeweils dazu.

## Replikation ohne Relay (zwei QR-Codes)

Der Mac zeigt eine Einladung, das Telefon scannt sie und antwortet, der Mac nimmt die Antwort: eine direkte WebRTC-Verbindung, kein Relay, kein STUN. Der Test protokolliert jede Anfrage und jeden WebSocket beider Kontexte, die die Maschine verlassen: **0** in jedem Lauf.

| Bücher (Buchungen) | Koppeln (Einladung → beide „verbunden · direkt") | Nachzügler hat alle | eine Buchung Mac → Telefon, Median (p95) | Telefon → Mac, Median (p95) | Schub von 100 kommt an in |
| ------------------ | ------------------------------------------------ | ------------------- | ---------------------------------------- | --------------------------- | ------------------------- |
| 50                 | 1,4 s                                            | 1,4 s               | 94 ms (268)                              | 73 ms (99)                  | 1,5 s                     |
| 500                | 0,9 s                                            | 5,4 s               | 126 ms (136)                             | 130 ms (146)                | 1,8 s                     |
| 2 000              | 0,9 s                                            | 23,7 s              | 1,9 s (2,1)                              | 1,4 s (1,7)                 | 4,1 s                     |

Eine einzelne Buchung kommt bis 500 Buchungen deutlich unter einer Sekunde an. Bei 2 000 wächst die Rundreise auf 1,4–1,9 s: nicht der Transport — der Schub von 100 kommt weiterhin in 4 s — sondern der empfangende Store, der nach einem Eintrag von anderswo sein Log neu durchläuft ([performance.de.md](performance.de.md), der offene Teil von #78). Der volle Sync des Nachzüglers ist linear: etwa 12 ms je Buchung.

## Replikation über einen Relay

Beide Geräte erreichen sich über einen Circuit-Relay (was die öffentlichen Le-Space-Relays und der LAN-Relay der Bridge sind) und versuchen dann, auf eine direkte Verbindung zu wechseln.

**Mit den Standardgrenzen der Bibliothek** (2 Minuten und 128 KiB je Circuit, `@libp2p/circuit-relay-v2`): Koppeln (0,3 s), der Sync des Nachzüglers und zehn einzelne Buchungen je Richtung laufen bei jeder Größe durch — und dann bleibt der Schub von 100 auf halbem Weg stehen und wird nie fertig: 48 von 100 kamen bei 50 Buchungen an, 37 bei 500, 26 bei 2 000, unverändert nach zehn Minuten. Der Circuit erreichte mitten im Schub seine Datengrenze, der Relay schloss ihn, und die Replikation nahm keinen neuen auf. Das ist die bekannte Schwäche aus [orbitdb-relay#59](https://github.com/Le-Space/orbitdb-relay/issues/59) (der Heads-Sync wiederholt nach einem Hangup nicht) — hier gemessen statt vermutet.

**Mit produktionsnahen Grenzen** (die Le-Space-Relays laufen mit 20 Minuten und 10 GiB je Circuit; `E2E_RELAY_UNLIMITED=1` hebt die Grenze des Test-Relays auf) läuft alles durch, und die Zahlen decken sich im Rauschen mit denen ohne Relay:

| Bücher (Buchungen) | Koppeln (Scan → „verbunden") | Nachzügler hat alle | Mac → Telefon, Median (p95) | Telefon → Mac, Median (p95) | Schub von 100 |
| ------------------ | ---------------------------- | ------------------- | --------------------------- | --------------------------- | ------------- |
| 50                 | 0,3 s                        | 0,9 s               | 73 ms (180)                 | 73 ms (94)                  | 1,4 s         |
| 500                | 0,3 s                        | 5,5 s               | 122 ms (139)                | 125 ms (148)                | 1,7 s         |
| 2 000              | 0,3 s                        | 22,5 s              | 1,6 s (1,9)                 | 1,2 s (1,4)                 | 3,8 s         |

Der Relay fügt auf einer Maschine also nichts Messbares an Latenz hinzu; was zählt, ist seine Circuit-Grenze. Ein Relay mit den Standardgrenzen der Bibliothek schneidet einen Bankimport in der Mitte ab und lässt die Geräte bis zur nächsten Wiederverbindung getrennt — deshalb heben die Le-Space-Relays die Grenzen an, und deshalb bleibt #59 das, was auf dem Client zu beheben ist.

## Netztrennung: Schreibzugriffe auf beiden Seiten, danach zusammengeführt

Bücher mit 50 Buchungen auf beiden Geräten über den Relay; das Telefon pausiert sein Netz („Alles pausieren" im Menü des Abzeichens — der Connection Gater schließt, jede Verbindung wird aufgelegt); beide Seiten schreiben 20 Buchungen; das Telefon setzt fort.

| Schritt                                  | gemessen                                            |
| ---------------------------------------- | --------------------------------------------------- |
| getrennt: Mac hält / Telefon hält        | 70 / 70 (50 plus die eigenen 20, keine der anderen) |
| Fortsetzen → wieder „verbunden"          | 23,5 s                                              |
| beide halten alle 90 nach der Verbindung | 0,4 s                                               |
| verlorene Buchungen                      | **0** — beide Stores halten dieselben 90 Ids        |

Die Zusammenführung nach der Wiederverbindung ist sofort da; was kostet, ist die Wiederverbindung selbst, 23–25 s in jedem Lauf: der Relay-Redial nach einer Pause. Das ist die Zahl, die besser werden muss, und sie gehört dem Verbindungscode, nicht dem Merge.

## Wiederherstellung: ein Browser, der alles verloren hat

Ein Browser, die Bridge im Testmodus, das Fake-Aleph. Bücher mit _n_ Buchungen, „Jetzt sichern" (die Storage Bridge versiegelt die Datenbank und legt sie ab), dann werden `localStorage`, `sessionStorage` und jede IndexedDB gelöscht und die Bridge gestoppt. Derselbe Passkey öffnet leere Bücher; die Adresse des Kontos allein listet die Sicherung; „Wiederherstellen" holt sie, legt die Blöcke zurück und joint die Heads; die Seite lädt neu, der Passkey entsperrt.

| Bücher (Buchungen) | IndexedDB | Sicherung (Klick → „von Aleph aufbewahrt") | Wiederherstellung (Klick → „Wiederhergestellt") | Entsperren nach dem Neuladen | jede Buchung zurück |
| ------------------ | --------- | ------------------------------------------ | ----------------------------------------------- | ---------------------------- | ------------------- |
| 50                 | 8,0 MB    | 0,3 s                                      | 1,4 s                                           | 0,4 s                        | ja, 0 verloren      |
| 500                | 9,2 MB    | 0,5 s                                      | 40 s                                            | 4,9 s                        | ja, 0 verloren      |
| 1 000              | 10,5 MB   | 0,7 s                                      | 126 s                                           | 13,0 s                       | ja, 0 verloren      |
| 2 000              | —         | (nicht erreicht)                           | **nach 10 min nicht fertig**                    | —                            | —                   |

Die Sicherung ist billig und flach. Die Wiederherstellung nicht: 1,4 s bei 50, 40 s bei 500, 126 s bei 1 000 — grob die dreifache Zeit für die doppelten Bücher — und 2 000 wurden innerhalb der Zehn-Minuten-Grenze des Benchmarks nicht fertig. Das Entsperren danach wächst mit (0,4 s, 4,9 s, 13 s): der erste Durchlauf jedes Logs, wie [performance.de.md](performance.de.md) es beschreibt. Die Kosten stecken in `restoreFromBlocks` der Storage Bridge (0.17.0): Für jede Datenbank läuft sie noch einmal durch jeden Block der Sicherung und joint die Heads einzeln in das versiegelte Log, wobei jeder Join durch gerade geschriebene Einträge zurückliest. Verloren geht nichts — die Wiederherstellung mit 500 Buchungen brachte jede zurück —, aber beim heutigen Wachstum würde das dritte Jahr einer Firma Minuten warten. Das ist das Nächste, was zu beheben ist: [orbitdb-storage-bridge#152](https://github.com/NiKrause/orbitdb-storage-bridge/issues/152).

## Die App von IPFS

`node bench/delivery.mjs`: ein Erstbesuch, wie ein Browser ihn macht — die Seite, dann jedes Script und Stylesheet, das sie lädt — von der Domain (DNSLink → Aleph-Gateway) und direkt von einem öffentlichen Gateway über den CID des Releases, je dreimal, Median.

| von                                          | TTFB der Seite | Erstbesuch gesamt    | Dateien | Bytes   |
| -------------------------------------------- | -------------- | -------------------- | ------- | ------- |
| https://belege.le-space.de/                  | 45 ms          | 116 ms (kalt: 0,9 s) | 1 + 11  | 108 232 |
| https://ipfs.aleph.sh/ipfs/bafybeidv34…ut6y/ | 51 ms          | 139 ms (kalt: 0,4 s) | 1 + 11  | 108 232 |

Dieselben 108 232 Bytes von beiden: Die Domain liefert genau den CID, den die Release-Notes nennen — prüfbar mit `dig TXT _dnslink.belege.le-space.de`. Ein Befund am Rande: Der Build referenziert seine Assets mit absolutem Pfad (`/_app/…`); auf einem _Pfad_-Gateway (`…/ipfs/<cid>/`) würde ein Browser sie an der Wurzel des Gateways suchen, ein Subdomain-Gateway (`<cid>.ipfs.inbrowser.link`) hat das Problem nicht — deshalb verlinkt die Produktseite diese Form. Die Messung löst die Assets so unter dem CID auf, wie es ein Subdomain-Gateway tut; ein Build mit relativen Pfaden würde jeden Gateway funktionieren lassen und ist getrennt vorgeschlagen.

## Was das zeigt und was nicht

- Gemessen: Latenz und Durchsatz der Replikation zwischen zwei Browsern auf einer Maschine, mit und ohne Relay; das Verhalten über eine Netztrennung; Sicherungs- und Wiederherstellungszeiten nach Größe; was die App wiegt und wie schnell sie aus zwei Quellen kommt. Jeder Lauf ist mit den Befehlen oben reproduzierbar; die JSON-Dateien halten die Rohzahlen.
- Nicht gemessen: echte Netze (NAT-Traversal, Mobilfunk), mehr als zwei Geräte, Belegdateien (die Bücher hier halten nur Buchungen — ein Jahr PDFs bringt Megabytes ins Archiv), ein echtes Aleph (das Fake antwortet aus dem Speicher) und andere Browser als Chromium.
- Ehrliche Schwachstellen, alle gemessen statt vermutet: der abbrechende Schub über einen Relay mit Standardgrenzen; die 23 s Wiederverbindung nach einer Pause; die überlineare Wiederherstellung.

## Früher: wie die Bücher sich beim Wachsen verhalten

Der Bücher-Benchmark (`pnpm bench:books`, [performance.de.md](performance.de.md)) hat am 26. September 2026 den Store selbst gemessen: Nach den ersten Fixes von #78 schreiben sich 1 000 Buchungen in 9 s, `refresh()` braucht 24 ms, der erste Matching-Lauf 24 s, Entsperren bis Home 3,0 s, 11 MB in IndexedDB.
