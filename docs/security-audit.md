# The security audit: what was checked, and the result

_Deutsch: [security-audit.de.md](security-audit.de.md)_

Belege decrypts a company's books in a browser, syncs them between own devices, talks to an invoicing app and runs a bridge next to bank, mail and keys. The audit plan ([#209](https://github.com/Le-Space/belege/issues/209)) looks at that as a whole, in eleven areas. This page is its written result: for each area what was checked, the evidence, and a verdict.

For what Belege protects against and what it cannot, in plain words, see [threat-model.md](threat-model.md). To report a weakness: [SECURITY.md](../SECURITY.md).

**The verdicts**

- **fine** – checked, and a test or the code named beside it keeps it so;
- **fixed** – it was not, and the change named beside it made it so;
- **accepted** – it stays as it is, for the reason given;
- **open** – not settled yet; the issue is named. A weakness that could be exploited is not described here or in any public issue before it is fixed ([AGENTS.md](../AGENTS.md)): it is "open, tracked privately".

**How to read the evidence.** A test named here runs in CI on every pull request that touches what it guards, on `main`, and before a release. "By reading" means somebody read the code and nothing asserts it automatically.

Last gone through: 2026-11-21, on `main` after v0.43.0.

## 1. Keys: where they live and for how long

- **fine** · The list of every key, how it is derived and where it lives: [keys.md](keys.md), "What comes from R" and "What is stored where".
- **fine** · Nothing unsealed at rest, in the build for the tests: `app/e2e/storage-scan.js` reads IndexedDB, `localStorage` and `sessionStorage` for every key the build names and for markers from the books, in six specs (passkey, receipts, upload, bank import, matching, export).
- **fixed** · The same in the production build: `app/e2e-production` builds as a deploy does, makes a passkey, reads a bank statement in, reloads, with device sync on, and then searches IndexedDB, `localStorage`, `sessionStorage` and the service worker's cache for every key of the session. That build names no key, so the spec listens where keys pass (`app/e2e/secret-spy.js`); `passkey-books.spec.js` checks that the listener hears the keys the test build names. ([#847](https://github.com/Le-Space/belege/pull/847))
- **open** · The production scan with the invoicing link switched on: the spec pairs no invoicing app (it needs a second app and a relay). The link's grants are kept in the sealed settings; the test build's scan does not cover a paired app either. Part of [#537](https://github.com/Le-Space/belege/issues/537)'s remaining work.
- **accepted** · Keys in memory after unlock. By reading: the browser's key objects are made non-extractable, but the bytes they are made from – the passkey's answer, the books' root, the derived keys – are held as byte arrays while the books are open, and are gone when the tab closes or reloads ([keys.md](keys.md)). "Pause network" closes connections and drops no key. A heap snapshot does not show what byte arrays hold, so this was read from the code, not measured. Reason: a page that works with the books needs their keys; what guards them is the device and the browser profile ([threat-model.md](threat-model.md)).
- **open** · A lock that drops the keys without a reload: not decided, [#538](https://github.com/Le-Space/belege/issues/538). Today a reload locks.

## 2. Sealing of records and receipts

- **fine** · Algorithm and nonces: a record's payload is sealed with AES-256-GCM under a fresh random 12-byte nonce for each entry (`app/src/lib/db-encryption.js`; `db-encryption.spec.js`, "never repeats a nonce"). The whole entry is sealed once more for replication with a nonce derived from the entry under keys of its own, so equal entries give equal blocks and nothing else does.
- **fine** · Key separation: the database, replication, blob and backup keys, the device proof's key, the bridge's key and the node's key are separate HKDF-SHA-256 derivations with their own labels (`database-keys.js`; `database-keys.spec.js`).
- **fine** · What is not sealed around a sealed payload: `sealed-blocks.spec.js` opens the store as the app does, writes into every collection and the file store, and sorts every block of the block store – a sealed entry, a sealed file chunk, or public by design: a database's manifest (a derived name, its type, its access controller), an access controller's list of public keys, an identity (public key and signatures), a file's root (the sealed size and the number of 1 MiB chunks). Anything else fails. ([#846](https://github.com/Le-Space/belege/pull/846))
- **accepted** · What the public blocks reveal: how many databases there are, which public keys may write, and for each receipt file its sealed size to the byte and its chunk count. Not what a database holds, not a name, not an amount. Reason: OrbitDB needs manifest, access controller and identity before any key is there; a file's size could only be hidden by padding, which is not done.
- **open** · The same classification of the browser's own block store after a session (the test above runs on the store in Node): [#537](https://github.com/Le-Space/belege/issues/537).
- **open** · Whether a sealed payload is bound to its place. By reading: record and file sealing use no associated data, and one key serves every collection, so the sealing itself does not say which collection or record a ciphertext belongs to. What an entry's signature and the second, entry-wide seal add against moving a payload has not been written down or tested. To review.
- **open** · A stated limit for random nonces under one long-lived key. The replication layer's derived nonces have their bound in the code; for the payload's random nonces no bound or reasoning is written down. To review, with the external look at the cryptography (below).
- **accepted** · A deleted receipt: deleting marks the record and never removes it; the sealed blocks of its file stay in the block store (`receipts/import.spec.js`, `prefetch.spec.js`). Reason: a later sync must not bring a deleted record back, and the books are kept for the retention period. Removing blocks on request is not built.
- **fine** · Large files: a file over 15 MiB is refused at intake; one is sealed whole in memory and stored in 1 MiB chunks (`receipts/import.js`, `blob-store.js`).

## 3. Databases

- **fine** · Every database goes through the sealed path: `sealed-blocks.spec.js` covers every collection in `COLLECTIONS`, settings and events included, with the books' access list, and reads the sources – `orbitdb.open(` is allowed in four files, each time with the sealing; a control database opened without it is caught. ([#846](https://github.com/Le-Space/belege/pull/846))
- **fine** · Names and addresses: a database's name is derived from the books' root with a label, 32 hex characters; it contains neither the DID nor the collection (`database-keys.js`; `store.spec.js`, "names the databases without the DID in them").
- **accepted** · An address is stable: who sees it twice knows it is the same database, and its manifest names the access controller. It says nothing of the contents. Reason: devices find each other's databases by address.
- **fine** · One passkey prompt opens all of them, and nothing without it: `passkey-books.spec.js` counts the WebAuthn ceremonies – one for an unlock, two for a new passkey.
- **fine** · Who can write: the access controller admits the books' identity and the members it lists, and checks each entry's writer (`store/books-access.js`; `books-identity.spec.js`, "another identity does not write to the books"; `books-access.spec.js`; `e2e/members.spec.js`).

## 4. Device sync

- **fine** · What travels is sealed in itself: entries and file chunks leave as the blocks classified under 2; heads and wants name hashes of sealed blocks.
- **fine** · The device proof, its construction and its limits: [device-proof.md](device-proof.md). An HMAC over both peer ids under a key from the books' root; it carries no nonce and no time, and rests on the connection having authenticated both peer ids. Tests: `device-gate.spec.js`.
- **fixed** · A stranger against the real stack: `e2e/stranger-peer.spec.js` runs a node with a key of its own and no proof against a device in a browser, through the relay, in the modes that listen at one. It tries every protocol the device answers to, by name, before and after a made-up proof, subscribes to the books' topics and wants a database's manifest. It is told the identify and relay protocols and `js-libp2p`; nothing else answers. In the mode without a relay it cannot reach the device. ([#850](https://github.com/Le-Space/belege/pull/850))
- **open** · Of that test: that own devices keep syncing while a stranger tries; the own network's mode, where devices meet at the bridge's relay; the bridge as a target ([#581](https://github.com/Le-Space/belege/issues/581)). A direct connection between browsers is set up over a signalling protocol the stranger is refused, so it does not get that far; that is shown by the refusal, not by a direct attempt. [#537](https://github.com/Le-Space/belege/issues/537).
- **open** · What an unproved peer can cost. A stream from an unproved peer is held for up to ten seconds and then aborted without its handler running; libp2p's limit on new inbound connections from one host in a second is set to 100. No bound on the streams one unproved peer may hold open is stated or tested. To review.
- **fine** · The QR path: an offer and an answer are signed with the device's key and checked before the connection is used (`sync/qr-link.js`, in `@le-space/libp2p-webrtc-qr`); the device then proves the passkey like any other (`e2e/device-qr.spec.js`, `device-qr-link.spec.js`).
- **open** · A test in this repository that a forged or changed code is refused; today that rests on the library's own tests.
- **accepted** · A removed or lost device: it keeps and can open what it has. It gets nothing new by sync (it is refused at the connection and by the access list, `device-sync.spec.js`, `books-access.spec.js`), and what is written later is out of its reach only after new keys for the books ([keys.md](keys.md), "New keys for the books"; `e2e/rekey.spec.js`). Reason: a device that once held the keys cannot be made to forget them; [device-proof.md](device-proof.md) says so under "Limits".

## 5. Relays

- **fixed** · What a relay sees: IP addresses, peer ids, times and byte counts of what it carries – and from identify only that a node can be reached: the identify and relay protocols and `js-libp2p`, no database, no browser, no app; the proof is not offered to a relay ([#222](https://github.com/Le-Space/belege/pull/222), [#223](https://github.com/Le-Space/belege/pull/223)). `e2e/device-sync.spec.js` reads what the test relay was told; `quiet-identify.spec.js`.
- **open** · The same recorded at a production relay and compared with the consent screen: not done; the test relay runs the same protocols, not the same software.
- **fine** · Nothing is stored or pinned at a relay, and Belege never asks: `no-discovery.spec.js` ("nothing provides, reprovides or pins"). Keeping a backup on Aleph is the storage service, asked for by the person ([backup.md](backup.md)).
- **accepted** · A hostile relay operator can withhold or delay, see who connects when and how much, and link the devices that meet through it. It cannot read or change what it carries (sealed, and the connection is end to end between the devices), and learns no database address from identify. Reason: that is what a relay is; "Ohne Relay, per QR" and the own network's mode are there for who does not want one.
- **fine** · How relay addresses are found: only registrations of the accounts named in the code are taken, the instance is confirmed as that account's, and only its own name is dialled; fixed relays stand in when none is found (`ucep/net.js`; `ucep/net.spec.js`). A forged answer costs reachability and metadata, not content.
- **fine** · The bridge's relay in the own network: anyone in the network may hold one of 32 places; it listens on one private address, never on all; its key and certificate are in a directory only the user can read (`bridge/src/lan-relay.js`; `bridge/test/lan-relay.test.js`, `relay-reservations.test.js`; `bridge/README.md`).

## 6. Foreign devices and libp2p protocols

- **fine** · The list of nodes, transports and services per network mode, and what is reachable without the proof: `no-discovery.spec.js` names every libp2p node the app can start – device sync in each mode, the books without sync, the invoicing link, the bridge on this machine, a restore – with its exact services, and starts each as the app does. ([#846](https://github.com/Le-Space/belege/pull/846))
- **fine** · No DHT, discovery, NAT probing or provide: the same spec checks that no node answers to such a protocol and that a provide has no router to go to, and fails when a node is made anywhere else, when Helia is given options instead of a node, or when a discovery package is imported or added.
- **fine** · What identify and gossipsub announce, and to whom: two identify lists, the full one only for a device that proved the passkey; gossipsub is not opened for anyone else, so no topic is named to a stranger (`quiet-identify.spec.js`, `device-gate.spec.js`, `e2e/stranger-peer.spec.js`).

## 7. The invoicing app link (UCEP)

- **fine** · Pairing and scopes from Belege's side: four `invoice:*` scopes, pairing by invitation or in band, grants kept in the sealed settings (`ucep/consumer.js`; `consumer.spec.js`, `e2e/ucep.spec.js`).
- **open** · Replay protection and the grant's format live in `@le-space/ucep`, a draft, and in the invoicing app; neither has been reviewed for this audit, and nothing in `docs/` describes the link's security. To review, in both repositories.
- **accepted** · The link's node has no device gate: it runs identify and the UCEP handlers and nothing of the books (`no-discovery.spec.js` pins its services). Reason: the other side is another person's app, not an own device; what it may do is in its grant.
- **open** · The network modes and the pause. The link is not started while the network is paused (`network-pause.spec.js`). Whether it keeps to "Ohne Relay, per QR" and the own network's mode is not tested, and it dials the public relays when the books name none. To check; the consent screen must say what holds.
- **open** · A hostile relay between the two apps, and a paired but hostile invoicing app: not gone through.

## 8. The bridge

Its own threat model is in [`bridge/README.md`](../bridge/README.md). The code since v0.5.0 was read in slice 4 of the review ([#557](https://github.com/Le-Space/belege/issues/557)).

- **fine** · It listens on 127.0.0.1 only and refuses to start on anything else; the `Host` header must name this machine; only the configured app origins may read answers. A request without an `Origin` – another program on this computer – gets no further without the token (`bridge/src/server.js`; `bridge/test/server.test.js`).
- **fine** · Pairing: a code of eight characters from 32 letters, valid ten minutes, once, five wrong tries; the token is 32 random bytes of which the bridge keeps only the hash (`pairing.js`; `pairing.test.js`, `pairings.test.js`).
- **accepted** · A token does not expire and is not rotated; a stolen one works until it is removed (`bridge/README.md`, "Not covered"). A device's rights over the stream lapse after 90 idle days (`grants.test.js`). Reason: the token is kept in the sealed settings of the books, and pairing again replaces it.
- **fixed** · Routes that answer without a token: `/health`, `/pair`, and a read share's link, whose 128-bit id is the key. `bridge/README.md` said "nothing but `/health`" in two places; it names all three now (this page's pull request).
- **fine** · Secrets: in the keychain through a hidden prompt, not in `bridge.json`, not in a process's arguments (`keychain.test.js`, `setup.test.js`, `windows-keychain.test.js`); several modules have a test that a secret is not in a log or an error (`mail.test.js`, `portals.test.js`, `paperless.test.js`, `filecoin-pay.test.js`).
- **open** · One test over every secret and every log line and error message; today it is module by module.
- **fine** · Mail: a sender counts as authenticated by the topmost `Authentication-Results` of the configured server only, with DKIM or SPF aligned to the sender or DMARC passing; every folder but trash, junk and drafts is read, read-only except moving one mail to the trash; TLS is required off this machine (`mail/auth-results.js`, `mail/imap.js`; `mail-parsing.test.js`, `mail.test.js`). Hostile mail and PDF content: fixed in [#439](https://github.com/Le-Space/belege/pull/439).
- **fine** · The language model: text is redacted before it leaves (`llm/redact.js`; `llm.test.js`, `redact-scorecard.test.js`); an answer is checked against a shape, and for a match it is a choice among candidates the app sent (`llm.test.js`, `extract.test.js`).
- **open** · A test that says in so many words that a model's answer never links or books by itself; today that follows from how the answers are used.
- **open, tracked privately** · Routes that take a URL or a host from the caller.
- **fine** · The read share: memory only, at most 24 hours, at most ten, at most 8 MiB, gone when the bridge restarts (`shares.js`; `shares.test.js`).
- **fine** · Limits: a body limit for every command; for a device over the stream, model calls a minute, tokens a day, backups an hour (`commands.js`, `grants.js`; `server.test.js`, `grants.test.js`).
- **accepted** · No rate limit on HTTP beyond the five pairing tries. Reason: HTTP is this machine only, and every call but pairing needs the token.
- **fine** · Portals: the bridge's browser stays on the portal's site and at most ten hosts the person confirmed; its profile with the live session is in a directory only the user can read, the password in the keychain (`portals/recipe.js`; `portals.test.js`, `portal-credentials.test.js`).
- **open** · The other findings of the review, none of them about keys or access: [#557](https://github.com/Le-Space/belege/issues/557). XML parsing in the bank and e-invoice readers was not reviewed for this audit. The bridge reached over libp2p: [#581](https://github.com/Le-Space/belege/issues/581), [#582](https://github.com/Le-Space/belege/issues/582).

## 9. The web app

- **fixed** · A Content-Security-Policy in every page: no script but the app's own files – no inline script, no `eval`, nothing from another host –, no plugin content, no form posted anywhere, one frame (`app/csp.js`). `e2e/csp.spec.js` checks the tag in the built pages and that the browser refuses an inline script, `eval`, a foreign script and an inline handler; the production spec checks the published pages. ([#856](https://github.com/Le-Space/belege/pull/856))
- **accepted** · What a meta policy cannot do: it cannot forbid being framed, and it does not list the hosts the page may connect to – any host over TLS, and this machine for the bridge. Reason: headers are not ours on an IPFS gateway; relays, Aleph's nodes and a hosted bridge's name are known only at run time ([threat-model.md](threat-model.md)). For the shared origin of a path-style gateway: advisory [GHSA-4796-j8r6-xw42](https://github.com/Le-Space/belege/security/advisories/GHSA-4796-j8r6-xw42), and the app opens no books there (`shared-origin.spec.js`).
- **fixed** · `{@html}`: there is none. The five uses, all QR codes, are drawn as markup (`Qr.svelte`); `no-raw-html.spec.js` fails on a new one, and on `eval`, a function made from a string, `innerHTML` or a hand-made script element in the sources. ([#856](https://github.com/Le-Space/belege/pull/856))
- **fine** · How mail text, PDF text, file names, QR payloads, URL parameters and synced records reach the page: as text in Svelte's `{…}`, which escapes; with no `{@html}` and no `innerHTML` in the sources there is no other way in. A QR code of a hostile text renders as squares (`no-raw-html.spec.js`).
- **fixed** · CSV and DATEV exports: a cell a spreadsheet would read as a formula is made inert (`export/inert.js` and its tests; [#439](https://github.com/Le-Space/belege/pull/439)).
- **fine** · File intake: the kind of a file is decided by its bytes; its name and declared type are ignored, other kinds refused (`receipts/import.js`; `import.spec.js`).
- **open** · The preview goes by the type stored with the receipt and does not look at the bytes again. A record that arrives by sync comes from a device or a member that holds the books' keys; that a stored type cannot make the preview do more than show a PDF, an image or XML as text has not been tested.
- **fine** · The service worker: it caches the app's own files of one version and nothing with data or from another origin; old caches go on activation; a new version waits until the person reloads (`pwa/cache-rules.spec.js`, `e2e/pwa.spec.js`). The production spec finds no key and no line of the books in its cache.
- **fixed** · Test hooks: `scripts/check-production-build.mjs` reads the built site – in CI and in the deploy, on the directory that is published – and fails when a file names one; the production spec checks that the page answers to none. Three timing switches of the backup tests were compiled into every build and are no longer. ([#847](https://github.com/Le-Space/belege/pull/847))
- **fine** · The unlock's console lines carry step names and durations, nothing of the books (`unlock-progress.spec.js`, `e2e/passkey-books.spec.js`).
- **open** · The other console output (about 25 places: warnings of the session, backup, node and receipts code) has no rule and no test over what it may say.
- **open** · The other findings of the review in receipts and the interface: [#540](https://github.com/Le-Space/belege/issues/540), [#541](https://github.com/Le-Space/belege/issues/541).

## 10. Build, dependencies and deploy

- **fixed** · Who can change what the domain serves, link by link: [deploy.md](deploy.md). Every action in every workflow is pinned to a commit; the tool that publishes comes from a lockfile of its own; a deploy takes only a release tag that is on `main`, also by hand; the two jobs that read the publishing key run in the environment `production`. `scripts/workflow-pins.test.mjs` keeps it so. ([#858](https://github.com/Le-Space/belege/pull/858))
- **fine** · Dependencies: exact versions and a frozen lockfile in every workflow of the site; Dependabot proposes new pins for the actions weekly (`.github/dependabot.yml`).
- **open** · Settings that are not files: a required reviewer on `production`, branch protection on `main`, secret scanning with push protection, Dependabot security updates. [#534](https://github.com/Le-Space/belege/issues/534).
- **open** · Three installs outside a lockfile in other chains – the bridge image, a try-out VM, the publishing of the packages – named in `workflow-pins.test.mjs` so that a new one fails.
- **accepted** · The Aleph account that signs the publish is shared with the other le-space.de sites, and DNS is in one Cloudflare zone. Reason: one small organisation; who holds either can change every one of its sites, and separating them would not change who that is.
- **open** · Verifiable builds. A visitor can compare the CID the domain serves with the one a release names ([deploy.md](deploy.md)); building a tag again does not yet give the same CID byte for byte.

## 11. Claims

Forty security statements of the consent screen, the READMEs and the docs were held against the code, each counted as true only where the code path was found.

**True in the code**, with what keeps it so:

- every database is opened sealed (`sealed-blocks.spec.js`); the vault in `localStorage` is sealed, with the passkeys' names beside it; the key labels the consent screen names are the ones in `database-keys.js`;
- no key in the clear in `localStorage`, `sessionStorage`, IndexedDB or the cache (the at-rest scans, area 1);
- without device sync the page connects to no one: no transport, no listen address, a node key made anew for each session (`network.js`, `no-discovery.spec.js`);
- each network mode contacts what the consent screen says: "Ohne Relay, per QR" asks neither Aleph nor a relay nor a STUN server; the own network's mode asks no public relay and no STUN server (`network-mode.spec.js`, `device-sync.spec.js`);
- a relay is told neither the databases nor the protocols, and the node calls itself `js-libp2p` (`quiet-identify.spec.js`, `e2e/device-sync.spec.js`, `e2e/stranger-peer.spec.js`);
- the relays are asked of Aleph only when the node goes online;
- the bridge listens on 127.0.0.1 only; its token is kept in the sealed settings of the books and never in `localStorage`, and the bridge keeps only its hash; only registered origins may read answers;
- the bank's certificate is pinned, and an account whose IBAN ending was not approved is not asked;
- text for a hosted model is redacted before every call (`llm.test.js`, `redact-scorecard.test.js`);
- the page loads no font, script or image from a third party, and renders no raw HTML (area 9);
- test hooks exist only in a build for the tests (area 9).

**Corrected with this page:**

- `bridge/README.md` said that without a token "nothing but `/health`" answers, and in another place "`/health` and `/pair`". Three routes answer: `/health`, `/pair`, and a read share's own link. Both places say so now.
- `bridge/README.md` said the bridge hands out "only PDFs and images". It also hands out e-invoices (XML), and a whole mail when it was sent to the accounting address.
- [device-proof.md](device-proof.md) said the device proof's key "is never sent and never stored". A member of the books gets it sealed in their key bundle; the page says so now.

**Open – the consent screen says less than the code does.** None of these makes the app less safe than it says in a way an outsider could use; each is a sentence that is out of date. Correcting them changes the consent screen for everybody (a new version, shown once more), so they go together:

- `localStorage`: the screen speaks of "public details of your passkey and three flags". There are about two dozen flags of the page by now, and beside them, not sealed: the names given to the passkeys, the address of the own network's relay, a per-device salt, the peer ids of own devices to dial after new keys, and counts of the last matching run. No key and no record of the books is among them (the scans), but "three flags" and "only public data" are no longer what is there.
- "The keys themselves are never stored": true for the books' owner. A member's browser keeps the member's key bundle, sealed, as the screen says two paragraphs later. To say: never stored unsealed.
- The mailbox: the screen says the bridge opens mailboxes read-only, and that the app gets only mails to the bookkeeping address. One command moves a mail to the trash, and the targeted search for a receipt reads the whole mailbox, as the bridge's README and the screen's own AI section say.
- A model on this computer: the screen says the bridge does not redact for it. It redacts until that was chosen in the setup – safer than said.
- The uses of the language model: the screen lists six; "Konto vorschlagen" is a seventh, described in [ai.md](ai.md).
- Hosts: "Who holds it?" asks delegated-ipfs.dev and ipwho.is, a restore without a gateway asks cid.contact and delegated-ipfs.dev, and the Akash reader has a second pair of nodes (Ecostake) beside the ones named. Each is named on its card, none under `consent.*` – which [AGENTS.md](../AGENTS.md) asks for before a host ships.
- The address of the own network's relay is said to be stored sealed in the settings; its copy in this browser is not mentioned.
- The invoicing link's node tells a relay which protocols it serves (area 7); nothing claims otherwise, and nothing says it.

**Open – not checked:** the list of STUN servers the consent screen names (a default of the WebRTC library); whether the pause also stops the calls that start and unlock a hosted bridge; that the bridge's log "records only numbers, never text", beyond the lines read; the hosted bridge's attestation statements.

## What is still to do

In the order it matters for closing the plan:

1. The decision on a lock ([#538](https://github.com/Le-Space/belege/issues/538)).
2. The consent screen's corrections (area 11), as one change with a new version.
3. The rest of the standing tests ([#537](https://github.com/Le-Space/belege/issues/537)): own devices syncing while a stranger tries; the own network's mode and the bridge as a target ([#581](https://github.com/Le-Space/belege/issues/581)); the browser's own block store; the production scan with the invoicing link on.
4. The repository settings of the deploy chain ([#534](https://github.com/Le-Space/belege/issues/534)).
5. The reviews not done: the invoicing link from both sides (area 7); placement of a sealed payload and nonce limits (area 2); the cost of unproved peers (area 4); XML parsing in the bridge (area 8). Areas 2 and 4 belong to the external review of the cryptography and the device gate the plan sets aside for later.
6. The open findings of the code review, by slice: keys [#555](https://github.com/Le-Space/belege/issues/555), backup [#558](https://github.com/Le-Space/belege/issues/558), sync [#554](https://github.com/Le-Space/belege/issues/554), bridge [#557](https://github.com/Le-Space/belege/issues/557), money [#539](https://github.com/Le-Space/belege/issues/539), receipts [#540](https://github.com/Le-Space/belege/issues/540), interface [#541](https://github.com/Le-Space/belege/issues/541).

What is tracked privately is not in this list.

## The tests that stand guard

| What must stay true                                              | Test                                                                                                               | Runs in                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| No key and no line of the books at rest, in the published build  | `app/e2e-production/production-build.spec.js`                                                                      | `e2e.yml`                           |
| … and in the build for the tests, in six flows                   | `app/e2e/storage-scan.js` in `passkey-books`, `receipts`, `upload-to-booking`, `bank-import`, `matching`, `export` | `e2e.yml`                           |
| No test hook in a production build                               | `scripts/check-production-build.mjs`                                                                               | `unit.yml`, `e2e.yml`, `deploy.yml` |
| Every database sealed; every block sealed or public by design    | `app/src/lib/store/sealed-blocks.spec.js`                                                                          | `unit.yml`                          |
| No DHT, discovery or provide; no node made elsewhere             | `app/src/lib/sync/no-discovery.spec.js`                                                                            | `unit.yml`                          |
| A stranger gets identify and nothing of the books                | `app/e2e/stranger-peer.spec.js`; `device-gate.spec.js`, `quiet-identify.spec.js`                                   | `e2e.yml`, `unit.yml`               |
| No raw HTML, no code from text; the policy stays strict          | `app/src/lib/no-raw-html.spec.js`, `app/e2e/csp.spec.js`                                                           | `unit.yml`, `e2e.yml`               |
| The bridge on 127.0.0.1 only, and nothing without the token      | `bridge/test/server.test.js`, `pairing.test.js`                                                                    | `bridge.yml`                        |
| Actions pinned, the deploy tool locked, a deploy only from a tag | `scripts/workflow-pins.test.mjs`                                                                                   | `bridge.yml`                        |
