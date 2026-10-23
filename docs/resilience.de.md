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

**Mit den Standardgrenzen der Bibliothek** (2 Minuten und 128 KiB je Circuit, `@libp2p/circuit-relay-v2`): Koppeln (0,3 s), der Sync des Nachzüglers und zehn einzelne Buchungen je Richtung laufen bei jeder Größe durch — und dann bleibt der Schub von 100 auf halbem Weg stehen und wird nie fertig: 48 von 100 kamen bei 50 Buchungen an, 37 bei 500, 26 bei 2 000, unverändert nach zehn Minuten. Der Circuit erreichte mitten im Schub seine Datengrenze, der Relay schloss ihn, und die Replikation setzte nicht wieder ein.

**Warum, gemessen am 13.10.2026** mit Netzwerkmitschrieb während des Schubs (jede Verbindung mit ihren Streams auf beiden Geräten, Gossipsubs Peerliste, OrbitDBs Heads-Austausche; `app/bench/results/2026-10-13-resilience-replication-relay-50-*.json`): Zum Zeitpunkt des Schubs haben die Geräte eine direkte WebRTC-Verbindung, aber Gossipsub läuft weiter über den Circuit des Relays — es öffnet seine Streams auf der ersten Verbindung zu einem Peer und zieht nie um. Schließt der Relay den Circuit, behält Gossipsub den Peer, verliert beide Streams und öffnet neue nur für eine _neue_ Verbindung; OrbitDBs Sync, der nie eine Trennung sah, tauscht keine Heads mehr aus. Ob der Schub durchkommt, ist dann eine Frage des Timings: Eine WebRTC-Verbindung, die jung genug ist, dass ihr Verbindungsereignis nach dem Schließen eintrifft, trägt weiter (100 von 100 in 1,9–2,4 s in drei Läufen); eine eingespielte nicht (28 von 100 in einem vierten, gleichen Lauf). Ohne Datengrenze, mit 5 s Circuit-Dauer und dann 8 s Ruhe vor dem Schub — die Form eines Imports nach zwanzig Minuten an einem Le-Space-Relay — kommt gar nichts an: 0 von 100, jedes Mal. Festgehalten als [belege#393](https://github.com/Le-Space/belege/issues/393); die richtige Korrektur gehört in Gossipsub, eine Wiederverbindung in der App ist der Notbehelf. Eine frühere Fassung dieser Seite machte [orbitdb-relay#59](https://github.com/NiKrause/orbitdb-relay/issues/59) verantwortlich; dieser Relay-Fehler ist echt, läuft aber auf dem Relay, und der Relay des Benchmarks ist ein nackter libp2p-Circuit-Relay ohne orbitdb-relay-Code.

**Der Notbehelf, und was er taugt (23.10.2026).** Die Wählrunde fragte bisher, ob eine Verbindung zum Gerät offen ist — und in diesem Zustand sind drei offen. Sie fragt jetzt, ob eine davon einen `/meshsub/`-Stream trägt, gibt einer stummen Verbindung 45 s für den Fall, dass sie sich nur einrichtet, und legt dann auf: ein erneutes Wählen bekäme die bestehende Verbindung zurück, statt einen Circuit zu bauen, also muss sie erst weg, bevor eine brauchbare entstehen kann. Derselbe Test-Relay mit seinen Standardgrenzen, 500 Buchungen, je ein Lauf:

| | ohne die Wählrunde | mit ihr |
| --- | --- | --- |
| Schub binnen 20 s synchron | nein | nein |
| beim Stocken angekommen | 26 von 100 | 27 von 100 |
| Verbindungen, davon mit `/meshsub/` | 3, keine | 3, keine |
| von selbst zurückgekommen | **nie** | **nach 53,0 s** |
| am Ende angekommen | 26 von 100 | **100 von 100** |

Beide Arme stocken gleich, auf eine Buchung genau; der Unterschied ist allein, ob es jemandem auffällt. Drei offene Verbindungen und unter ihnen kein einziger Gossipsub-Stream — das ist #393 selbst, von innen gesehen, und es ist der Grund, warum eine Zählung angekommener Buchungen das Stocken nie erklären konnte.

Mehr als ein Notbehelf ist das nicht. Er legt eine Verbindung auf, die gesund aussieht, um eine neue zu erzwingen, er wartet dafür 45 s, und er darf das pro Gerät höchstens alle fünf Minuten — ein Fehlalarm darf kein funktionierendes Gerät in eine Schleife legen. Der Fehler, den er umgeht, sitzt in Gossipsub, also bleiben [#393](https://github.com/Le-Space/belege/issues/393) und [#403](https://github.com/Le-Space/belege/issues/403) offen.

**Mit produktionsnahen Grenzen** (die Le-Space-Relays laufen mit 20 Minuten und 10 GiB je Circuit; `E2E_RELAY_UNLIMITED=1` hebt die Grenze des Test-Relays auf) läuft alles durch, und die Zahlen decken sich im Rauschen mit denen ohne Relay:

| Bücher (Buchungen) | Koppeln (Scan → „verbunden") | Nachzügler hat alle | Mac → Telefon, Median (p95) | Telefon → Mac, Median (p95) | Schub von 100 |
| ------------------ | ---------------------------- | ------------------- | --------------------------- | --------------------------- | ------------- |
| 50                 | 0,3 s                        | 0,9 s               | 73 ms (180)                 | 73 ms (94)                  | 1,4 s         |
| 500                | 0,3 s                        | 5,5 s               | 122 ms (139)                | 125 ms (148)                | 1,7 s         |
| 2 000              | 0,3 s                        | 22,5 s              | 1,6 s (1,9)                 | 1,2 s (1,4)                 | 3,8 s         |

Der Relay fügt auf einer Maschine also nichts Messbares an Latenz hinzu; was zählt, ist seine Circuit-Grenze. Ein Relay mit den Standardgrenzen der Bibliothek schneidet einen Bankimport in der Mitte ab und lässt die Geräte bis zur nächsten Wiederverbindung getrennt — deshalb heben die Le-Space-Relays die Grenzen an. Auch ihre 20 Minuten sind eine Grenze, und deshalb bleibt #393 das, was auf dem Client zu beheben ist.

### Über einen echten Relay: der Le-Space-Relay auf Aleph (14.10.2026)

`BENCH_RELAY_ADDR` richtete das Relay-Szenario auf den an jenem Morgen ausgerollten Le-Space-Relay (orbitdb-relay 0.10.10 auf einer Aleph-VM, 20 Minuten und 10 GiB je Circuit), beide Geräte weiterhin auf einem Laptop, 50 Buchungen und 21 Minuten Ruhe zwischen den Rundreisen und dem Schub — lang genug, dass der Circuit abläuft, während die direkte Verbindung brachliegt: der Produktionsfall von #393. Drei Läufe (`app/bench/results/2026-10-14-resilience-replication-relay-50-aleph-quiet21m*.json`); im dritten gingen libp2ps eigene Logs beider Seiten ins Ergebnis (`BENCH_LIBP2P_DEBUG`), das Journal des Relays lag daneben.

| Lauf | Koppeln | Nachzügler hat alle 50 | Mac → Telefon / Telefon → Mac, Median | Schub von 100    | Verbindung zum Relay verloren nach | neu gewählt?                      |
| ---- | ------- | ---------------------- | ------------------------------------- | ---------------- | ---------------------------------- | --------------------------------- |
| 1    | 0,3 s   | 2,4 s                  | 171 / 169 ms                          | 100/100 in 2,6 s | 28 s und 40 s nach Beginn der Ruhe | einmal, bei 268 s wieder verloren |
| 2    | 0,3 s   | 2,5 s                  | 172 / 169 ms                          | 100/100 in 1,4 s | 8 min 19 s und 8 min 32 s          | nein — 12 min ohne Relay          |
| 3    | 0,3 s   | 2,4 s                  | 170 / 169 ms                          | 100/100 in 1,5 s | 20 s und 68 s                      | nein — 20 min ohne Relay          |

Was das sagt:

- **Über das Internet kostet der Relay eine Rundreise.** Einzelne Buchungen brauchten 0,17 s statt 0,07 s: direkt nach dem Koppeln läuft Gossipsub noch über den Circuit des Relays (#393), jede Buchung ging also Laptop → Aleph → Laptop. Der Schub Minuten später lief über die direkte WebRTC-Verbindung und kam jedes Mal vollständig an.
- **Der Circuit erreichte seine 20 Minuten nie.** In jedem Lauf verloren beide Geräte früh ihre WebSocket zum Relay und damit den Circuit. Wer aufgelegt hat, aus beiden Logs gelesen: libp2ps Verbindungsmonitor auf der einen oder anderen Seite — alle 10 s ein Ping, und ein Ping ohne Antwort nach 5 s bricht die Verbindung ab. Der Relay war die ganze Zeit gesund (Event-Loop-Lag höchstens 0,14 s, CPU 1,5 %); sein Ping-Handler sah die 32 Bytes der Browser nach 26 ms bis 2,4 s eintreffen. Der Uplink des Laptops verlor in jener Stunde Pakete in Schüben (3 %, 55 %, 0 % in drei Stichproben; das lokale Gateway verlustfrei). Nicht der Relay, nicht sein Proxy: eine verlustreiche Leitung und eine Fünf-Sekunden-Regel.
- **Ein Gerät, das den Relay verliert, wählt ihn nie wieder an** (#403). `@libp2p/circuit-relay-v2` verwirft Reservierung und Keep-alive-Markierung des Relays, libp2ps Reconnect-Queue findet danach nichts mehr zum Neuwählen, und die App hat keinen Ersatz. Bis zum Neuladen ist das Gerät für jedes nicht schon verbundene Gerät unsichtbar; die beiden hier synchronisierten weiter über WebRTC, deshalb kam der Schub trotzdem durch. In Lauf 3 zog Gossipsub binnen 4 s nach dem Verlust des Circuits auf WebRTC um, der Stall aus #393 trat hier also nicht auf — die geplante Messung, der Circuit-Ablauf nach 20 Minuten unter einer ruhenden direkten Verbindung, steht weiter aus und braucht eine verlustfreie Leitung oder ein Gerät, das neu wählt.
- **Jede verlorene Verbindung meldet genau 60 s später ein zweites Schließen**, ohne Öffnen dazwischen. `@libp2p/websockets` versucht den Reset mit dem reservierten Close-Code 1006, Browser wie Node lehnen ihn ab, und der Socket bleibt eine Minute liegen (Fix upstream offen: libp2p/js-libp2p#3625). Das erste Schließen zählt.

**Später am selben Tag, ohne die Ruhe, bei 50 und bei 500** (`app/bench/results/2026-10-14-resilience-replication-relay-{50,500}-aleph-0-10-10.json`): derselbe Relay, drei Rundreisen, dann sofort der Schub.

| Bücher | Koppeln | Nachzügler hat alle | Mac → Telefon / Telefon → Mac, Median | Schub von 100    | wo der Schub lief                          |
| ------ | ------- | ------------------- | ------------------------------------- | ---------------- | ------------------------------------------ |
| 50     | 1,8 s   | 2,4 s               | 378 / 376 ms                          | 100/100 in 5,5 s | über den Circuit des Relays, WebRTC leer   |
| 500    | 3,3 s   | 17,6 s              | 233 / 238 ms                          | 100/100 in 2,4 s | über den Circuit des Relays, WebRTC leer   |

Diesmal lief auch der Schub selbst durch den Relay: Auf beiden Geräten lagen Gossipsubs Streams den ganzen Schub über auf dem Circuit, die WebRTC-Verbindung trug keinen (#393 von der anderen Seite gesehen — nichts schloss den Circuit, also stallte nichts). In einem Zwei-Minuten-Lauf sind die 10 GiB und 20 Minuten des Relays weit weg, und keine Verbindung ging verloren. Was es hinzufügt: Durch den Produktions-Relay kostet ein Schub von 100 zwei bis fünf Sekunden statt anderthalb über WebRTC, und die Leitung am Nachmittag war langsamer als am Morgen — 233 bis 378 ms je Rundreise statt 170.

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

Neu gemessen am **23. Oktober 2026**, dieselbe Maschine, Einträge mit Ed25519 unterschrieben, und die Storage Bridge in [0.24.0](https://github.com/NiKrause/orbitdb-storage-bridge/blob/main/CHANGES.md). Docker (fünf Paperless-Container) und Jameica **liefen** bei diesen Messungen, anders als bei den vorigen — die Zahlen sind also eher zu hoch als zu niedrig. In Klammern die Werte vom 13. Oktober mit Bridge 0.17.0; 5 000 und 10 000 waren vorher nie erreichbar und haben keine.

| Bücher (Buchungen) | IndexedDB | Sicherung (Klick → „von Aleph aufbewahrt") | Wiederherstellung (Klick → „Wiederhergestellt") | Entsperren nach dem Neuladen | jede Buchung zurück |
| ------------------ | --------- | ------------------------------------------ | ----------------------------------------------- | ---------------------------- | ------------------- |
| 50                 | 8,3 MB    | 0,3 s                                      | **0,8 s** _(1,4 s)_                             | 0,2 s                        | ja, 0 verloren      |
| 500                | 9,4 MB    | 0,4 s                                      | **3,9 s** _(40 s)_                              | 0,8 s                        | ja, 0 verloren      |
| 1 000              | 10,7 MB   | 0,6 s                                      | **7,4 s** _(126 s)_                             | 0,8 s                        | ja, 0 verloren      |
| 2 000              | 13,3 MB   | 2,6 s                                      | **14,5 s** _(—)_                                | 1,4 s                        | ja, 0 verloren      |
| 5 000              | 21,3 MB   | 8,1 s                                      | **40,5 s** _(—)_                                | 3,4 s                        | ja, 0 verloren      |
| 10 000             | 34,3 MB   | 16,6 s                                     | **79,1 s** _(—)_                                | 6,9 s                        | ja, 0 verloren      |

Die Wiederherstellung ist **linear**, und die Spalte, die das beweist, steht nicht in der Tabelle: ab 500 Buchungen kostet jede 7,3 bis 8,1 Millisekunden, gleich wie viele es insgesamt sind. Zehntausend kommen in 79 s zurück, wo zweitausend vorher gar nicht zurückkamen. Die Sicherung ist in dieser Größenordnung auch nicht mehr flach — sie wächst mit den Büchern, auf 16,6 s bei 10 000 — und das Entsperren danach ebenso.

**Das taten sie nie, und nicht, weil sie langsam waren.** `CarReader` gibt jeden Block einer Sicherung als Ausschnitt in den **einen** `ArrayBuffer` heraus, in dem das ganze CAR liegt, und IndexedDB speichert hinter einem Ausschnitt *den dahinterliegenden Puffer*, nicht den Ausschnitt. Eine Sicherung von 3,7 MB verlangte vom Browser also 3,7 MB **pro Block** — rund 7,5 GB für 2 016 Stück — und er verweigerte alles ab etwa Block 500 mit `QuotaExceededError`. N Blöcke, von denen jeder ein mit N wachsendes Archiv mitträgt, ist quadratisch, und genau das ist das „wächst schneller als die Bücher", das dieser Bericht beschrieben hat. Nachgestellt mit nichts als einem `LevelBlockstore` in einer leeren Seite: dieselben 2 016 Blöcke kosten als freistehende Kopien 4 MB und gehen alle hinein; als Ausschnitte eines Puffers kosten sie 1 862 MB und hören bei Block 494 auf ([#174](https://github.com/NiKrause/orbitdb-storage-bridge/pull/174)).

In einer früheren Fassung stand hier, 2 000 Buchungen seien „weiterhin nach 10 min nicht fertig". **Sie waren nach rund zwei Minuten fertig — mit einem Fehlschlag.** Der größte Teil der Sicherung erreichte den Speicher nie, die Köpfe darunter; das Log wartete dann jeden fehlenden Kopf im Netz aus, etwa zwanzig Sekunden pro Stück ohne einen Peer, der antworten könnte, und gab mit `Entry's id (undefined) doesn't match the log's id` auf — einer Meldung, die weder die Ursache noch die Abhilfe nennt. Ein CPU-Profil dieser zwei Minuten besteht zu 98,9 % aus Leerlauf. Die Bücher waren zu diesem Zeitpunkt für die Wiederherstellung schon geschlossen, also lud die Seite neu und zeigte ihren Sperrbildschirm mit leeren Büchern. Das Paket bricht jetzt sofort ab, wenn ein Block nicht abgelegt werden kann, und schließt die Bücher des Aufrufers erst, wenn jeder Block sicher liegt ([#172](https://github.com/NiKrause/orbitdb-storage-bridge/pull/172), und Le-Space/belege#480 für belegas Seite davon).

Die frühere Reparatur steckt weiterhin in diesen Zahlen und war auch richtig: `restoreFromBlocks` legte jeden Block in den Log-Speicher **jeder** Datenbank, 18 099 Schreibvorgänge für 2 011 Blöcke ([#152](https://github.com/NiKrause/orbitdb-storage-bridge/issues/152), behoben in [#168](https://github.com/NiKrause/orbitdb-storage-bridge/pull/168) und [#170](https://github.com/NiKrause/orbitdb-storage-bridge/pull/170)). Der Hauptkostenpunkt war sie nie, und der Schluss, den dieser Bericht aus dem Rest zog — IndexedDB-Schreibvorgänge seien hier grundsätzlich langsam, Bündeln sei der nächste Hebel —, war gleich doppelt falsch. Das Bündeln wurde ausprobiert und war **langsamer** (33–35 s gegen 18–19 s bei 500 Buchungen, wieder verworfen); die Schreibvorgänge waren nicht langsam, es waren tausendmal zu viele Bytes in jedem.

Verloren geht bei keiner Größe etwas, bis zu zehntausend Buchungen. Das Entsperren danach wächst nicht mehr wie zuvor (0,8 s bei 1 000 gegen 13,0 s davor): es bezahlte denselben aufgeblähten Blockspeicher mit.

## Die Kurve der Identität: Ed25519 gegen secp256k1

OrbitDB prüft jeden Eintrag, den es einhängt, und der Schlüssel der Identität entscheidet, was das kostet: 3,45 ms je Prüfung bei secp256k1, 0,17 ms bei Ed25519, gemessen über `@libp2p/crypto` — den Weg, über den OrbitDB prüft. In Node ist das die ganze Geschichte: Eine Wiederherstellung von 2 000 Einträgen dauert mit secp256k1 11,8 s und mit Ed25519 5,6 s.

Im Browser ist davon fast nichts zu sehen. Sechs Läufe am 23. Oktober 2026, verschränkt (Ed, secp, Ed, secp, …), damit eine Drift der Maschinenlast beide Seiten gleich trifft, je 500 Buchungen:

| | Ed25519 | secp256k1 |
| --- | --- | --- |
| Wiederherstellung | 17,6–19,2 s (Median 19,1) | 16,1–19,7 s (Median 18,2) |
| Nachzügler, ohne Relay | 4,91–4,97 s (Median 4,94) | 4,97–5,41 s (Median 5,40) |

Die Wiederherstellung kümmert es nicht: Die Spannen überlappen fast vollständig, und das Wenige, das die Kurve spart, geht in IndexedDB unter. Den Nachzügler schon, ein wenig — etwa eine halbe von fünf Sekunden, also rund ein Zehntel, und die Ed25519-Läufe liegen dabei innerhalb von 60 ms beieinander, während die anderen streuen. Beides passt zur Theorie: 500 Einträge sparen höchstens 1,65 s Prüfzeit, und nur dort, wo nicht ohnehin der Speicher bremst.

Belege unterschreibt seit dieser Messung mit Ed25519. Die DID ändert sich dadurch nicht — sie ist der P-256-Schlüssel des Passkeys —, Bücher von vorher bleiben also lesbar und beschreibbar.

## Die App von IPFS

`node bench/delivery.mjs`: ein Erstbesuch, wie ein Browser ihn macht — die Seite, dann jedes Script und Stylesheet, das sie lädt — von der Domain (DNSLink → Aleph-Gateway) und direkt von einem öffentlichen Gateway über den CID des Releases, je dreimal, Median.

| von                                          | TTFB der Seite | Erstbesuch gesamt    | Dateien | Bytes   |
| -------------------------------------------- | -------------- | -------------------- | ------- | ------- |
| https://belege.le-space.de/                  | 45 ms          | 116 ms (kalt: 0,9 s) | 1 + 11  | 108 232 |
| https://ipfs.aleph.sh/ipfs/bafybeidv34…ut6y/ | 51 ms          | 139 ms (kalt: 0,4 s) | 1 + 11  | 108 232 |

Dieselben 108 232 Bytes von beiden: Die Domain liefert genau den CID, den die Release-Notes nennen — prüfbar mit `dig TXT _dnslink.belege.le-space.de`. Ein Befund am Rande: Der Build referenziert seine Assets mit absolutem Pfad (`/_app/…`); auf einem _Pfad_-Gateway (`…/ipfs/<cid>/`) würde ein Browser sie an der Wurzel des Gateways suchen, ein Subdomain-Gateway (`<cid>.ipfs.inbrowser.link`) hat das Problem nicht — deshalb verlinkt die Produktseite diese Form. Die Messung löst die Assets so unter dem CID auf, wie es ein Subdomain-Gateway tut; ein Build mit relativen Pfaden würde jeden Gateway funktionieren lassen und ist getrennt vorgeschlagen.

## Was das zeigt und was nicht

- Gemessen: Latenz und Durchsatz der Replikation zwischen zwei Browsern auf einer Maschine, mit und ohne Relay; das Verhalten über eine Netztrennung; Sicherungs- und Wiederherstellungszeiten nach Größe; was die App wiegt und wie schnell sie aus zwei Quellen kommt. Jeder Lauf ist mit den Befehlen oben reproduzierbar; die JSON-Dateien halten die Rohzahlen.
- Nicht gemessen: echte Netze jenseits eines Relays über das Internet (oben, beide Geräte auf einer Maschine — NAT-Traversal zwischen zwei Netzen, Mobilfunk), mehr als zwei Geräte, Belegdateien (die Bücher hier halten nur Buchungen — ein Jahr PDFs bringt Megabytes ins Archiv), ein echtes Aleph (das Fake antwortet aus dem Speicher) und andere Browser als Chromium.
- Ehrliche Schwachstellen, alle gemessen statt vermutet: der abbrechende Schub über einen Relay mit Standardgrenzen; die 23 s Wiederverbindung nach einer Pause; die überlineare Wiederherstellung.

## Früher: wie die Bücher sich beim Wachsen verhalten

Der Bücher-Benchmark (`pnpm bench:books`, [performance.de.md](performance.de.md)) hat am 26. September 2026 den Store selbst gemessen: Nach den ersten Fixes von #78 schreiben sich 1 000 Buchungen in 9 s, `refresh()` braucht 24 ms, der erste Matching-Lauf 24 s, Entsperren bis Home 3,0 s, 11 MB in IndexedDB.
