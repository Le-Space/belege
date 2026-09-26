# Performance

Wie sich die Bücher verhalten, wenn sie wachsen, gemessen. Englisch: [performance.md](performance.md).

## Der Benchmark

`pnpm --filter @belege/app bench:books` (standardmäßig `BENCH_SIZES=1000,10000`) baut den E2E-Build, öffnet ihn in Chromium mit einem virtuellen Passkey, schreibt erfundene Bücher über den echten Speicher (`window.__belegeE2E.bench`, nur in E2E-Builds) und misst, was die App damit tut. Alle Namen und Beträge sind erfunden. Die Ergebnisse landen in `app/bench/results/<Datum>-<Größe>.json`. Er läuft nicht in der CI: Beim heutigen Tempo dauern 10 000 Buchungen Stunden.

Die Bücher je Größe _n_: _n_ Buchungen über ein Jahr auf zwei Konten, etwa 0,6 _n_ ausgelesene Belege (80 % davon zu einer Buchung), _n_ Verlaufseinträge und ein erneuter Abruf, der das neueste Zehntel der Buchungen noch einmal aktualisiert.

## Grundlinie, 26. September 2026 (vor jedem Fix)

1 000 Buchungen, 590 Belege, 1 000 Ereignisse. Intel i9-9880H (8 Kerne), Chromium headless; gleichzeitig lief eine andere Testsuite auf dem Rechner, die Zeiten sind darum etwas zu hoch.

|                                                           |                                |
| --------------------------------------------------------- | ------------------------------ |
| 1 000 Buchungen / 590 Belege / 1 000 Ereignisse schreiben | 15 s / 13 s / 26 s             |
| die neuesten 100 Buchungen aktualisieren                  | 15 s (145 ms je Update)        |
| `refresh()` (alle Listen, jede Einordnung)                | 7,9 s; 1,9 s nach dem Abgleich |
| neueste / älteste Buchung lesen                           | 0,1 s / 1,1 s                  |
| älteste Buchung ändern                                    | 2,4 s                          |
| **erster Abgleich**                                       | **18 min**                     |
| Entsperren bis Startseite                                 | 4,6 s                          |
| IndexedDB                                                 | 11 MB (ohne Belegdateien)      |

Eine Kleinst-UG erreicht 1 000 Buchungen in ein bis zwei Jahren.

## Nach den ersten Fixes aus #78

Dieselben Bücher (1 000 Buchungen), derselbe Rechner, sonst nichts laufend. `app/bench/results/2026-09-26-1000-*.json`.

|                                          | Grundlinie | Neuladen einmal nach dem Schub | + ID-Index in `SealedDocuments` |
| ---------------------------------------- | ---------- | ------------------------------ | ------------------------------- |
| **erster Abgleich**                      | 18 min     | 3,1 min                        | **24 s**                        |
| `refresh()`                              | 7,9 s      | 1,4 s                          | **24 ms**                       |
| die neuesten 100 Buchungen aktualisieren | 14,5 s     | 1,9 s                          | **1,0 s**                       |
| älteste Buchung lesen                    | 1,1 s      | 0,8 s                          | **< 1 ms**                      |
| älteste Buchung ändern                   | 2,4 s      | 1,4 s                          | **10 ms**                       |
| 1 000 Buchungen schreiben                | 15 s       | 8,6 s                          | 9,3 s                           |
| Entsperren bis Startseite                | 4,6 s      | 3,5 s                          | 3,0 s                           |

- **Neuladen einmal nach dem Schub:** Ein Schreiben plant `refresh()` 250 ms nach dem _letzten_ Schreiben (bei einem langen Schub spätestens alle 2 s), nicht 100 ms nach dem ersten; während eines Abgleichs gar nicht, der lädt am Ende selbst; ein Neuladen, das angefordert wird, während eines läuft, läuft danach noch einmal statt daneben.
- **Der Index:** `SealedDocuments` geht beim ersten Lesen einmal durch das Protokoll in Schlüssel → neueste Fassung und hält das mit den eigenen Schreibvorgängen aktuell; ein Eintrag von außen (Replikation) lässt das nächste Lesen neu durchgehen. Lesen gibt Kopien heraus.
- Noch offen: das Schreiben (etwa 9 ms je Datensatz: signieren, verschlüsseln, IndexedDB), das einmalige Durchgehen jedes Protokolls beim Entsperren und der Abgleich (24 s bei 1 000 sind noch alle Paare) – die nächsten Schritte aus #78.

## Warum

- `SealedDocuments` hat keinen Index: `get` sucht rückwärts ab den Heads, `all` geht durch das ganze Protokoll samt jeder überholten Fassung; jeder Eintrag ist ein IndexedDB-Zugriff, eine AES-GCM-Entschlüsselung und ein CBOR-Dekodieren. Der älteste Datensatz kostet das Zehnfache des neuesten.
- Jedes Schreiben plant `refresh()` 100 ms später, und das nächste Schreiben plant es erneut: Solange ein Import, ein Auslesen oder ein Abgleich schreibt, liest die App etwa zehnmal pro Sekunde alle Sammlungen neu. Schreiben wird quadratisch.
- Der Abgleich schreibt jeden Treffer und jede Rückfrage einzeln (jedes Update sucht zuerst die alte Fassung) und paart alle offenen Belege mit allen offenen Buchungen ohne Vorauswahl.

Was zu ändern ist, in dieser Reihenfolge, jeweils gegen diese Grundlinie gemessen: #78 (Neuladen einmal nach dem Schub, ein ID-Index in `SealedDocuments`, Abgleich-Kandidaten nach Betrag und Datum). Jenseits des Browsers: #79.
