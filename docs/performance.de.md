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

## Warum

- `SealedDocuments` hat keinen Index: `get` sucht rückwärts ab den Heads, `all` geht durch das ganze Protokoll samt jeder überholten Fassung; jeder Eintrag ist ein IndexedDB-Zugriff, eine AES-GCM-Entschlüsselung und ein CBOR-Dekodieren. Der älteste Datensatz kostet das Zehnfache des neuesten.
- Jedes Schreiben plant `refresh()` 100 ms später, und das nächste Schreiben plant es erneut: Solange ein Import, ein Auslesen oder ein Abgleich schreibt, liest die App etwa zehnmal pro Sekunde alle Sammlungen neu. Schreiben wird quadratisch.
- Der Abgleich schreibt jeden Treffer und jede Rückfrage einzeln (jedes Update sucht zuerst die alte Fassung) und paart alle offenen Belege mit allen offenen Buchungen ohne Vorauswahl.

Was zu ändern ist, in dieser Reihenfolge, jeweils gegen diese Grundlinie gemessen: #78 (Neuladen einmal nach dem Schub, ein ID-Index in `SealedDocuments`, Abgleich-Kandidaten nach Betrag und Datum). Jenseits des Browsers: #79.
