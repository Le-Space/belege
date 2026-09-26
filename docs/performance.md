# Performance

How the books behave as they grow, measured. German: [performance.de.md](performance.de.md).

## The benchmark

`pnpm --filter @belege/app bench:books` (`BENCH_SIZES=1000,10000` by default) builds the E2E build, opens it in Chromium with a virtual passkey, writes made-up books through the real store (`window.__belegeE2E.bench`, only in E2E builds) and times what the app does with them. Every name and amount is invented. Results land in `app/bench/results/<date>-<size>.json`. It is not part of CI: at today's speed, 10 000 bookings take hours.

The books per size _n_: _n_ bookings over a year on two accounts, about 0,6 _n_ read receipts (80 % of them for a booking), _n_ Verlauf entries, and a re-sync that updates the newest tenth of the bookings once.

## Baseline, 26 September 2026 (before any fix)

1 000 bookings, 590 receipts, 1 000 events. Intel i9-9880H (8 cores), headless Chromium; another test suite ran on the machine at the same time, so the times are somewhat high.

|                                                    |                             |
| -------------------------------------------------- | --------------------------- |
| write 1 000 bookings / 590 receipts / 1 000 events | 15 s / 13 s / 26 s          |
| update the newest 100 bookings                     | 15 s (145 ms each)          |
| `refresh()` (all lists, every classification)      | 7,9 s; 1,9 s after matching |
| read the newest / the oldest booking               | 0,1 s / 1,1 s               |
| update the oldest booking                          | 2,4 s                       |
| **first matching run**                             | **18 min**                  |
| unlock to Home                                     | 4,6 s                       |
| IndexedDB                                          | 11 MB (no receipt files)    |

A micro company reaches 1 000 bookings in one to two years.

## Why

- `SealedDocuments` has no index: `get` walks back from the heads, `all` walks the whole oplog with every superseded version; each entry is an IndexedDB read, an AES-GCM decrypt and a CBOR decode. The oldest record costs ten times the newest.
- Every write schedules `refresh()` 100 ms later, and the next write schedules it again: while an import, an extraction or a matching run writes, the app re-reads every collection about ten times a second. Writing becomes quadratic.
- Matching writes every match and question one by one (each update first scans for the old version) and pairs all open receipts with all open transactions without pre-selection.

What to change, in this order, each measured against this baseline: #78 (refresh once after a burst, an id index in `SealedDocuments`, matching candidates by amount and date). Beyond the browser: #79.
