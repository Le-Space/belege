# Resilience, measured

How the books survive: two devices of one passkey replicating with and without a relay, a network partition with writes on both sides, a browser that lost everything getting its books back from the archive, and the app itself arriving from IPFS. Every number here was measured, with made-up books; what was not measured says so. German: [resilience.de.md](resilience.de.md).

## The benchmark

`pnpm --filter @belege/app bench:resilience` (`RESILIENCE_SIZES=50,500` by default; `RESILIENCE_SCENARIOS=relay,qr,partition,recovery`, `RESILIENCE_ROUNDS=10`) builds the E2E build, starts the local test relay (`e2e/relay.js`) and, for the recovery scenario, the real bridge in test mode against a fake Aleph on 127.0.0.1 (`@belege/bridge/testing/aleph`). Two browser contexts stand for a Mac and a phone with one synced passkey (virtual authenticators, `e2e/devices.js`). Books of _n_ bookings are written through the real store (`window.__belegeE2E.bench.putMany`, E2E builds only) and every timing is read from the receiving store itself (`bench.count`), never from the UI. Results land in `app/bench/results/<date>-resilience-<scenario>-<size>.json`; `node bench/delivery.mjs` writes `<date>-delivery.json`. Neither is part of CI.

Machine for every run below: Intel i9-9880H (8 cores, 32 GB), headless Chromium, macOS, 13 October 2026, Belege at `bench/resilience` (v0.9.1 + the benchmark). Both devices and the relay run on the same machine: the numbers measure the app, the store and the protocols, not a network — add your network's round trip to each.

## Replication without a relay (two QR codes)

The Mac shows an invite, the phone scans it and answers, the Mac takes the answer: a direct WebRTC connection, no relay, no STUN. The test records every request and WebSocket of both contexts that leaves the machine: **0** in every run.

| books (bookings) | pair (invite → both "verbunden · direkt") | late joiner gets all of them | one booking Mac → phone, median (p95) | phone → Mac, median (p95) | a burst of 100 arrives in |
| ---------------- | ----------------------------------------- | ---------------------------- | ------------------------------------- | ------------------------- | ------------------------- |
| 50               | 1.4 s                                     | 1.4 s                        | 94 ms (268)                           | 73 ms (99)                | 1.5 s                     |
| 500              | 0.9 s                                     | 5.4 s                        | 126 ms (136)                          | 130 ms (146)              | 1.8 s                     |
| 2 000            | 0.9 s                                     | 23.7 s                       | 1.9 s (2.1)                           | 1.4 s (1.7)               | 4.1 s                     |

A single booking crosses in well under a second up to 500 bookings. At 2 000 the round trip grows to 1.4–1.9 s: not the transport — the burst of 100 still arrives in 4 s — but the receiving store, which walks its log again after an entry from elsewhere ([performance.md](performance.md), the open part of #78). The late joiner's full sync is linear: about 12 ms a booking.

## Replication over a relay

Both devices reach each other through a circuit relay (what the public Le Space relays and the bridge's LAN relay are), then try to upgrade to a direct connection.

**With the library's default circuit limits** (2 minutes and 128 KiB per circuit, `@libp2p/circuit-relay-v2`): pairing (0.3 s), the late joiner's sync and ten single bookings each way all pass at every size — and then the burst of 100 stalls partway and never completes: 48 of 100 arrived at 50 bookings, 37 at 500, 26 at 2 000, unchanged after ten minutes. The circuit hit its data cap mid-burst, the relay closed it, and replication did not resume on a new one. This is the known weakness tracked as [orbitdb-relay#59](https://github.com/Le-Space/orbitdb-relay/issues/59) (heads sync does not retry after a hang-up) — measured here rather than assumed.

**With production-like limits** (the Le Space relays run 20 minutes and 10 GiB per circuit; `E2E_RELAY_UNLIMITED=1` lifts the test relay's cap), everything passes, and the numbers match the relay-free ones within noise:

| books (bookings) | pair (scan → "verbunden") | late joiner gets all of them | Mac → phone, median (p95) | phone → Mac, median (p95) | burst of 100 |
| ---------------- | ------------------------- | ---------------------------- | ------------------------- | ------------------------- | ------------ |
| 50               | 0.3 s                     | 0.9 s                        | 73 ms (180)               | 73 ms (94)                | 1.4 s        |
| 500              | 0.3 s                     | 5.5 s                        | 122 ms (139)              | 125 ms (148)              | 1.7 s        |
| 2 000            | 0.3 s                     | 22.5 s                       | 1.6 s (1.9)               | 1.2 s (1.4)               | 3.8 s        |

So the relay adds nothing measurable to latency on one machine; what matters is its circuit limit. A relay that caps circuits at the library's default will cut a bank import in half and leave the devices apart until the next reconnect — which is why the Le Space relays raise the limits, and why #59 remains the thing to fix on the client.

## Partition: writes on both sides, merged after

Books of 50 on both devices over the relay; the phone pauses its network ("Alles pausieren" in the badge's menu — the connection gater closes, every connection is hung up); both sides write 20 bookings; the phone resumes.

| step                                 | measured                                       |
| ------------------------------------ | ---------------------------------------------- |
| while apart: Mac holds / phone holds | 70 / 70 (50 + its own 20, none of the other's) |
| resume → "connected" again           | 23.5 s                                         |
| both hold all 90 after reconnecting  | 0.4 s                                          |
| bookings lost                        | **0** — both stores hold the same 90 ids       |

Convergence after the reconnect is immediate; what costs is the reconnect itself, 23–25 s in every run: the relay redial after a pause. That is the number to improve, and it belongs to the connection code, not to the merge.

## Recovery: a browser that lost everything

One browser, the bridge in test mode, the fake Aleph. Books of _n_ bookings, "Jetzt sichern" (the storage bridge seals the database and stores it), then `localStorage`, `sessionStorage` and every IndexedDB are deleted and the bridge is stopped. The same passkey opens empty books; the account's address alone lists the backup; "Wiederherstellen" fetches it, puts the blocks back and joins the heads; the page reloads, the passkey unlocks.

| books (bookings) | IndexedDB | backup (click → "von Aleph aufbewahrt") | restore (click → "Wiederhergestellt") | unlock after reload | every booking back |
| ---------------- | --------- | --------------------------------------- | ------------------------------------- | ------------------- | ------------------ |
| 50               | 8.0 MB    | 0.3 s                                   | 1.4 s                                 | 0.4 s               | yes, 0 lost        |
| 500              | 9.2 MB    | 0.5 s                                   | 40 s                                  | 4.9 s               | yes, 0 lost        |
| 1 000            | 10.5 MB   | 0.7 s                                   | 126 s                                 | 13.0 s              | yes, 0 lost        |
| 2 000            | —         | (not reached)                           | **did not finish in 10 min**          | —                   | —                  |

The backup is cheap and flat. The restore is not: 1.4 s at 50, 40 s at 500, 126 s at 1 000 — roughly three times the time for twice the books — and 2 000 did not finish within the benchmark's ten-minute limit. The unlock after the restore grows with it (0.4 s, 4.9 s, 13 s): the first walk of every log, as [performance.md](performance.md) describes. The cost is in `restoreFromBlocks` of the storage bridge (0.17.0): for every database it walks every block of the backup once more and joins the heads into the sealed log one by one, each join reading back through entries it just wrote. Nothing is lost — the 500-booking restore brought every booking back — but at today's growth a company's third year would wait minutes. This is the next thing to fix, tracked as [orbitdb-storage-bridge#152](https://github.com/NiKrause/orbitdb-storage-bridge/issues/152).

## The app from IPFS

`node bench/delivery.mjs`: a first visit as a browser makes it — the page, then every script and stylesheet it loads — from the domain (DNSLink → Aleph's gateway) and straight from a public gateway by the release's CID, three times each, median.

| from                                         | page TTFB | first visit, total   | files  | bytes   |
| -------------------------------------------- | --------- | -------------------- | ------ | ------- |
| https://belege.le-space.de/                  | 45 ms     | 116 ms (cold: 0.9 s) | 1 + 11 | 108 232 |
| https://ipfs.aleph.sh/ipfs/bafybeidv34…ut6y/ | 51 ms     | 139 ms (cold: 0.4 s) | 1 + 11 | 108 232 |

The same 108 232 bytes from both: the domain serves exactly the CID the release notes name, which anyone can check with `dig TXT _dnslink.belege.le-space.de`. One finding on the way: the build references its assets by absolute path (`/_app/…`), so on a _path_ gateway (`…/ipfs/<cid>/`) a browser would ask for them at the gateway's root; a subdomain gateway (`<cid>.ipfs.inbrowser.link`) has no such problem, which is the form the product page links. The measurement resolves the assets under the CID as a subdomain gateway does; a build with relative paths would make every gateway work and is proposed separately.

## What this does and does not show

- Measured: replication latency and throughput between two browsers on one machine, with and without a relay; the behaviour across a partition; backup and restore times by size; what the app weighs and how fast it arrives from two sources. Every run is reproducible with the commands above; the JSON files hold the raw numbers.
- Not measured: real networks (NAT traversal success, mobile links), more than two devices, receipt files (the books here hold bookings only — a year of PDFs adds megabytes to the archive), a real Aleph (the fake answers from memory), and browsers other than Chromium.
- Honest weak spots, all measured rather than assumed: the burst stall over a default-limited relay; the 23 s reconnect after a pause; the superlinear restore.

## Earlier: how the books behave as they grow

The books benchmark (`pnpm bench:books`, [performance.md](performance.md)) measured the store itself on 26 September 2026: after the first fixes of #78, 1 000 bookings write in 9 s, `refresh()` takes 24 ms, the first matching run 24 s, unlock to Home 3.0 s, 11 MB in IndexedDB.
