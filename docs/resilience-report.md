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

**With the library's default circuit limits** (2 minutes and 128 KiB per circuit, `@libp2p/circuit-relay-v2`): pairing (0.3 s), the late joiner's sync and ten single bookings each way all pass at every size — and then the burst of 100 stalls partway and never completes: 48 of 100 arrived at 50 bookings, 37 at 500, 26 at 2 000, unchanged after ten minutes. The circuit hit its data cap mid-burst, the relay closed it, and replication did not resume.

**Why, measured on 2026-10-13** with the network watched during the burst (every connection and its streams on both devices, gossipsub's peer list, OrbitDB's heads exchanges; `app/bench/results/2026-10-13-resilience-replication-relay-50-*.json`): by the time of the burst the devices have a direct WebRTC connection, but gossipsub still runs over the relay's circuit — it opens its streams on the first connection to a peer and never moves them. When the relay closes the circuit, gossipsub keeps the peer and loses both streams; it opens new ones only for a _new_ connection, and OrbitDB's sync, which never saw a disconnect, exchanges no heads again. Whether the burst survives is then a matter of timing: a WebRTC connection young enough for its connect event to land after the close carries on (100 of 100 in 1.9–2.4 s in three runs); an established one does not (28 of 100 in a fourth, identical run). With the data cap lifted and the circuit's duration set to 5 s, then 8 s of quiet before the burst — the shape of an import after twenty minutes on a Le Space relay — nothing arrives at all: 0 of 100, every time. Filed as [belege#393](https://github.com/Le-Space/belege/issues/393); the right fix is in gossipsub, an app-side reconnect is the stopgap. An earlier version of this page blamed [orbitdb-relay#59](https://github.com/NiKrause/orbitdb-relay/issues/59); that relay bug is real but runs on the relay, and the benchmark's relay is a plain libp2p circuit relay with no orbitdb-relay code in it.

**With production-like limits** (the Le Space relays run 20 minutes and 10 GiB per circuit; `E2E_RELAY_UNLIMITED=1` lifts the test relay's cap), everything passes, and the numbers match the relay-free ones within noise:

| books (bookings) | pair (scan → "verbunden") | late joiner gets all of them | Mac → phone, median (p95) | phone → Mac, median (p95) | burst of 100 |
| ---------------- | ------------------------- | ---------------------------- | ------------------------- | ------------------------- | ------------ |
| 50               | 0.3 s                     | 0.9 s                        | 73 ms (180)               | 73 ms (94)                | 1.4 s        |
| 500              | 0.3 s                     | 5.5 s                        | 122 ms (139)              | 125 ms (148)              | 1.7 s        |
| 2 000            | 0.3 s                     | 22.5 s                       | 1.6 s (1.9)               | 1.2 s (1.4)               | 3.8 s        |

So the relay adds nothing measurable to latency on one machine; what matters is its circuit limit. A relay that caps circuits at the library's default will cut a bank import in half and leave the devices apart until the next reconnect — which is why the Le Space relays raise the limits. Their 20 minutes are a limit too, which is why #393 remains the thing to fix on the client.

### Over a real relay: the Le Space relay on Aleph (2026-10-14)

`BENCH_RELAY_ADDR` pointed the relay scenario at the Le Space relay deployed that morning (orbitdb-relay 0.10.10 on an Aleph VM, 20 minutes and 10 GiB per circuit), both devices still on one laptop, 50 bookings, and 21 minutes of quiet between the round trips and the burst — long enough for the circuit to expire while the direct connection idles, which is #393's production case. Three runs (`app/bench/results/2026-10-14-resilience-replication-relay-50-aleph-quiet21m*.json`); in the third, libp2p's own logs from both pages went into the result (`BENCH_LIBP2P_DEBUG`), with the relay's journal alongside.

| run | pair  | late joiner gets all 50 | Mac → phone / phone → Mac, median | burst of 100     | connection to the relay lost after | dialled again?            |
| --- | ----- | ----------------------- | --------------------------------- | ---------------- | ---------------------------------- | ------------------------- |
| 1   | 0.3 s | 2.4 s                   | 171 / 169 ms                      | 100/100 in 2.6 s | 28 s and 40 s into the quiet       | once, lost again at 268 s |
| 2   | 0.3 s | 2.5 s                   | 172 / 169 ms                      | 100/100 in 1.4 s | 8 min 19 s and 8 min 32 s          | no — 12 min without relay |
| 3   | 0.3 s | 2.4 s                   | 170 / 169 ms                      | 100/100 in 1.5 s | 20 s and 68 s                      | no — 20 min without relay |

What it says:

- **Across the internet the relay costs one round trip.** Single bookings took 0.17 s instead of 0.07 s: right after pairing gossipsub still rides the circuit through the relay (#393), so each booking went laptop → Aleph → laptop. The burst, minutes later, went over the direct WebRTC connection and arrived in full every time.
- **The circuit never reached its 20 minutes.** In every run both devices lost their WebSocket to the relay early, and the circuit with it. Who hung up, read from both logs: libp2p's connection monitor on either side — a ping every 10 s, and a ping unanswered for 5 s aborts the connection. The relay stayed healthy throughout (event-loop lag at most 0.14 s, CPU 1.5 %); its ping handler saw the browsers' 32 bytes arrive after 26 ms to 2.4 s. The laptop's uplink lost packets in bursts that hour (3 %, 55 %, 0 % in three samples; the local gateway loss-free). Not the relay, not its proxy: a lossy line and a 5-second rule.
- **A device that loses the relay never dials it again** (#403). `@libp2p/circuit-relay-v2` drops the reservation and the relay's keep-alive tag, libp2p's reconnect queue then finds nothing to redial, and the app has no fallback. Until the page reloads the device is invisible to any device not already connected to it; the two here kept syncing over WebRTC, which is why the burst still passed. In run 3 gossipsub moved to WebRTC within 4 s of losing the circuit, so the #393 stall did not occur here — the planned measurement, the circuit expiring at 20 minutes under an idle direct connection, is still open and needs a loss-free line or a device that redials.
- **Every lost connection reports a second close exactly 60 s later**, without an open in between. `@libp2p/websockets` tries to reset the socket with the reserved close code 1006, browser and Node both refuse, and the socket lingers a minute (upstream fix open: libp2p/js-libp2p#3625). Read the first close.

**Later the same day, without the quiet, at 50 and at 500** (`app/bench/results/2026-10-14-resilience-replication-relay-{50,500}-aleph-0-10-10.json`): the same relay, three round trips, then the burst at once.

| books | pair  | late joiner gets all | Mac → phone / phone → Mac, median | burst of 100     | where the burst ran                       |
| ----- | ----- | -------------------- | --------------------------------- | ---------------- | ----------------------------------------- |
| 50    | 1.8 s | 2.4 s                | 378 / 376 ms                      | 100/100 in 5.5 s | through the relay's circuit, WebRTC idle  |
| 500   | 3.3 s | 17.6 s               | 233 / 238 ms                      | 100/100 in 2.4 s | through the relay's circuit, WebRTC idle  |

This time the burst itself went through the relay: on both devices gossipsub's streams sat on the circuit for the whole burst and the WebRTC connection carried none (#393, seen from the other side — nothing closed the circuit, so nothing stalled). In a two-minute run the relay's 10 GiB and 20 minutes are far away, and no connection was lost. What it adds: through the production relay a burst of 100 costs two to five seconds instead of one and a half over WebRTC, and the afternoon's line was slower than the morning's — 233 to 378 ms per round trip instead of 170.

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

Measured again on **23 October 2026**, same machine, entries signed with Ed25519, and the storage bridge carrying two fixes that 0.23.0 does not have ([#172](https://github.com/NiKrause/orbitdb-storage-bridge/pull/172), [#174](https://github.com/NiKrause/orbitdb-storage-bridge/pull/174)). Docker (five Paperless containers) and Jameica were **running** for these runs, where the earlier ones had them stopped, so the figures are conservative. The 13 October numbers, with bridge 0.17.0, are in brackets.

| books (bookings) | IndexedDB | backup (click → "von Aleph aufbewahrt") | restore (click → "Wiederhergestellt") | unlock after reload | every booking back |
| ---------------- | --------- | --------------------------------------- | ------------------------------------- | ------------------- | ------------------ |
| 50               | 8.2 MB    | 0.4 s                                   | **0.9 s** _(1.4 s)_                   | 0.2 s               | yes, 0 lost        |
| 500              | 9.4 MB    | 0.4 s                                   | **5.4 s** _(40 s)_                    | 0.8 s               | yes, 0 lost        |
| 1 000            | 10.7 MB   | 0.6 s                                   | **8.5 s** _(126 s)_                   | 0.9 s               | yes, 0 lost        |
| 2 000            | 13.3 MB   | 2.6 s                                   | **17.7 s** _(—)_                      | 2.4 s               | yes, 0 lost        |

The backup is cheap and flat. The restore is now **linear** — twice the books, twice the time — and 2 000 bookings come back for the first time.

**They never used to, and not because they were slow.** `CarReader` hands out each block of a backup as a view into the single `ArrayBuffer` the whole CAR lives in, and IndexedDB's structured clone stores *the buffer behind a view*, not the view. So restoring a 3.7 MB backup asked the browser for 3.7 MB **per block** — about 7.5 GB for 2 016 of them — and it refused everything past roughly block 500 with `QuotaExceededError`. N blocks each carrying an archive that itself grows with N is quadratic, and that is the "grows faster than the books" this report kept describing. Reproduced with nothing but a `LevelBlockstore` in a blank page: the same 2 016 blocks cost 4 MB as standalone copies and all went in; as views into one buffer they cost 1 862 MB and stopped at block 494 ([#174](https://github.com/NiKrause/orbitdb-storage-bridge/pull/174)).

An earlier version of this table said 2 000 bookings "still did not finish in 10 min". **They finished in about two minutes, by failing.** Most of the backup never reached storage, the heads among it; the log then waited each missing head out on the network — some twenty seconds apiece, with no peer to answer — and gave up with `Entry's id (undefined) doesn't match the log's id`, a message about neither the cause nor the remedy. A CPU profile of those two minutes is 98.9 % idle. By then the books had been closed for the restore, so the page reloaded to its lock screen with nothing in it. The package now refuses outright when a block will not store, and closes the caller's books only once every block is safely in ([#172](https://github.com/NiKrause/orbitdb-storage-bridge/pull/172), and Le-Space/belege#480 for belege's side of it).

The earlier repair is still in these numbers and was still real: `restoreFromBlocks` used to put every block into the log storage of *every* database, 18 099 writes where 2 011 blocks exist ([#152](https://github.com/NiKrause/orbitdb-storage-bridge/issues/152), fixed in [#168](https://github.com/NiKrause/orbitdb-storage-bridge/pull/168) and [#170](https://github.com/NiKrause/orbitdb-storage-bridge/pull/170)). It was never the dominant cost, though, and the conclusion this report drew from what remained — that IndexedDB writes are inherently slow here and batching them is the next lever — was wrong twice over. Batching was tried and measured **slower** (33–35 s against 18–19 s at 500 bookings, reverted); the writes were not slow, there were a thousand times too many bytes in each.

Nothing is lost at any size. The unlock after the restore no longer grows the way it did (0.2 s, 0.8 s, 0.9 s, 2.4 s against 0.3 s, 4.4 s, 13.0 s): it was paying for the same bloated blockstore.

## The identity's curve: Ed25519 against secp256k1

OrbitDB verifies every entry it joins, and the identity's key decides what that costs: 3.45 ms per verification on secp256k1, 0.17 ms on Ed25519, measured through `@libp2p/crypto`, the path OrbitDB verifies through. In Node that is the whole story — a restore of 2 000 entries takes 11.8 s on secp256k1 and 5.6 s on Ed25519.

In this browser it is nearly invisible. Six runs on 23 October 2026, interleaved (Ed, secp, Ed, secp, …) so that any drift in the machine's load would hit both sides alike, 500 bookings each:

| | Ed25519 | secp256k1 |
| --- | --- | --- |
| restore | 17.6–19.2 s (median 19.1) | 16.1–19.7 s (median 18.2) |
| late joiner, no relay | 4.91–4.97 s (median 4.94) | 4.97–5.41 s (median 5.40) |

The restore does not care: the spans overlap almost entirely, and what little the curve saves disappears into IndexedDB. The late joiner does, slightly — about half a second of five, which is roughly a tenth, and the Ed25519 runs sit within 60 ms of each other while the others spread. Both are consistent with the theory: 500 entries save 1.65 s of verification at most, and only where storage is not already the bottleneck.

Belege signs with Ed25519 since this measurement. The DID does not change with it — it is the passkey's own P-256 key — so books written before stay readable and writable.

## The app from IPFS

`node bench/delivery.mjs`: a first visit as a browser makes it — the page, then every script and stylesheet it loads — from the domain (DNSLink → Aleph's gateway) and straight from a public gateway by the release's CID, three times each, median.

| from                                         | page TTFB | first visit, total   | files  | bytes   |
| -------------------------------------------- | --------- | -------------------- | ------ | ------- |
| https://belege.le-space.de/                  | 45 ms     | 116 ms (cold: 0.9 s) | 1 + 11 | 108 232 |
| https://ipfs.aleph.sh/ipfs/bafybeidv34…ut6y/ | 51 ms     | 139 ms (cold: 0.4 s) | 1 + 11 | 108 232 |

The same 108 232 bytes from both: the domain serves exactly the CID the release notes name, which anyone can check with `dig TXT _dnslink.belege.le-space.de`. One finding on the way: the build references its assets by absolute path (`/_app/…`), so on a _path_ gateway (`…/ipfs/<cid>/`) a browser would ask for them at the gateway's root; a subdomain gateway (`<cid>.ipfs.inbrowser.link`) has no such problem, which is the form the product page links. The measurement resolves the assets under the CID as a subdomain gateway does; a build with relative paths would make every gateway work and is proposed separately.

## What this does and does not show

- Measured: replication latency and throughput between two browsers on one machine, with and without a relay; the behaviour across a partition; backup and restore times by size; what the app weighs and how fast it arrives from two sources. Every run is reproducible with the commands above; the JSON files hold the raw numbers.
- Not measured: real networks beyond one relay across the internet (above, both devices on one machine — NAT traversal between two networks, mobile links), more than two devices, receipt files (the books here hold bookings only — a year of PDFs adds megabytes to the archive), a real Aleph (the fake answers from memory), and browsers other than Chromium.
- Honest weak spots, all measured rather than assumed: the burst stall over a default-limited relay; the 23 s reconnect after a pause; the superlinear restore.

## Earlier: how the books behave as they grow

The books benchmark (`pnpm bench:books`, [performance.md](performance.md)) measured the store itself on 26 September 2026: after the first fixes of #78, 1 000 bookings write in 9 s, `refresh()` takes 24 ms, the first matching run 24 s, unlock to Home 3.0 s, 11 MB in IndexedDB.
