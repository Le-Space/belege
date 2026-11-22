# Changelog

All notable changes to Le Space Belege. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The Verlauf from every page, and a wallet sync says what it replaced** (#967). The header has a clock beside the gear that opens the Verlauf; Einstellungen has a Verlauf tile that says what it holds, with a link straight to each group (Auslesen, Abgleich, Abruf, Entscheidung). When a wallet's sync takes bookings out because another entry replaced them (#898), its result adds "Ersetzt: n", linked to the Verlauf's Abruf; so does the note of "Alle Wallets synchronisieren", which before looked like a sync that did nothing.

### Changed

- **A NEAR storage deposit made for a swap is part of the swap** (#968; `@le-space/chains` 0.8.0, `@le-space/ledger` 0.3.1). Before a swap the wallet or the DEX registers the account at the contracts it touches (`storage_deposit`, `tokens_storage_deposit`), each in a transaction of its own; each was a booking of its own in Zahlungen, "ohne Konto". Now a deposit the account sent at most five minutes before a swap, to a contract the swap involves – a token given or got (wNEAR counts as NEAR) or the DEX that took it – is a cost of that swap, as its gas: the reader gives it as a fee naming the swap's transaction (`partOf`), and so the gas of its own transaction; the swap's sides name what the deposits kept (`storage`), so its legs, its gas and its Eigenbeleg say so. In the app it is a network fee shown with the swap, needs no receipt of its own, takes the account the swap's gas is booked on (`booking.via: 'swap'`, before the network fee rule) and goes into the DATEV export as its own fee line on that account. A refund (`storage_withdraw`, `storage_unregister`) is never tied; a deposit that matches no swap stays as it is. A booking an earlier sync made of such a deposit is changed in place on the next sync, not booked twice. It needs a bridge of this version and one more "Synchronisieren".
- **The ruble at the Bank of Russia's rate for every day** (Le-Space/eigenbeleg-agent#72; `@le-space/rates` 0.8.0). A rate of RUB in euros, and the leg from the euro into a document in rubles, now come from the Bank of Russia's official rate valid on the day also before 2022-03-01, when the ECB still quoted the ruble: the ruble's own central bank for every day, the ECB for the other official currencies. `ECB_CURRENCIES` no longer lists RUB; `TARGET_CURRENCIES` still does. The source texts in the app and on the consent screen no longer say the Bank of Russia stands in where the ECB has no rate.

### Fixed

- **"Konto vorschlagen" over the bridge's own node with a large chart of accounts** (#969). The request carried up to 600 accounts of a read-in chart; with names of DATEV length it was larger than UCEP's 64 KiB once sealed, the bridge's node reset the stream, and the call went to the bridge on this computer with the token of an earlier pairing, which said "Die Bridge kennt dieses Gerät nicht (neu koppeln)". The accounts now fit a budget of 44 KiB before sealing and go by what the payment makes likely: learned accounts, accounts whose name shares a word with the payment, the kind of its direction (costs for money out, revenue for money in), then transit, private and tax accounts, then the other kind. A call too large for the stream is not sent and not handed to another bridge: it says "zu groß für den Knoten der Bridge". A 401 over HTTP now names the bridge on this computer, not this device in general.
- **A reference value is named as one on the Eigenbeleg and the Kontoauszug** (`@le-space/eigenbeleg` 0.6.1; Le-Space/eigenbeleg-agent#72). The rate's source of an asset valued at its issuer's reference value (`@le-space/rates` `referenceRate`, "Referenzwert von …, Stand <day> (kein Börsenkurs)") was cut at its day and read "Referenzwert von …, Stand", with a second leg "… , Stand × EZB-Referenzkurs EUR/CHF". It now reads "Referenzwert von … (kein Börsenkurs)", in EUR and in another currency. The Kontoauszug's note said "zum Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken)" also where the positions were valued at a reference value; it now names the reference value, and both where a statement has both. A statement's section says so too (`marketRate`, `referenceValues`; each row's optional `rateSource`).
- **A document in rubles no longer says that days before 01.03.2022 went through the ECB** (`@le-space/eigenbeleg` 0.6.1). Since `@le-space/rates` 0.8.0 the ruble is at the Bank of Russia's rate on every day; `conversionText('RUB')` dropped its "(bis 01.03.2022 zum Euro-Referenzkurs der EZB …)".

## [0.51.0] – 2026-11-22

### Added

- **A daily check that Aleph answers a restore's question** (`aleph-smoke.yml`). A restore on an empty device asks Aleph's index whether a vault exists for the passkey (#406); when Aleph does not answer, the restore stops rather than make new books, and so does its E2E spec. Once a day, the workflow asks the same, free of charge, for a passkey nobody has and expects "none" within 20 s. When the E2E restore fails, this run says whether Aleph was down. The unit tests skip the check, so they never dial out.
- **The second leg of a rate into another currency on its own** (Le-Space/eigenbeleg-agent#72; `@le-space/rates` 0.7.0). `perEuro(currency, date)` on the rate service answers how many units of a currency one euro is on the day – the ECB reference rate of the day or the last before it, for RUB the Bank of Russia's – from the same window and cache as the rate into that currency. For a value already in euros, such as a reference value set by hand, that goes into a document in another currency.
- **The company's own logo on its own receipts** (#906, third slice; `@le-space/eigenbeleg` 0.6.0). Under Einstellungen → Firma a PNG or JPEG of up to 512 kB is chosen beside the company's name. Belege keeps the picture as the documents carry it (a PNG laid on white, a JPEG without its EXIF and colour profile) in the sealed `settings` collection, synced like every other setting. Every Eigenbeleg the app makes from then on carries it top right in the head: the Eigenbeleg of one booking and the statements of Aleph, Akash, Filecoin Pay and travel. Receipts made before stay as they are; "Auf den Belegen zeigen" switches it off without removing it. A file that cannot be a logo (SVG, GIF, CMYK, too large, a banner) is refused with the reason. The account statements of the monthly export are not the company's own receipts and carry none. `statementLayout` of `@le-space/eigenbeleg` takes `issuerLogo` like the package's other documents.
- **The company's logo as a letterhead, the chain's mark by document** (#906; `@le-space/eigenbeleg` 0.6.0). On an Eigenbeleg the company's logo is now large, as in a German business letter: top right, up to about 70 × 25 mm, the text starting below it at 45 mm from the top (DIN 5008, form B); the chain's mark there is very small beside the title. A Kontoauszug or Verbrauchsauszug is not the company's own receipt: it carries no company logo, and the chain's mark beside its title is larger.

### Changed

- **A document typeface for the PDFs** (#951; `@le-space/pdf` 0.3.0). Eigenbelege, statements and every other PDF are set in IBM Plex Sans (regular, and semibold as the bold) instead of DejaVu Sans Condensed: the same width, so no column moves, figures of one width, and the same scripts (Latin, Cyrillic, Greek). Hashes and addresses stay in DejaVu Sans Mono, Arabic in Noto Sans Arabic. For a page with its own asset loader (`useAssetLoader`) the two names change: `IBMPlexSans-Regular.ttf` and `IBMPlexSans-SemiBold.ttf`.
- **The hosted bridge on Aleph boots the bridge of v0.50.0, and the books' own image is built from it** (#898, #923). The shared image (STORE `4a55c51c…`) and the plain image an own image is sealed from (`444782e9…`, published for the attested builder in NiKrause/relay-button#262) were built from the tag v0.50.0; before, both held the bridge of 19 November, without the NEAR swap reader and without the handling of the bookings it replaced. An own image built before says so on the card: "Neu bauen", then start a new VM – a running VM keeps the image it started with.
- **A document in US dollars converts from the euro at the ECB's reference rate, like every other currency but the ruble** (`@le-space/rates` 0.7.0, `@le-space/eigenbeleg` 0.6.0; [eigenbeleg-agent#72](https://github.com/Le-Space/eigenbeleg-agent/issues/72)). `rate(asset, date, { currency: 'USD' })` took CoinGecko's own USD price of the 00:00 UTC snapshot where CoinGecko answered, and the ECB only where it did not; one document could so mix two ways of getting to dollars. Now the dollar is always the euro rate times the ECB reference rate of the day (or the last before it), with both legs in the answer (`eurRate`, `fx: { source: 'ecb', … }`) – the ruble stays with the Bank of Russia. A USD document's values change by that difference; `conversionText('USD')` says the same as for CHF and no longer names CoinGecko. Aleph credits in a USD document keep Aleph's own USD price per credit, without a rate.

### Fixed

- **A new device that restores its passkey by QR or in the own network no longer asks Aleph** (#957). "Ohne Relay, per QR" and "Nur im eigenen Netz" say that nothing asks Aleph, but a restore on an empty device still read the passkey's vault and its memberships from Aleph's index. Without internet in the Wi-Fi, or with Aleph down, it stopped with an error, and the phone could not get in. Now a restore in these modes does not ask. The question before new books says that Aleph was not asked and why. "Bücher dieses Passkeys öffnen" opens the books the passkey made, and the QR connection brings their content. A passkey added to books later still needs the vault from Aleph or the recovery words, as the question says. The new browser spec `device-qr-restore` covers a phone with nothing but the synced passkey. It restores, connects by QR and gets the laptop's booking, and neither browser sends a request beyond this machine.
- **Pairing with the invoicing app no longer fails when WebRTC does not come up.** Its invitation names a WebRTC address through the relay beside the relayed one. When WebRTC did not come up, libp2p went on to the relayed address and refused it as a duplicate of the relayed connection it had signalled WebRTC over – and the pairing failed with "Remote closed connection during opening", although that connection was open. `@le-space/ucep` 0.2.0-draft.6 uses the open connection then (Le-Space/ucep-js#10). It also takes a caller's own time limit for a call (Le-Space/ucep-js#11), which Belege had patched in; the patch is gone. This is why the browser spec `ucep` failed now and then (#916).
- **A receipt file whose blocks were not all here is no longer lost for the backup chain** (#558). A device that had a receipt by sync before its file's blocks arrived put the receipt into the next backup and counted the file as shipped, so no later increment carried it and a restore lacked it for good. A file now goes into a backup only whole, its root and every chunk; one this device has only in part is left out, not counted as shipped, and the next increment after its blocks have arrived carries it. Until then it makes no increment of its own.
- **An increment no longer reads every log from the start** (#558). To know what the chain had shipped, each increment walked every database's log from the heads it shipped last down to the first entry – one read per entry, on every automatic backup. What the chain has shipped is now kept for the session and grows with each increment; a log is walked only for heads the session has not seen (its first increment, or a chain gone back).
- **The backup chain's record no longer grows with the receipt files** (#558). It held the list of every receipt file the chain had ever shipped and was written with every backup – each write a log entry that the next increment shipped and every device synced. The files are now kept beside it, one short record per backup of the chain with the files that backup added; a chain from before moves its list there when it is next loaded, and a new full backup clears the lists of the chains before it.
- **docs/backup.md: the upload path is described as it is** (#558). The Technical section still named the IPFS host without a key as the only way up; it now names the API node with the STORE in the same request, the bridge, and the IPFS host only as the fallback (German twin too).
- **The key actions, the recovery words and the book move, after a review of the books' vault (#555).** Adding a passkey under Einstellungen → Schlüssel, and renewing the vault or giving the books new keys, asked the authenticator more than once from one click; Safari refuses the second prompt and left a passkey behind on the authenticator each time. Each further prompt now waits for "Weiter" in a step that says what it is for – for the passkeys that stay, which one. A passkey added while the network is paused, with the vault kept on Aleph, is added and said so; before, the card showed an error for a passkey that had been added. Recovery words with the network on no longer replace what this browser knows of the books' vault: the passkeys removed here stay refused, and the passkeys keep their names. With two sets of books in one browser, the words of the second are no longer taken for wrong ones by the first. A move of books that had themselves been taken over can be carried on when it is cut short, and a moved book no longer says its keys are kept on Aleph, names a successor or keeps the old books' members: those stay with the old books (the move card lists them). New keys for the books keep the vault published, as before. Three findings of the review are still open (#555).
- **Two vaults of the same books no longer lock a later passkey out, and a restore asks before it makes books (#555).** A device set up before the books' vault was kept on Aleph, or with the network paused, made a vault of its own for the same books; once it published it, a passkey that only the other vault had was refused on an empty device as removed, and stayed refused in that browser. Before a device changes or publishes its vault now, it reads the books' index on Aleph and takes the vault there when it is another one of the same books that its passkey opens, rather than publishing over it; a passkey only its own vault had keeps opening the books in this browser, and Einstellungen → Schlüssel names it to be added again. When the vault there lacks this passkey, nothing is published. On an empty device such a refusal is no longer remembered as a removal. "Wiederherstellen" with a passkey for which neither the browser nor Aleph has books – or with the network paused – now asks before it opens the books that passkey makes, and says why they would be empty; "Abbrechen" opens and keeps nothing.
- **A backup from before the books' own identity comes back under a later passkey (#555).** Books made before 0.22 were written by the passkey that made them; a backup of them was matched by addresses that hold that passkey's DID. Restored on an empty device with a passkey added later, or one made with the recovery words, it was refused as "databases these books do not have". Such a backup is now recognised by its databases' names, the writer is read from the backup's own access controller, and the next unlock moves the books in under it.

## [0.50.0] – 2026-11-21

### Added

- **A payment that is partly private use is booked in two parts** (#935). Under a payment's "Konto" a private share takes a percentage and an account; the DATEV export then writes two bookings that add up to the payment to the cent – the business part on the expense account with its BU key, the private part on the share's account without a key – and the overview names both. The share is suggested: what was confirmed for this vendor last time (also "whole"), else a rule of the books under Einstellungen → DATEV with one percentage for a landline or fixed internet connection and one for mobile and everything else, applied to bills whose payment or receipt names such a service. The rule is off until a percentage and an account are set; nothing is split without a confirmation. The language model's account suggestion is unchanged.

### Fixed

- **NEAR that was wrapped is no longer counted twice in books that were read before 0.49** (#898; `@le-space/chains` 0.6.1). Since 0.49 the NEAR handed to the wrap contract is part of the swap that follows, not a payment of its own. Books that had synced the wallet before kept that payment, and the next sync added the swap's NEAR beside it. The NEAR reader now names the entries it leaves out for this reason (`superseded`), and the wallet sync takes the bookings an earlier sync made of them out: only that wallet's own, only the ids named, a link to a receipt undone, and an entry in the Verlauf ("Wallet-Buchungen ersetzt"). The other bookings of the transaction are brought up to date in place, as before. It needs a bridge of this version and one more "Synchronisieren".

## [0.49.2] – 2026-11-21

### Added

- **A BU key says what it means.** Under a payment's "Konto" the key field names the key in words ("9 – Vorsteuer 19 %", "94 – § 13b UStG (Reverse Charge) …") – in the list it offers and under the field for the key that is in it; a key without words on record says so. The list offers the books' own keys first and DATEV's standard keys after (2, 3, 8, 9, 11, 18, 19, 40, 91, 94). A key the books' settings give another role means that role. The learned account of a vendor names its key the same way. The words are for orientation: which key a booking gets is the tax adviser's call.
- **Zahlungen → Ohne Konto: the account in every row, and the AI asked for the whole list** (#929). Each payment without a confirmed account has its account in a field in its row, with "Übernehmen" beside it: what the books suggest by themselves (an own transfer, a bank fee, travel, the vendor's last account), with the account's name and where the suggestion comes from. "✦ Konten vorschlagen" above the list asks the model for every listed payment that has no suggestion yet – one after the other, each with what a single payment's "✦ Konto vorschlagen" sends, at most 100 a click – and puts the first account named into the row, with the model's reason. Nothing is booked by itself: every row is taken with its own button, and the number can be changed before. "Anhalten" ends the run after the payment in hand; an error keeps what was answered.

### Changed

- **The fix for #393 is measured against a production relay** ([docs/resilience-report.md](docs/resilience-report.md), German twin). Through a Le Space relay on Aleph, with 21 minutes of quiet so that the circuit runs into its 20 minutes while the devices idle on a direct connection: in 2 of 2 runs gossipsub's streams were back on the direct connection a second after the relay closed the circuit, nothing was hung up, and a burst of 100 bookings arrived in full. In October the same shape stood at 0 of 100.
- **The consent screen says what the code does, where the security audit found it out of date (#900; `docs/security-audit.md`, area 11).** One change, so it opens once more for everybody (version 59). It lists what `localStorage` and `sessionStorage` hold instead of "three flags" – readable settings and technical details of the device, and sealed the vaults and the log of device sync – and says keys are never stored unsealed. The mailbox: the app gets the mails to the bookkeeping address and, of the rest, the hits of a search the person starts, which runs over the whole mailbox; folders are opened read-only except for the move of one mail to the trash on a confirmed click. A model on this computer is redacted for until `pnpm setup:llm` is told that it runs here. "Konto vorschlagen" is listed as the seventh use of the language model. Named now: the IPFS routing a restore asks when Aleph's gateway is silent or switched off (cid.contact, delegated-ipfs.dev), the services behind "Wer hält es?" (delegated-ipfs.dev, ipwho.is), the further public nodes a wallet card suggests (asked only when entered), AMD's revocation list, the readable copy of the own network's relay address in this browser, and that the invoicing link's node tells a relay which protocols it serves. No behaviour changes. The audit page marks each point fixed, the STUN servers and the hosted bridge's attestation statements as checked, and leaves one point open: the hosted bridge's cards do not ask the pause.
- **The browser specs' runners finish together, and a test that needs a second try is named.** The five shards got the same number of tests each, so one of them ran three times as long as another and a pull request waited for it. The specs are now dealt out by the time they take (`app/e2e/durations.json`, `scripts/e2e-shards.mjs`); a spec without a time counts as a middling one. Each shard keeps Playwright's JSON report, and the run's summary lists the tests that passed only on a second try, each shard's time and the ten longest specs (`scripts/e2e-report.mjs`, which also renews the times from a run's reports). Nothing fails for it: the retry stays, it is only no longer silent.
- **A test that passed only on its second try leaves its evidence.** The screenshot and the video of a failed try were kept only when the job ended red, so of a test that fails now and then (#916) there was a line in the summary and nothing to look at. The browser jobs now keep `app/test-results/` of a green run too; without a failed try there are only the pictures a few specs take themselves, under 2 MB a job.

### Fixed

- **"Alles pausieren" holds for the hosted bridge too.** With the network paused during a session that had gone online at unlock, Integrationen → Bridge still asked Aleph's node list, Aleph's API and Le Space Credits when the page was opened, and offered to start, unlock and build a hosted bridge; the cards went by whether the session was online, not by the pause. While paused, the cards for the hosted bridge on Aleph and on Phala now ask nothing and offer nothing, and say that the network is paused; the functions behind them refuse as well, and a wait for a VM that boots ends. Stopping is the one exception, because a VM costs while it runs: the card says so and still offers "Stoppen" while paused, which contacts Aleph (or NEAR) for the stop and nothing else. "Fortsetzen" in the network menu brings the other buttons back. A build of the books' own image that already runs is finished, not cut off. The consent text is unchanged. ([#920](https://github.com/Le-Space/belege/pull/920))
- **What is asked of the bridge right after pairing it by code is answered.** With device sync off, the app pairs the bridge's own node in the background as soon as the code is taken, and the node restarts for it. Calls were held only until the stream to the node was set up, not until the node was paired: one made in the second or two between found a stream, lost it in the restart and fell to HTTP, which no longer serves the bridge's functions – "E-Mails abrufen" or a run of AI suggestions then said the bridge's node was not reachable, or asked nobody. The calls now wait until the node is paired (at most 30 seconds, as before). It is why the browser specs `transfer-first` and `appointments` failed now and then (#916).
- **A new device gets its books also when the first exchange with the other device breaks (#909).** Now and then a device that had just been added stayed empty, or took half a minute: the accounts and settings came over, the bookings did not, while both devices said "verbunden". OrbitDB exchanges a collection's heads with a device once; when that exchange broke, or the entries behind a head could not be fetched in time, it counted the device as synced all the same, and only the next booking written on the other device brought the rest. The store now notices both and has the heads exchanged again – after 2 s, then 10 s, 35 s and 2 minutes if it is lost again, at most four times in a row. Measured on the local test relay: the late joiner had all its bookings in 21 of 21 runs (20 within 11 s, one after 62 s); before, in 12 runs, 4 took 23–34 s and 3 did not get them within 45 s. The cause, a WebRTC connection that is dead on one side and still listed on the other, is not the app's and is not fixed by this.

## [0.49.1] – 2026-11-21

## [0.49.0] – 2026-11-21

### Added

- **The issuer's own logo on its own documents** (#906, first slice: the packages; `@le-space/eigenbeleg` 0.5.0, `@le-space/pdf` 0.2.0). `eigenbelegPdf`, `statementPdf` and `bookingPdf` take `issuerLogo`, the bytes of a PNG or JPEG file, and draw it in the head's top right corner, level with the title, fitted into 120 × 40 pt; the text of the head stays where it is, and the chain's mark may stand beside the title as before. The file is checked before anything is unpacked (512 kB, 2048 pixels a side, no banner, no column) and reduced to an opaque picture: a PNG laid on white without transparency, text or profile, a JPEG without EXIF, comments or other application segments. SVG and CMYK are refused with a sentence for the person. The documents stay PDF/A-2b and the same bytes every time. Nothing uses it yet: the Eigenbeleg page and API and the app's setting come next.
- **A swap on NEAR is read as a swap.** NEAR wrapped into wNEAR, and a token given to a DEX that pays out another, were a payment to a contract and two unrelated transfers. Now both legs are kind `swap` and carry what was given, what came, the gas and the account that took it, as on the EVM chains. A DEX's registration for several tokens at once (`tokens_storage_deposit`) is a storage deposit. An own NEAR wallet books wNEAR as the NEAR it is: wrapping and unwrapping leave only their gas, the balance is the account's NEAR plus its wNEAR, and NEAR swapped for USDC at a DEX is one swap in Zahlungen instead of unrelated payments. `@le-space/chains` 0.6.0 (#898).
- **Eigene Wallets shows what the wallets were worth, day by day** (#908, part of #889; `@le-space/charts` 0.2.0). Above the list of wallets a line chart has the balance at the end of each day of the last two months as its value in euros: one line per chain, summed over its accounts and assets; a chain with several accounts can be opened into a line per account. A checkbox hides a chain or an account, and a colour stays with its line whatever else is hidden; "Alle sichtbaren zusammen" adds a line for the sum. Pointing at the chart (or the arrow keys) picks a day, and every visible line's value of that day stands below it; "Als Tabelle zeigen" has every figure, with what was held in the assets' own units. A day's balance comes from the bookings, anchored at the balance the source reports; its value from the rate a booking of that day was valued with, else from the day's rate through the bridge (asked for a few at a time, kept for the session, the chart drawing what it has). A day without a rate leaves that asset out and says so; only an asset the books never value at a market rate is valued with the rate of its last booking, and the page says that too. Which lines are visible is remembered by the device, not by the books, and no address is written for it. In the package: `valueSeries`, `openingBefore` and `sumValues`; `lineChart` draws a missing value as a gap, labels lines at their ends (`ends`), takes more than four series and returns its plot box.
- **The wallets' chart gets a whole period of rates in one call** (`@le-space/rates` 0.6.0, `@le-space/bridge-protocol` 0.2.0). The chart on Eigene Wallets asked the bridge for one rate per asset and day: two months of a few assets were hundreds of calls to CoinGecko, whose public API refuses after about ten in a row. The rate service now answers a period for a listed asset (`rates(asset, from, to)`, at most 100 days): CoinGecko's daily points of the period in two calls (the EUR and the USD price at 00:00 UTC of each day – the same figures its daily snapshot gives, compared against the live API digit for digit), a day without a point from Kraken's daily candles, which one call covers. The rates are those `rate(asset, day)` gives and are kept under the same keys; a day neither source has stays without a rate, nothing is carried. The bridge has the command `rates.range` (`GET /rates/range?asset=&from=&to=`, scope `bridge:chains:read`) beside `rates.rate`; no new host is contacted. The chart asks once per asset for the days it needs; a token by its contract stays day by day, and a bridge that does not know the command yet is asked day by day as before.

### Fixed

- **Syncing no longer stops when the relay closes its circuit beside a direct connection (#393).** Two devices that met through a relay gossip over the relay's circuit, also once WebRTC connects them directly; when the relay closed the circuit – its time limit (20 minutes on the Le Space relays), its data cap, a lost relay connection – gossipsub lost its streams and opened none on the connection that was still there, so the devices looked connected and nothing arrived: a bank import after twenty quiet minutes stayed on one device, until the stopgap of #489 hung up some 40 to 80 seconds later. Now, when a connection to an own device closes and another stays, gossipsub is told of the one that is left, as it would be of a new one, and every collection exchanges its heads once more, the two devices one after the other. Nothing is hung up and nothing dialled; a paused network stays untouched. Measured on the local test relay: a burst of 100 bookings after the circuit expired arrived in full in 6 of 6 runs, and in 6 of 6 with the library's default limits, with no connection hung up; before, it stalled every time. The hang-up after 45 s of silence stays as the last resort. Not yet measured against the production relays. The cause is gossipsub's (`@libp2p/gossipsub` 16.1.0) and stays to be fixed there.
- **The heads exchange for a new direct connection waits for that connection.** The app asked a connection for `limited`, which libp2p 3 no longer sets (`limits` now), so every connection counted as unlimited: the one extra heads exchange per device ran a second after the relay's circuit opened, where OrbitDB's dial is refused, and was not repeated for the direct connection after it.
- **The resilience benchmark runs behind a VPN** (the media permission the browser specs already have), writes down the network from before the two devices meet, and keeps a run whose first sync failed (`RESILIENCE_INITIAL_TIMEOUT_MS`). That showed a separate fault, the late joiner's first sync hanging now and then, which is #909.

### Security

- **The hosted bridge on NEAR: the sealed secrets are handed only to the VM that was attested.** With its quote the VM's registrar names the hash of a fetch key it made for this start, and the launcher answers the fetch only for that key; anyone else gets the same answer as before the secrets came. The secrets were and are sealed to the VM's intake key, which never leaves it. This changes the bridge image (`registrar.mjs`), so its compose hash is a new one to approve; until then `LAUNCHER_LEGACY_SECRETS_FETCH=1` lets the launcher serve the image released before.
- **What a device and the bridge say to each other is sealed a second time, above the connection.** A call to the bridge's own node and its answer – bank transactions, mails, receipts, the exported settings – were protected by the connection's encryption alone. Now the arguments and the answer are also sealed with AES-256-GCM under a key from the bridge's own key, which the device and the bridge both hold from the books and which the device proves at the gate; the key of a call is made for that call, the two peers and the command (`@le-space/bridge-protocol/seal`). The handover at pairing, which brings the bridge that key, is sealed with a key from the invitation. A bridge from before is called as before, and a device from before is answered as before: the seal holds once both are current. A sealed answer takes a third more room, so JSON that no longer fits a stream answer goes as blocks, as big files do. Not covered: a call through another own device's bridge ("Bridge für eigene Geräte freigeben").

### Fixed

- **A restore no longer holds the backup in memory** (#512). The first restore of a real backup on a phone, about 720 MB, ended without a word: the fetched file, its plaintext and its blocks were in the tab's memory at once, three times the backup, and Android Chrome ends such a tab. A backup is now opened as it arrives – a megabyte, its blocks into the browser's storage, the next megabyte – and the step says how far it is: MB fetched and blocks stored, then the databases. Measured in Node with the blocks on disk: about 9 MiB of buffers for a backup of 64 MiB, against about 190 MiB before. A connection that drops is picked up at the byte it stopped at, also when the IPFS network takes over from Aleph's gateway. Needs `@le-space/orbitdb-storage-bridge` with the envelope in frames (NiKrause/orbitdb-storage-bridge#187).

### Changed

- **Backups are sealed in frames** (#512; the format is in [docs/backup.md](docs/backup.md#technical)). A new backup, full or increment, is `belegeB2`: the same CAR, in pieces of 1 MiB, each sealed by itself with AES-256-GCM under a key of that one file's, its place in the file authenticated with it, the last one marked as last, and a key check in front. A wrong passkey is known before anything is stored, and a file that is damaged or cut short is refused at the frame, with the books untouched; before, both failed the same way. The backup's manifest is its first block, so a backup of other books is refused before a block of it is stored.
- **Backups made before still restore, as they did.** They are sealed in one piece and can only be opened whole, with the memory that takes. To restore on a phone, make a new full backup with this version on a computer first. A Belege from before this version does not read the new backups: reload it.

## [0.48.0] – 2026-11-21

### Changed

- **Zahlungen says what moved in the asset's own unit.** Under a booking's euro amount the row now shows its quantity – 0,015 NEAR, 100 NYM, 12,50 USD – as the detail already did. Many crypto bookings are worth less than a cent ("> −0,01 EUR"), and the euro amount alone did not tell them apart. A booking in euros has no second line.

## [0.47.0] – 2026-11-21

### Security

- **The bridge reaches only the public internet for an address the app names.** An own wallet's endpoints, an Aleph API and the Filecoin Pay sources were held to `https` without credentials and without redirects; now an address or a name that means this machine, a private or link-local network is refused as well – however it is written, in IPv4 or IPv6 – and a name is resolved right before the request and refused when any of its addresses is such a one (`@le-space/chains` 0.5.3: `checkEndpoint`, with `isPrivateAddress` and `isLocalHostname`; the bridge's `public-fetch.js`).
- **Mail attachments and the move to the Trash keep to what the app was given.** Like a whole mail before, an attachment is handed out and a mail is moved only when the mail went to the accounting address – or when its id carries the seal the targeted search put on it. An id written down by hand for another mail of the mailbox is refused (`403 MAIL_SCOPE`). A receipt taken from the private mailbox by an earlier version keeps its old id: its file is in the books already, and moving that mail to the Trash from Belege needs it to be found by the search again.

### Added

- **Statements carry a diagram** (#889, first slice; `@le-space/eigenbeleg` 0.3.0, new `@le-space/charts` 0.1.0). Above its list of bookings a Kontoauszug shows the balance over the period, a Verbrauchsauszug (Aleph credits, Filecoin Pay) what was consumed per resource, the four largest each in a colour of their own and the rest as "Übrige"; per day, per month where the period is longer than a quarter. Drawn as vectors in the document's own fonts, so the files stay PDF/A-2b and the same bytes every time; `statementPdf(st, { chart: false })` leaves it out. The building block is the new package `@le-space/charts`: bookings to series in decimal strings, series to a scene of plain shapes, a scene to SVG as text (no script, colours through variables for light and dark). The app's "Statistik", the Eigenbeleg page and the API come later, on the same package.

### Fixed

- **A fake token's entry no longer blocks the month's export.** A "transfer" a stranger's token contract reports from an own wallet (address poisoning) moved nothing, and the app says so on the booking; the export still counted it as a crypto booking without a rate and as a booking without a confirmed account. Such entries are now left out of the export and its statements, and the check list says how many were.

## [0.46.0] – 2026-11-21

### Security

- **The security audit's written result** (#533, part of the audit plan #209): `docs/security-audit.md` and its German twin go through the plan's eleven areas – keys, sealing, databases, device sync, relays, foreign devices, the invoicing link, the bridge, the web app, the deploy chain, and the claims the product makes – with what was checked, the evidence, and a verdict for each point: fine, fixed, accepted with its reason, or open with its issue. It lists what is still to do and the tests that stand guard. Linked from `SECURITY.md`, the threat model and the README.
- Three statements corrected against the code: `bridge/README.md` now names all three routes that answer without a token (`/health`, `/pair`, a read share's own link) and all kinds of attachment the bridge hands out (PDFs, images, e-invoices); `docs/device-proof.md` says that a member gets the device proof's key sealed in their key bundle, where it said the key was never sent or stored.

### Added

- **An account's statement as a PDF, straight from Zahlungen.** With one account chosen in the filter and a month open, "Kontoauszug (PDF)" hands out that account's statement of that month: the same file, with the same number, as the month's export puts into its ZIP, so a DATEV line that names the statement names this file too. A month without a booking on the account says so instead. The PDF code is loaded on the click.
- **An Aleph usage proof can be corrected.** On the Aleph page, a month that already has its proof shows "Berichtigen": the app reads the month from Aleph again and issues a new proof with a new number that names the one it replaces (and its amount) on the PDF. The old one keeps its number and its file, is marked as replaced and leaves the lists; its number is never given out again. Refused when Aleph's figures are the same as before, which is also what a bridge still running the old reader would give. For the proofs made while a purchase paid in ALEPH valued every credit many times too high. The Verlauf says it.
- **A device that founded books of its own finds the vault its passkey belongs to** ([#524](https://github.com/Le-Space/belege/issues/524)). A passkey that already has a slot in a vault kept on Aleph could open Belege on a new device without "Wiederherstellen": the device made new, empty books, never asked the passkey's index again, and a backup of the real books was refused as another vault's, with no way on but clearing the site data. Now the passkey's own index on Aleph is asked again – after a backup was refused as another vault's, on "Bei Aleph nachfragen" under Einstellungen → Schlüssel, and at an unlock of books without a booking or a receipt on a device whose device sync runs over the public relays; never while the network is paused. A vault it names is offered only when this passkey's slot opens it and it holds other books. On "Jene Bücher öffnen" the page reloads, the passkey answers once, and the other books open, with the account their backups are kept for; the vault founded here stays in the browser, set aside for this passkey, and the books from before open if anything fails. The text of the refused backup names the case. No new host: the same Aleph API the restore already asks.

### Changed

- **A purchase of Aleph credits paid in ALEPH is the ALEPH that left the wallet, valued at the token's rate of that day** (`@le-space/chains` 0.5.2, `purchaseEntries`): the payment's entry is in ALEPH with `priceAs: 'ALEPH'`, as for any other payment in a token, and its memo names what the credits cost at Aleph's list price, to compare. Until now it was in USD at the list price. A purchase in a dollar token stays in USD. The monthly statement's consumption is still valued at dollars per credit.

### Fixed

- **A purchase of Aleph credits paid in ALEPH was valued many times too high, and every day's consumption after it.** A purchase row's `price` in Aleph's credit history is in units of the payment token per credit, not in US dollars; for a purchase in ALEPH that number is some sixty to a hundred times Aleph's list price. It was taken for dollars per credit. So the payment behind such a purchase came out as its token amount (plus the bonus) labelled USD, and the consumption statement valued each credit at that price. Now the dollars are what the credits paid for cost: the row's price for a purchase in a dollar token, Aleph's list price (1 USD per 1,000,000 credits) for one in ALEPH; a credit is valued at dollars paid / credits that came in, the bonus included. The statement also counted the bonus twice in its credits column, and a purchase on `ethereum` linked Aleph's explorer instead of the paying transaction. Checked against Aleph's node software and a paying transaction on Ethereum. `@le-space/rates` 0.4.0 (`alephPurchase`), `@le-space/chains` 0.5.1. **Statements and Eigenbelege for Aleph made before this are wrong where a purchase was paid in ALEPH and have to be made again**; a bridge has to run this version for the app's statement to be right.
- **"Kopplung lösen" no longer drops the hosted bridge.** While the books' bridge is a hosted one, the button in the panel of the bridge on this computer removes only the pairing with that bridge (its token) and says so; the hosted bridge's node, its place among the books' devices and the generation of its key stay. Before, it cleared both, and a running, unlocked VM was "not paired" until a new one was started. Without a bridge paired on this computer the panel says that the hosted bridge is stopped on its own card (#880).

## [0.45.0] – 2026-11-20

### Added

- **A file import can be taken back.** In Integrationen → Bank, an account that came from a file (a CAMT.053 statement, a card statement) has "Import zurücknehmen": after a question that says how many bookings go, and how many of them have a receipt or a confirmed ledger account, the account and its bookings are taken out of the books, with the matches and questions that point at them. Receipts stay and are open again. It is a soft delete, as everywhere in the books, it syncs to the other devices, and the Verlauf says it. For the wrong file, or a test file, imported into real books. Accounts a sync fills have no such button.

### Fixed

- **A model's enclave that cannot be reached now says why.** When the connection to LibertAI's enclave is refused, the bridge looks for itself: if the enclave's port takes no connection while its node answers on 443, the message names the port and says that the network the bridge runs in probably blocks it (a VPN exit, a firewall), or that the enclave is restarting; if the node does not answer either, it says that; a failed proof is said as one, with `pnpm setup:llm`. Before, all three read "cannot be reached. Is the service running?". After a refused connection the bridge also looks the enclave's address up afresh, so a port the node has changed is found without a restart.
- **The picture of what leaves the device no longer says receipt files are "not stored on IPFS".** They are sealed, cut into IPFS blocks and held by Helia in the browser; they travel as ciphertext to own devices and invited peers, and lie in the sealed backup file on Aleph's IPFS when the backup is switched on. The picture ([docs/backup.md](docs/backup.md), German twin) now shows that, with the backup as a third destination, and is an SVG.

## [0.44.0] – 2026-11-20

### Security

- **A Content-Security-Policy in every page** (#535, part of the audit plan #209). Each built page carries it as a `<meta>` tag (`app/csp.js`, SvelteKit's `kit.csp` with the hash of its start script): no script but the app's own files – no inline script, no `eval`, nothing from another host; WebAssembly may be compiled –, stylesheets, fonts and workers from the app only, no plugin content, no `<base>` elsewhere, no form posted anywhere, one frame (the payment page of Le Space Credits). Connections stay open to any host over TLS and to this computer, because relays, Aleph's nodes and a hosted bridge's name are not known at build time. The theme script and the English entry's script moved from inline into files. `e2e/csp.spec.js` checks the tag in the built pages and that the browser refuses an inline script, `eval`, a foreign script and an inline handler; the production spec checks the published pages. `docs/threat-model.md` says what a meta policy cannot do.
- **No `{@html}` anywhere in the app.** The five QR codes were the only uses; they are drawn as markup now (`Qr.svelte`), so no component renders raw HTML, and `no-raw-html.spec.js` keeps it so – together with no `eval`, no `new Function` and no hand-made script element in the sources.
- **The deploy chain to belege.le-space.de is pinned, locked and gated** (#534, part of the audit plan #209). Every GitHub action in every workflow is named by a commit with its version beside it; Dependabot proposes new pins weekly (`.github/dependabot.yml`). The tool that publishes the site (`@le-space/node`) is installed from a lockfile of its own (`deploy/`), frozen and without install scripts, no longer with `npm install` at deploy time. `deploy.yml` builds only a release tag `vX.Y.Z` that is on `main` – also when run by hand, where a branch is now refused – and its two jobs that read the publishing key run in the environment `production`. `scripts/workflow-pins.test.mjs` keeps all of it true in CI. `docs/deploy.md` lists the chain link by link, the repository settings that belong to it, and how to compare what the domain serves with a release.
- **The production build is checked, not only said to be clean** (#536, part of the audit plan #209). After every build for a release, a pull request and a deploy, `scripts/check-production-build.mjs` reads the built site and fails when a file names a test hook: a `__belege…` global, the build flag `VITE_E2E`, the key export for tests or the test booking button. In `deploy.yml` it reads the very directory that is published.
- **The at-rest check runs against what visitors get.** A new spec (`app/e2e-production`, `pnpm --filter @belege/app run test:production`) builds the app as a deploy does, creates a passkey, reads a bank statement in, reloads and unlocks, and then looks through IndexedDB, `localStorage`, `sessionStorage` and the service worker's cache for every key of the session and for lines of the statement. This build has no hook that names its keys, so the spec listens where keys pass through the browser's cryptography (`app/e2e/secret-spy.js`); `passkey-books.spec.js` checks in the E2E build that the listener hears every key the app names there. The at-rest scan of the other specs now reads `sessionStorage` too.
- **Standing tests from the audit plan** (#537, part of #209), so a regression fails CI. `no-discovery.spec.js` lists every libp2p node the app can start with its exact services, starts each as the app does and checks that it answers to no DHT, discovery or NAT protocol and that a provide has nowhere to go; a node made anywhere else, Helia building a libp2p of its own, or a discovery package among the dependencies fails it. `sealed-blocks.spec.js` opens the store as the app does, writes into every collection and the file store and classifies every block of the block store as sealed, public by design or neither – neither fails – and reads the sources for a database opened without the sealing.
- **A stranger against the real stack, as a standing test** (#537, part of #209). `stranger-peer.spec.js` runs a node with a key of its own and no device proof against a device of the books in a browser, through the relay, in the modes that listen at one: it tries every protocol the device answers to, before and after a made-up proof, subscribes to the books' topics and wants a block. It is told the identify and relay protocols and nothing of the books. In the mode without a relay it cannot reach the device.

### Fixed

- **The books' own bridge image holds a bridge that starts.** The image a hosted bridge was built from before held a bridge from before the fix for a node that waits forever at its start when it listens at two relays: the VM was attested and unlocked, and no function of its bridge answered. The builder Belege pins now seals the plain image with the fix (a new publication, recorded in NiKrause/relay-button#258). **An own image built before has to be built again** (Integrationen → Bridge → "Neu bauen") **and a new VM started**; the card says so while the image is the older one.
- A hosted bridge that does not answer says why, from what its VM reports about its own start (`/bridge/status.json` under the VM's name, no secrets): its bridge is still starting, its node does not start, or no relay holds a reservation for it – instead of the hint about a wrong passphrase, which the open disk rules out.
- A call to the bridge waits for its answer. Over the bridge's node a call was given up after a minute, so listing a mailbox with many mails, a wallet with a long history or a slow reading by the language model ended as "the bridge is not reachable" while the bridge finished and nobody took the answer. A call now has ten minutes (`@le-space/ucep` patched so a caller can say how long).
- A purchase of Aleph credits is known right after the wallet's sync. The accounts' purchases were read only on the Aleph page, so the payment that had just come into the books asked for a receipt until someone went there.
- The Verlauf names a NEAR wallet's sync and the ledger accounts taken from the chart of accounts, instead of showing their keys.

### Changed

- The consent screen names the hosts the Filecoin Pay statement asks – the makers' index at Goldsky (api.goldsky.com) and Blockscout (filecoin.blockscout.com, or api.blockscout.com with an own key) – and what they see: the wallet's address and the bridge's IP address. It opens once more (version 58).
- `@le-space/chains/filecoin-pay`: a Blockscout key goes in the `authorization` header, no longer in the URL, and the balance is read over Blockscout's JSON-RPC route with a key (its module API has no `eth_call`; the path taken before never answered). The client's new `keyed` option names the host a key is sent to.
- An Aleph account entered by hand can be seen, named and taken off again (Integrationen → Aleph Cloud). Adding one showed nothing until the next check, and an address Aleph holds nothing for never showed at all, with no way to remove it. Now the account is checked at once, the entered accounts are listed with their name and what Aleph said (found, or neither credits nor entries), each with "Entfernen"; the name stands on the account and on its usage statement.
- Three timing switches of the backup tests (the quiet time before an automatic backup, the wait for Aleph's decision, the recheck schedule) are compiled out of every build but the one for the end-to-end tests, like the other test hooks. They only shortened waits.

### Added

- `@le-space/eigenbeleg`: a payer's balance in Filecoin Pay as a monthly Verbrauchsauszug (`buildStatement` and `statementPdf` with chain `filecoin-pay`): each settlement a row that says up to when it paid, the month in sums by rail, its own note with the limits, and the data sources in the footer. For the Eigenbeleg API and page, which draw their documents with this package.
- **A usage statement for Filecoin Pay**, as Aleph's credits have one. Integrationen → Eigene Wallets shows a card "Filecoin Pay" once the books keep a Filecoin wallet a contract can hold a balance for (`f410f…`): it checks which of these wallets have a balance or rails in the payment contract, shows a month (opening and closing balance, paid in, taken out, each settlement with its provider and euro value) and makes it an Eigenbeleg – a PDF with every settlement, its split and transaction, the rails, the source and the limits; once per payer and month. The bridge reads it with the new command `filecoinpay.statement`. Limits, said on the card and the PDF: only USDFC; what a payer itself earns over rails is not read; settlements lag behind usage.
- `pnpm setup:blockscout`: an optional Blockscout API key for that statement, asked in a hidden prompt, checked with one call and kept in the keychain (account `blockscout`); `-` deletes it. Without a key Blockscout answers about ten requests and then none for minutes. A hosted bridge takes the key over with the other accounts.
- Einstellungen → Buchhaltung: the account a deposit into a payment contract goes on ("Konto für Guthaben in Zahlungsverträgen"). It was fixed to 1360, which stays the default.

## [0.43.0] – 2026-11-19

### Added

- `@le-space/chains/filecoin-pay`: what a payer's balance in Filecoin Pay was used for in a month, for a usage statement like Aleph's. Storage on Filecoin Onchain Cloud is paid by the contract out of the payer's balance, not by a wallet's transfers, so no wallet reader sees it. The statement has the opening and closing balance, what was paid in and taken out, and each settlement of each rail – provider, service, amount, of it commission and network fee, and up to when it paid – valued in euros; `filecoinPayEntries` gives the lines as ledger entries. Read from the index Filecoin Pay's makers keep, with the contract's deposit and withdrawal events from Blockscout; from Blockscout alone when the index does not answer (a key of dev.blockscout.com lifts its limit of about ten requests).

### Changed

- **Einstellungen is an overview with a page for each part.** It was one long page whose links only scrolled. Now each part – setup, company and own accounts, matching rules, what was learned, bookkeeping (DATEV), chart of accounts, travellers, keys, storage – is a tile that says where it stands and opens a page of its own (`/einstellungen/<part>`). Links to the old anchors lead to the new pages.
- **Tables that can be searched, filtered and sorted** for the ledger accounts of the books' accounts ("only without a ledger account"), the learned vendors and, in the technical view, the databases of the books. On a narrow screen a row is a card, with no sideways scrolling.
- After a chart of accounts is read in, its page says how many accounts were given their ledger account and links to them.

### Fixed

- A hosted bridge on Aleph answers again. The published bridge image was built before the fix for a node that hangs while it takes its place at two relays (0.40.1), so the bridge in the VM never finished starting: a device could connect and prove itself, and was told "not reachable". The standard image is rebuilt from the current bridge; start a new VM to get it. An image of the books' own is still built from the earlier plain image and follows with a new builder.
- Adding an own wallet suggests its ledger account in more cases. The chart account that names the wallet by its address (`name.near`) is found; when several free chart accounts fit, they are offered to pick from instead of nothing; the next free number follows the ledger accounts of the other wallets' accounts, not only a number kept on a wallet itself; and when there is no suggestion, the form says why.
- The receipts page's technical note reads as text again. With the technical view on it stood in the narrow column of sources and months beside the list and wrapped word by word into a tall strip, and on a phone it was not shown at all. It is now a strip over the whole width above the list, folded to its first line, and opens to the same two sentences on a click – on a phone too. `TechnicalNote` has a `folded` variant for notes that are about a whole page.

## [0.42.1] – 2026-11-19

### Fixed

- The bridge on this machine is found again after it was restarted, with device sync on. Its status page said "Bridge erreichbar" while the bank page showed no accounts and "Braucht die gekoppelte Bridge": the status goes over HTTP, the bridge's functions over its own node, and that node takes a free port at every start. The books still held the port from the day it was paired, and the node may sit at none of the relays this device uses. The app now reads from the bridge's status where its node listens, keeps that address in the books and dials it – at unlock, and whenever the bridge's card checks the status.
- A bridge whose pairing was undone can be paired again with device sync on. Its node keeps its peer id, the books held it as a removed device, and a removed device is never dialled – so the new pairing by code stood, its node stayed unpaired, and nothing said so. The node is let through while it is paired again, and when pairing it fails the bridge's card now says that the code is taken but no function will answer.

### Added

- A payment into Filecoin Pay explains itself. USDFC sent from an own wallet to the Filecoin Pay contract (Filecoin Onchain Cloud, the contract storage is paid from) is known by the contract's address: the payment is named "Filecoin Pay" instead of "unbekannte Adresse", and it is an own transfer that needs no receipt – what is paid in stays the payer's own balance in the contract until storage is settled from it. What the contract then pays providers is not in the wallet and is not booked by this. What a person said about the address still comes first.

### Fixed

- The payment's detail on a narrow screen, such as a folded phone's outer display: the amount and "Schließen" took the width and left the name a column one letter wide, and the two sides of a wallet payment wrapped word by word. Where the panel is narrow the amount and the button now sit on a row of their own, and the name and both sides get the whole width below. The "Nächster Schritt" bar sits flush with the bottom edge instead of letting a strip of the page show beneath it, and the tab labels are set a little smaller below 360 pixels.

### Added

- A wallet's accounts are found in the chart of accounts although the chart calls the wallet by another name. An asset account is looked up by its asset and chain when the chart has exactly one such account ("… - ALEPH (Ethereum)"). What is found that way tells what the chart calls the wallet, and the wallet's other assets – ETH, USDC, which several wallets hold – are then looked up under that name. Still only what is unambiguous is taken, and it is marked for checking.

### Fixed

- The chart accounts offered for an account that got none are fewer and fitting: for a wallet's account only chart accounts of its asset, the one on its chain first; none far away from the accounts already numbered; and none for a bank account whose name is only what the bank calls the product ("Kontokorrent" brought up receivables and payables that carry the word).

### Changed

- The picture in the bridge image's build view shows keys, checks and measurements where they happen (`@le-space/build-journey` 0.12.12): the passphrase travels to the node as a key, the processor's report to the browser as a shield; the node shows "gemessen", the browser "Bericht geprüft" (red "stimmt nicht" for a value Belege does not pin), the node "mit deinem Schlüssel versiegelt", the fetch's connections checked, the STORE signed and stored. On a phone these notes stand as a list under the picture.

## [0.42.0] – 2026-11-19

### Added

- A bank account is found in the chart of accounts by its bank. A CAMT statement and Enable Banking name the bank that keeps an account; Belege keeps that name on the account and takes the chart account that names the bank ("Revolut Business" for an account called "Main") when exactly one does. An account read before this learns its bank at the next import or sync. Hibiscus names no bank; such an account is still given its ledger account by hand.
- Where no ledger account could be taken over, the settings offer the free chart accounts that share most with the account's name and bank as buttons – for a wallet's "ETH (Ethereum)" account the chart's "… - ETH (Ethereum)" accounts. One click fills the field in; it is saved with the rest.

### Fixed

- Ledger accounts from the chart of accounts: an asset's ticker and its name count as the same word, so a chart that says "Kraken Bitcoin", "Kraken EURO" or "Kraken Filecoin" now names the accounts "Kraken BTC", "Kraken EUR" and "Kraken FIL". Before, only names spelled exactly alike were taken.

## [0.41.0] – 2026-11-19

### Added

- Ledger accounts come from your own chart of accounts. When a chart is read in – and for accounts added later, whenever the settings are opened – every bank, exchange or wallet account without a ledger account gets the one the chart names for it: by the last four digits of the IBAN or by every word of the account's name ("1310 Kraken BTC" for "Kraken BTC"), and only when that is unambiguous. It is written to the books at once, marked in the settings and noted in the Verlauf; an account that already has a number keeps it.
- A new wallet is offered a ledger account: the chart account that names the wallet or its chain, else the next free number after the other wallets' ledger accounts, with the note that the bookkeeping has to open it first.

### Changed

- "Konto (Finanzkonto)" in the wallet form no longer shows a grey "1200" that looked like a value.

## [0.40.2] – 2026-11-19

### Fixed

- Own devices no longer lose each other after about a quarter of an hour ("kein Le-Space-Relay erreichbar" although the relays answer). A place at a relay is renewed before it runs out; in `@libp2p/circuit-relay-v2` 4.2.9 that renewal took the node's relay addresses away and never gave them back, with the connection to the relay still open, and asking for the place again changed nothing because the reservation itself was in order. Until a reload no other device could reach this one. The package's patch now applies the renewed reservation to the listener, as its version 4.2.17 does. The bridge's own node had the same fault and has the same fix.

## [0.40.1] – 2026-11-18

### Fixed

- Unlocking no longer hangs at "Netzknoten anlegen" (#803). With device sync on and two relays that both answer, the node's start could wait forever: after the first relay had confirmed its reservation, `@libp2p/circuit-relay-v2` 4.2.9 emptied its queue of reservations and dropped the second relay's without ending it, and listening on that relay never returned. Whether it happened depended on which relay answered when, so the same books opened on one try and hung on the next; with a single relay it could not happen. The package is patched (`patches/`): a reservation on a configured relay stays in the queue. The bridge's own node had the same fault and has the same fix.
- Starting the hosted bridge on a plan says to agree to Le Space's terms first when the service refuses the authorization for that reason, instead of showing the service's raw answer.

## [0.40.0] – 2026-11-18

### Added

- The payment behind a purchase of Aleph credits is explained by itself. "Bei Aleph prüfen" (and making a usage statement) now reads the purchases of each Aleph account with the transaction Aleph names as their payment; a booking that left an own wallet with that hash, or an exchange's withdrawal with it as its on-chain hash, needs no receipt of its own: the account's monthly usage statement is the document. The network fee stays a fee. `@le-space/chains`: an Aleph statement lists `purchases`, every purchase up to the month's end with its paying transaction; a bridge from before this names only the month's own.

### Fixed

- An address or counterparty is no longer called "Eigenbeleg". Making an Eigenbeleg for a payment taught the books that the payment's other side is a vendor of that name, so every booking with the same address was named so and, since "Was war diese Zahlung?", treated as a vendor's. A receipt the books made themselves (an Eigenbeleg, a usage statement of Aleph or Akash) teaches no partner now, and what such receipts taught before is taken back at the next matching run; an address a person said is private or a custodian's stays as said.

## [0.39.3] – 2026-11-18

### Added

- Le Space's terms for Belege's paid offers, asked for before a purchase: once the service has a version in force, the Le Space Credits card shows it with a link, and a top-up or a plan of the hosted bridge waits until the person has ticked and confirmed it. An announced new version can be agreed to ahead of its date. While no version is published nothing is asked, as before. The card links the terms, the privacy policy and Le Space's security page.

### Changed

- The declaration on withdrawal before a top-up is now the service's own text, in German or English, and the top-up tells the service which version of it was ticked. The consent screen's line on Le Space Credits names the agreement to the terms among what is sent (same host, so it does not open again).

## [0.39.2] – 2026-11-18

### Changed

- The build view of "Bridge-Image bauen" is now the shared one from `@le-space/build-journey` (NiKrause/relay-button), the same Paperless anywhere shows at its first start. It shows more to check: the source commit and SHA-256 of the plain image, the expected measurement (pinned in Belege), the builder's V-PROGRAM, the node, the relay, the measurement the AMD processor reported with "stimmt", the content address and the STORE, each linked where it can be looked up, and the hardware behind it. Stations and small steps carry the same names as in Paperless anywhere.

## [0.39.1] – 2026-11-18

## [0.39.0] – 2026-11-18

### Added

- "Was war diese Zahlung?" in the payment's detail, for a crypto transfer to or from an address that nothing else explains – an exchange's withdrawal, or an own wallet's booking. The choices: an own wallet (added and read, as before), private (a withdrawal or deposit: no receipt, counted as private), a vendor or service provider – for an incoming payment a customer – (the address gets the name, the payment needs its invoice), or own money at an exchange or custodian Belege does not read (no receipt; an own transfer on 1360 whose other side is not in the books). The answer is kept for the address, so every booking with it is treated the same, and can be taken back. What the books see for themselves – an own wallet, a counter-booking, the same hash – comes first. It replaces "Adresse benennen".

### Changed

- When Aleph cannot be asked for the relays, Belege falls back to three relays instead of one: ocean-skate-resource-route and secret-pass-wife-sentence (orbitdb-relay account) besides relay-main-ekb (relay-button account). One relay going away no longer leaves the app without any. All three offer /attest with the image builders' larger limits.

### Fixed

- Building the books' own bridge image no longer stops when Aleph's first API host does not answer: reading the balance, starting and ending the builder and checking the stored image ask the second host (api.aleph.im, already named in the consent screen) then, as unlocking does (#777). A builder left running is ended that way too.

## [0.38.0] – 2026-11-18

### Added

- A withdrawal from Kraken to an address that is no own wallet yet offers it as one: the payment's detail shows the destination address and "Als eigene Wallet anlegen", which opens Integrationen → Eigene Wallets with the chain and the address filled in. Nothing is added, and no node is asked, before the button there is pressed: an address does not prove whose it is. A chain Belege cannot read is named instead. The bridge passes the address on with Kraken's ledger, so it needs a restart, and a Kraken sync that reaches the withdrawal again.

### Changed

- An unlock that waits says for what, and what helps (#803). The step "Speicher und Netz starten" is shown in its parts: opening the storage in the browser, looking for relays, creating the node, and starting it (the first read of the storage). When a step takes far longer than it should (a minute; five for opening large books; never for a move), the screen says so: close other tabs and windows of Belege, the installed app too, and reload; then quit the browser and open it again; never clear site data. When Belege is open in another window of the browser, it says that first. The console times each part and names the one that waits, and the diagnosis under "Hilfe & Support" names it too. This does not remove the cause of such a wait, which is not known yet; it makes the next one say where it is.

## [0.37.1] – 2026-11-18

### Added

- A NEAR account as an own wallet (#815): under Integrationen → Eigene Wallets, choose NEAR and enter the account id (`name.near`, or the 64 hex characters of an implicit account). NEAR and USDC are booked, the gas of a transaction the account signed as a fee of its own; other tokens are counted, not booked. A withdrawal from an exchange and its arrival on the account pair by the transaction's hash, as on the other chains. The bridge reads the history from NearBlocks and the balance from an archival node of FastNEAR; both see the account id and the IP address, and the consent screen says so (version 57). Not read yet: NEAR that arrives inside another transaction's inner receipts, a staking pool paying out, say – the balance shows the difference. The local bridge needs a restart to know the chain.

### Changed

- "Bridge-Image bauen" checks the books' key before the click: with fewer credits than the day of builder reserve Aleph wants, the card says how many it holds and needs, shows the key's address to load (with a copy button), and offers no build until then (#777). A build that stops shows its reason in the build view, at the station where it stopped, without the progress and time left it no longer has.

## [0.37.0] – 2026-11-17

### Added

- A build of the books' own bridge image holds the screen on and, on a phone or tablet, plays the soft keep-alive tone the backup uses (#525, #777): a phone otherwise puts the tab to sleep when the person switches apps, and the build breaks off. The card offers the tone switch on phones, the build view says to stay in Belege, and it says how long the page was away when it comes back.

## [0.36.0] – 2026-11-17

### Added

- "Bridge-Image bauen" shows the build as a journey, as Paperless anywhere does its first start (#777): five stations from waking the builder to storing the image on Aleph. Each station has its small steps and a picture of what flows where (the request, the hardware's report, the passphrase, the pieces, the image). The view shows the share done, the time left and when it ends, and the evidence the build reported (the hardware's measurement, the plain image, the sealed image's CID and STORE). It can shrink to a bar. While it runs the screen stays on, leaving the page asks first, and the tab's title carries the progress. It ends with "Geschafft", or with what stopped it.

## [0.35.0] – 2026-11-17

### Added

- The hosted bridge on Aleph can run from an image of the books' own (#777, #808). "Bridge-Image bauen" on the hosted bridge card derives the image's passphrase from the books' keys in the browser. It starts the pinned builder and hands it the passphrase only after its attestation, fetches the sealed image back and keeps it on Aleph as a STORE of the books' key. The builder is forgotten afterwards. From then on, "Starten" and "Entsperren" send the derived passphrase; there is no passphrase field and no passphrase Le Space holds. The launch measurement is the same as for the shared image. This first works while the books' own Aleph key pays: the card checks the reserve Aleph asks for the builder first. A Le Space plan and a member's device keep the shared image for now, as does a VM started before. The consent screen says what a build sends and where (version 54).

### Changed

- The footer links the privacy policy at credits.le-space.de next to the imprint, and the consent screen says what Le Space keeps (#809).
- `@le-space/attest-wasm` 0.12.8 in the app and the bridge (#807).
- The bridge's default language model is Ollama on this computer (`qwen3:4b-instruct-2507-q4_K_M`), no longer DeepSeek: no receipt text leaves the computer unless you choose a provider on the internet on purpose. `pnpm setup:llm` offers Ollama first and needs no API key for it; a provider on the internet has to be typed and is shown with its country (for example _DeepSeek – China_) before it is taken. When Ollama is not installed, not running or lacks the model, the bridge and the KI card say so with the steps; no cloud model is used instead. A bridge that still has DeepSeek from the old default asks once – in `pnpm setup:llm`, at its start and on the KI card – whether to switch or keep DeepSeek on purpose, and keeps the answer in `bridge.json`. The consent screen says so (version 56).

### Fixed

- While the books open, the progress line names the trips collection instead of showing its key (#806).

## [0.34.0] – 2026-11-16

### Added

- A tiny info icon beside every AI button (✦) shows, on hover, focus or tap, what one press will roughly take: tokens in and out, and the cost at the bridge's provider (#566). The tokens are the average of the last calls of the same kind in the Verlauf, or a rough figure until there are any; the price comes from DeepSeek's or LibertAI's published table, bundled with the app (LibertAI's from its Aleph aggregate, read on 2026-11-15). A model on the bridge's own computer costs nothing; a hosted bridge paid from a Le Space plan shows "im Paket enthalten". It says it is an estimate, and nothing is billed by it.
- Einstellungen → Kontenplan: the ⓘ beside the title opens on hover, focus or a tap (it was a mouse-only title before) and says which files are read – DATEV Kontenbeschriftungen, or a CSV or text file with an account number and a name column, the headings recognised, separators and character sets – with an example and the example as a file made in the browser (#801). The AI cost hint shares its behaviour.
- "Hilfe & Support" in the footer, locked and unlocked (#804): where to write about the app and about billing, what helps in a report, what Le Space never asks for (recovery words, passkeys, keys, tokens, passwords), where a weakness goes, and a diagnosis to copy – release, browser, the unlock's step, network settings and the last error with numbers, addresses and quoted text scrubbed. It is shown in full before it is copied and holds nothing from the books.
- A full disclosure policy in `SECURITY.md` and `/.well-known/security.txt` on the deployed app (#805): how to report privately, what happens then (coordinated disclosure), rules for research, what is in scope and which versions are supported.

### Changed

- The hosted bridge's card says when an unlocked VM has not come up: when its bridge's node has not reached this device three minutes after the unlock (#797). Most often the image's passphrase was wrong – Aleph's agent takes it with the secrets, but the disk stays closed and nothing in the VM starts. The card says so and offers to unlock the same VM again, which costs nothing extra.
- The bridge's HTTP routes for its functions are gone (#580): they answer `410 HTTP_GONE` (with the token; `401` without, as before). The app calls them over the bridge's node, from another device and on the same machine alike; a desktop that shares its bridge with own devices forwards over its node too, and needs no token for it. HTTP keeps `/pair`, `/unpair`, `/node/invitation`, `/health`, `/lan-relay`, the shares, the backup upload and the portals. `pnpm bridge --no-node` is gone; `"node": { "enabled": false }` now runs the node on 127.0.0.1 only, without relays. A bridge paired by code is paired over 127.0.0.1 too when device sync is on, gets no relays and does not go online itself; a desktop that shares it checks the asking device's own scopes and forwards to no third device. Unpaired on purpose, a node is not paired again unasked.

### Fixed

- Reading a chart of accounts took the wrong column as the account number when a program's export headed it "Nummer" and had a column of repeated type codes beside it: every account got the code instead. "Nummer", "Nr" and "Kto-Nr" are known headings now, and without a known heading the column with the most different numbers wins (#800). A chart read in with wrong numbers needs to be read in again.
- "✦ Konto vorschlagen" can suggest an account the books learned for a vendor even when the chart lacks it, and the learned accounts of the payment's vendor are sent first (#800). Personal accounts of a chart (customers and vendors, longer numbers than its ledger accounts) are no longer sent to the model.

## [0.33.0] – 2026-11-15

### Added

- Receipt files reach every own device in the background (#790): a device fetches the files its receipts name and it lacks from the own devices connected directly – at unlock, when a receipt comes by sync, when a device connects or turns direct. Two at a time, up to 32 MiB per file (a larger one when it is opened), a failed one again after a doubling wait; nothing while the network is paused or device sync is off, never from the bridge, never through a relay. The blocks stay sealed. Before, a file stayed on the device that added it until another opened it, and was nowhere else once that device was offline. The preview says when a file is not on this device yet instead of failing; the consent screen and `docs/device-proof.md` say so.
- Integrationen → Eigene Geräte shows how many receipt files are on this device and, foldable, the receipts whose file is still missing here – with a link and why: being fetched, waiting for an own device that has it, or large and fetched when opened (#791).
- The bridge image workflow can publish the plain image the hosted bridge is sealed from, as an Aleph STORE of its own with build provenance; `bridge-image.json` names it under `sealable` (#777). It holds no secret.

### Changed

- Integrationen → KI with a hosted bridge: no settings of a bridge on a computer and no terminal advice, but where the hosted bridge's model is set and that the VM needs a restart for it; the bridge row and the settings card name the hosted bridge (#786).
- Deploys use `@le-space/node` 0.12.7: a CAR upload to Aleph that hangs moves on to the next host instead of waiting (#793).
- With device sync off, the app reaches the bridge on the same machine over a stream too (#580): after pairing by code it fetches the node's invitation (`POST /node/invitation`, new, with the token), pairs the node over a WebSocket on 127.0.0.1 from a small node of its own that dials this machine only, and calls the bridge's functions over that stream. HTTP keeps pairing, health, shares, the backup upload and the portals. The consent screen says so, and that the bridge reaches the devices' Bitswap for its big answers on a protocol of its own (#578); version 52.
- The bridge's HTTP routes that its node also serves over the stream answer with a `Deprecation` header (RFC 9745) and a link to #580; nothing changes in what they answer. `/pair`, `/unpair`, `/health`, `/lan-relay`, the shares, the backup upload and the portals stay on HTTP without it. The routes go once the app reaches the bridge over a stream on the same machine with device sync off, too (#580).
- The bridge hands over big answers as blocks (#578): a mail attachment, a raw mail or a Paperless original that does not fit one stream answer (1 MiB, 64 KiB through a relay) reaches a device over the bridge's own node as sealed blocks – AES-256-GCM under a key made for that answer, fetched over a Bitswap of its own (`/le-space/bridge-blocks/1.0.0`, `@le-space/bridge-protocol/exchange`) on the proved connection, relayed too, each block checked against its CID. The device's gate lets the bridge reach that one protocol and still none of the books' own; the bridge keeps the blocks in memory until the device has them, at most ten minutes. A phone without HTTP to the bridge now gets originals of any size up to 32 MB.

### Fixed

- A hosted bridge node whose attestation cannot be checked (no AMD certificate for its processor's firmware) is said so plainly – nothing was sent to the VM, start on another node – remembered per books in the sealed settings, and no longer preselected (#788).

## [0.32.7] – 2026-11-14

### Changed

- The app calls the bridge's commands by their names (#577): every call in the bridge client names a command of `@le-space/bridge-protocol`, which builds the HTTP request; over the stream to the bridge's node, and to a desktop that shares its bridge, the command goes by name and is checked against its schema there. A bridge or desktop from before answers `UNKNOWN_COMMAND`, and that call goes as `request` with its path from then on. Pairing, shares and the backup upload stay on HTTP.
- Unlocking or starting the hosted bridge on Aleph says when Aleph is slow or down: how far the SEV-SNP runtime has downloaded (about 15 MB), a note after 20 s that the delay is on Aleph's side, and an error naming what each Aleph host answered. When api2.aleph.im does not answer, the app asks api.aleph.im; the public runtime stays in the browser's cache once its bytes match their hash, so later unlocks skip the download. Consent screen version 50 (#587).
- Geräte → Erweitert → Zugang zur Bridge shows, per device, how often it called the bridge and how often a call was refused; opened, each command with its counts and the last time. The bridge keeps only command names, counts and times with the device's grant (`device-grants.json`), never an argument or an answer (#775, #579).

### Fixed

- Automatic backup no longer sends the same increment again and again after Aleph refused it (for example because it could not fetch the file, or for credits): it waits, and the header badge and the backup card say that Aleph refused the last increment. "Jetzt sichern" by hand lifts the block once Aleph keeps an increment (#774).

## [0.32.6] – 2026-11-14

### Changed

- Unlocking a hosted bridge on Aleph says which try it is and why the last one failed (the reason shortened to one line, without keys or long hashes), and "Abbrechen" stops the waiting while the VM keeps running. Errors a later try does not change – no relay with /attest, a refusal from Aleph or the VM – end the waiting at once instead of after up to two hours. The card shows the full INSTANCE hash, copyable, and its node, and lists the VMs the books' Aleph key started that Aleph still holds, to pick one for unlocking or to stop it. Consent screen version 49 (#776, #587).

## [0.32.5] – 2026-11-14

## [0.32.4] – 2026-11-14

### Changed

- The bridge README says how a language model is wired in: `pnpm setup:llm` offers an OpenAI-compatible URL or LibertAI's attested enclave, a table names which model runs where and what is checked, and the hosted bridge on Phala through NEAR is named beside the one on Aleph (#770).
- Integrationen → Bridge opens with "Welche Bridge antwortet?": one line each for the bridge on this computer, the VM on Aleph and the VM on Phala over NEAR, with a coloured badge – unlocked and answering, running but still locked, stopped, or paired and silent. A hosted VM that runs but is not unlocked yet says so on its card, and its button is "Entsperren". With nothing paired, the computer's bridge is "none here" instead of a red error (#587).

## [0.32.3] – 2026-11-14

### Changed

- The consent screen names the Le Space Credits as a balance for what Le Space offers for Belege – today the hosted bridge – instead of for services Le Space runs (#768).

### Fixed

- A deploy no longer uploads the site again when Aleph has processed its STORE and only the check after it fails. The check now tries the subdomain gateway, the path gateways and finally the IPFS network itself (`@le-space/node` 0.12.6), and otherwise stops with a clear error (#767).

## [0.32.2] – 2026-11-14

### Changed

- The credits card says only what Le Space offers today: the hosted bridge, AI through Le Space later. Le Space pays the VM's computing time at Aleph with the balance; an AI with the customer's own access is set up in the bridge and runs without Le Space (#766).

## [0.32.1] – 2026-11-14

### Added

- **The backup card shows a backup Aleph has not confirmed yet, and asks again by itself** (#764). While the newest backup or an increment is still pending, the headline has an amber dot and _Gesichert – Aleph bestätigt noch_ instead of a green _Alles gesichert_. After such a run the card asks Aleph again after about 15 s, 45 s, 2 min and 5 min, through the same path as before (no new host), and updates the headline and the last-run line without a reload. It stops once nothing is pending, when the card closes, and while the network is paused.

### Fixed

- A hosted bridge on Aleph that the node could not bring up can be stopped from its card. The card now says when the node gave up (`startup_failed` after several tries) instead of waiting for port 443 (#587).

## [0.32.0] – 2026-11-13

### Added

- **The bridge's commands by name, with schemas: `@le-space/bridge-protocol`** (`packages/bridge-protocol`, #577, M2.1 of #567). One catalogue of the bridge's 47 commands – name, version, scope, how HTTP carries it, and a schema for the arguments and the answer's shape – that the bridge and every client import, in a browser and in Node. The bridge's node now offers every command under its own name (`bank.transactions`, `mail.search`, protocol version 2): the arguments are checked against the command's schema before it runs, an unknown name answers `UNKNOWN_COMMAND`. `request` with a method and a path stays for the app until it calls by name too.
- **Le Space can pay the hosted bridge on Aleph, from a plan** (#587). Integrationen → Bridge → _Gehostete Bridge auf Aleph_ → _Wer zahlt die VM?_: _Le Space, aus dem Paket der Bücher_ or _Der Aleph-Schlüssel der Bücher selbst_, as Paperless anywhere offers it. With a plan (Ab und zu 60 h, Täglich 176 h, Immer an 730 h, paid from the Le Space Credits balance on the card), Le Space's sub-account for these books pays the VM, and the books' key starts, forwards and stops it as its delegate. The launch measurement still names the books' key, and only it unlocks; Le Space could stop the VM, but sees no secret. Consent screen version 48.

### Fixed

- **A restore no longer fails on what a member wrote.** A backup now carries each collection's access list – the database that names who may write – and a restore puts the lists back before the collections. Before, a browser restoring books it had never opened did not know a member's write grant, refused every entry the member had written ("not allowed to write to the log"), and the restore stopped; whether it happened depended on whether the member had written anything before the backup. A chain begun before this ships the lists whole with its next increment.

### Changed

- **The Le Space Credits card says what the credits are** (#761): a euro balance with Le Space, like a voucher, not a cryptocurrency; nothing is bought for the person or into a wallet, Le Space itself pays the computing time at Aleph with it. The address line reads _Kennung deiner Bücher bei credits.le-space.de_, and that Le Space transfers nothing to it.
- **The demo films' kit is a package of its own, `@le-space/video-kit`** (`packages/video-kit`). The scenes, the narrator, the pointer, the captions, the title cards and compose moved there with their history, so Le Space's other apps record their films with it; what makes a card Belege's (the signet, Sora, the colours, the texts) stays in `app/e2e-video/belege.js`. Belege's films record as before: every card of every film list was compared frame by frame against the old kit.

## [0.31.0] – 2026-11-13

### Added

- **A hosted bridge reads with a model in LibertAI's attested enclave** (#754). A hosted bridge (Aleph, Phala through NEAR) used no language model; now it may use one, and only one in LibertAI's confidential enclave, pinned: the key, model and pin come with its settings – taken over from the bridge on a computer bound to it by `pnpm setup:llm`, or entered on _Einstellungen für die gehostete Bridge_ – and the VM checks the enclave before every request as the Mac does. Any other model is dropped at the VM's start. Reading receipts and the account suggestions then work from anywhere. Consent screen version 47.

### Fixed

- A hosted bridge on Aleph boots a new image with the bridge as of #754. It takes only whole account names and leaves out a computer's LAN relay and HTTP tokens (#728, #733, #756).

## [0.30.0] – 2026-11-13

### Added

- **Split a trip, or join two** (#693, part b). At the bottom of a trip: _In zwei Reisen teilen_ at an end and a start – suggested where the tickets come home and leave again a day or more later – with its receipts, border crossings, meals, nights and mileage going by their time; _Zu einer Reise zusammenführen_ with a trip of the same traveller at most a week apart, from the earlier start to the later end, the other deleted. Never for a trip on a closed statement.
- **Questions where a trip does not add up** (#693, part b). By rules on its tickets and hotels, a trip asks about a night without lodging (no hotel, no flat rate, no leg through it), a ride missing between two legs, a last leg ending abroad without a way back ("Wo endet die Geschäftsreise?"), and a leg before the departure or after the return. The trip page lists them under _Rückfragen zur Reise_: _Reise endet dort_ sets the return at the last arrival, _Passt so_ keeps the answer on the trip. On Reisen they join the trip's one open point. Nothing is changed by itself.
- **„Im Postfach suchen“ on a trip's gap** (#693, part c). A night without lodging or a ride missing between two legs searches the whole mailbox through the bridge, ± 30 days around the gap, for the place or words of a booking or a ticket – named before the click, only the hits read. The hits are ranked by rule (place and word together, an attachment, no newsletter); _Als Beleg übernehmen_ takes one over as „Beleg finden“ does, assigns it to the trip and reads it.
- **„✦ Reise prüfen“ on a trip** (#693, part d). With a model on the bridge's computer or in an attested enclave, redaction off, the trip's rides, nights, crossings, its receipts' read fields (no amounts, numbers, reason or note) and the open questions go to the model, and at most six notes come back on what does not fit or is missing, each naming its receipts; a note can be dismissed, nothing is changed. Unredacted, as a whole trip is a movement profile – so with a public model there is no button, and the bridge refuses it (`POST /travel/assist`). Logged in the Verlauf; named on the consent screen (version 46).
- **A hosted bridge on Phala, started through NEAR** (#696, testnet, a prototype for the NEAR hackathon). Integrationen → Bridge → _Gehostete Bridge auf Phala, über NEAR_: the books get an implicit NEAR account; _Starten und koppeln_ asks a contract on NEAR for a start, Le Space's launcher provisions an Intel TDX VM on Phala, the contract checks its attestation (hardware signature, the measured image, the machine), and only then does this browser seal the bridge's keys, its peer key, the relays and the devices to the VM's own key. Pairing happens in the same step; Le Space starts the VM and sees no key. Named on the consent screen.
- **Settings for a hosted bridge** (#728). Integrationen → Bridge → _Einstellungen für die gehostete Bridge_: mail, Kraken, Paperless-ngx and Alchemy typed in, or taken over from the bridge on this computer (with Enable Banking, CoinGecko and a Bitcoin zpub), kept sealed in the books and handed only to an attested VM at its start – on Phala through NEAR and on Aleph. Values are never shown again, only which accounts are kept.

### Changed

- **Answers up to 1 MiB through the books' own relay** (#752). UCEP 0.2.0-draft.5 treats a relayed connection as limited only when its relay grants it less than 32 MiB; the books' relay grants far more. A hosted bridge, reached only through it, now hands over a mail attachment or a Paperless original up to 1 MiB instead of 64 KiB. Bigger files still wait for blocks (#578); a direct WebRTC connection to the VM is #750.
- The Aleph card is named _Gehostete Bridge auf Aleph_, and its device _Gehostete Bridge (Aleph)_, beside the one on Phala (#743).

### Fixed

- A NEAR bridge start on Phala's KMS node pha1-prod4 is no longer refused as an unknown KMS: the app trusts the KMS by its pinned key under each name Phala gives the same cluster (#749).

## [0.29.8] – 2026-11-11

### Added

- **„✦ Konto vorschlagen“ under a payment's „Konto“.** With a bridge paired, the language model reads the payment, its receipt, the accounts Belege has learned for vendors and your chart of accounts (or the SKR 03 list), and suggests up to two accounts from that list with a reason. „Einsetzen“ puts one in the field; nothing is booked until you take it. The text is redacted unless the model runs on your computer or in an attested enclave and `setup:llm` was told not to (bridge `POST /booking/assist`). Docs: [docs/ai.md](docs/ai.md).

### Changed

- **"Sachkonto in deiner Buchhaltung" offers your chart of accounts.** With a chart read in, the ledger account of each bank account suggests your own accounts as you type, names the one you entered or says it is not in your chart, and no longer shows the SKR 03 placeholder 1200, 1210, … which named other accounts there. Without a chart nothing changes.

### Fixed

- **Where the bridge signs a backup, the bridge uploads it** (#734). With this browser's key not allowed by the account, the app uploaded to Aleph's IPFS host and the bridge sent the order afterwards, which Aleph has refused with "File not found" since November. The app now hands the sealed file to the bridge on this computer, which sends it to Aleph with the order in one request; the bridge only ever sees the sealed file. Where the bridge cannot take the file (reached over the stream or another device, more than 256 MiB, an older bridge), the two steps stay.
- **A refused backup says when asking again cannot help** (#734). A row Aleph refused because it could not fetch the file no longer offers "Aleph erneut beauftragen": it says that its content goes up again with the next "Jetzt sichern". The consent text, the card and the backup docs now say where the sealed file goes: to the Aleph API with its order, and to the IPFS host only as a fallback.
- **A chart of accounts from an older Mac program keeps its umlauts.** "Kontenplan einlesen" read a Mac Roman file as Windows-1252, so ä, ö and ü turned into Š, š and Ÿ. It now takes the reading that gives more umlauts. A name that repeats its account number at the start ("1200 1200 Bank") shows it once. Read the chart in again to correct names already taken.

## [0.29.7] – 2026-11-11

### Changed

- **The backup takes more from the storage bridge** (#729). With `@le-space/orbitdb-storage-bridge` 0.28.0, asking Aleph about an order and about the credits, confirming a chain of backups and going back when Aleph refuses later, and uploading a backup together with its order all come from that package instead of Belege's own code. "Wer hält es?" asks through it too. A bridge that uploads a backup itself now sends it with its order in one request, as the browser does since 0.29.6. Nothing changes in how a backup is made or restored.

## [0.29.6] – 2026-11-11

### Added

- **Save a receipt from its preview** (#709). The preview that opens on hover has a download icon in the page's top-right corner: it shows on hover, on keyboard focus and always on a touch screen, and saves the receipt's file (PDF, image or e-invoice XML) under its own name, made safe for a file system, or the day and vendor. The file is decrypted in the browser; nothing goes over the network. A mail's text without a file has no icon.
- **Reisen as a tab** (#693), with a suitcase, between Belege and Export. It appears once there is a trip, a traveller or a trip the receipts propose, so who never travels keeps five tabs; its number counts the proposals and questions waiting there. Before, Reisen was a link on Belege and Home only, and a proposed trip went unnoticed.
- **"Kurse holen" on a trip** (#693). Receipts of a trip in another currency still without euros get their day's rate from the bridge in one go (ECB, Bank of Russia, National Bank of Kazakhstan, a cross rate), each shown with its euros, rate and source; _Übernehmen_ keeps them. Before, each rate was fetched on its receipt, one by one.
- **Destination and times from the tickets** (#693). A trip made before its receipts were read kept an empty head. Where destination, departure or return are empty and the trip's tickets and hotels know them, the trip offers them with _Übernehmen_: the first printed departure, the last arrival, a return only where a ticket leads back home, never the day a ticket was bought.
- **Why "von der Firma"**: a receipt on a trip paid from a business account names the payment's day.
- **Border crossings from the tickets** (#693, part a). Reading a travel receipt also names the country of each station, airport and town and a flight's airport codes, in the call that runs anyway. A train, bus, flight, local transport or taxi that arrives in another country becomes a border crossing at its arrival. A trip proposal carries them, a trip made from it keeps them, and on a trip _Übernehmen_ adds those it lacks. The allowance abroad then counts each day by country without typing.
  - A border crossed by car, bicycle or on foot leaves no ticket. A receipt from a country the trip was not in on its day (fuel, parking, a hotel's nights, a restaurant) is named with its day, on the proposal and on the trip. The time is entered by hand and never guessed.
  - Two flights where one leaves from the airport the other landed at belong to one trip, however the town is written.
  - Receipts read before know no country; _Erneut auslesen_ adds it. The consent screen names the new fields (version 41).
- **What a trip costs in all** (#693). The trip shows _Gesamtkosten der Reise_ beside _Zu erstatten_: the receipts paid privately, booked as outlays and paid by the company, tips, allowances, mileage and overnight flat rates. On Reisen each trip shows its total and what of it is paid back; before, the list showed the allowances and mileage alone. With receipts booked as outlays, _An dich insgesamt_ adds them to _Zu erstatten_, so what comes back from the statement and the outlay account together is one number.
- **"✦ Belege der Reise neu auslesen"** (#693): all of a trip's receipts read once more with one click, on the app's queue, for instance after the reading learned the countries of a trip. Only on the click; a reload stops it.

### Changed

- **A ticket added later moves the trip's times** (#693). The trip offers an earlier departure or a later return than entered when a ticket says so ("Abfahrt … statt …"), for instance the train to the airport added afterwards; before, only empty fields were offered. Without a hotel, the destination is the place stayed at longest, not the town passed through on the way to the airport.
- **What "Als Auslage gebucht" means, on a trip** (#693). The line read "(dort erstattet)", as if paid back already. It now says the receipts are paid back through the outlay account, not with this statement; the trip explains how to have one paid back with the trip instead (undo its outlay on the receipt), and names such a receipt "als Auslage gebucht" on its row.
- **One open point per trip.** A trip without a return and without a reason showed as two points with the same link. It is one now, naming what it lacks: "Reise ohne Rückkehr, geschäftlichen Anlass – keine Pauschale berechenbar".

### Fixed

- **Backups Aleph refused because it could not fetch the file** (#725). Since early November Aleph refused every increment with "File not found": the file went to Aleph's IPFS host, and Aleph's nodes could not fetch it from there. With this browser's key allowed to sign, a backup now goes to Aleph's API with its order in the same request, and Aleph keeps it at once. The chain also remembers how far Aleph has confirmed it: an increment Aleph refuses later sends it back there, so the next "Jetzt sichern" ships everything since again instead of saying nothing is new. Books whose increments were refused show "Nicht gesichert" after the update; no new full backup is needed.
- **Paperless errors in the app's language** (#724). An unreachable Paperless showed the bridge's English text; now each of the bridge's Paperless errors has its own message in German and English, with what to do.
- A receipt without a date no longer shows a lone "·" at the start of its line on the trip.
- **A receipt without a date no longer stops a page.** A date that was not read (a ticket that prints only its day of travel) made the date formatting throw, and the trip page and Reisen stopped updating. It now shows no date.
- **A receipt in euros booked as an outlay** counted on the trip page as paid privately and in _Zu erstatten_, unlike in the statement, which pays it back through the outlay account. It is now listed apart.
- **A tip on a hospitality bill is paid back and booked.** It was shown in the split but left out of what the statement pays back and of its bookings. A tip the traveller paid now counts in _Zu erstatten_, on the trip and the PDF, and is booked 70/30 onto 4650/4654 without a tax key. A tip is the company's only where a payment from the business account linked to the bill covers bill and tip together. All amounts in the tests are made up.
- **A trip without a night away across more than one midnight no longer breaks the travel pages** (#539, point 3). Its allowance could not be computed and threw; now the trip names the problem and the statement waits until the times or the night away are fixed.

## [0.29.5] – 2026-11-06

### Security

- **What a device may do with the bridge, limited** (#689, #579). Over the stream each call now needs its scope, and a device holds a set of them. Your own devices keep every scope they had. A member's devices reach the bridge only if you allowed it when admitting them; a member who only reads never does. A device that does not use the bridge for 90 days loses access until the device that paired the bridge renews it under _Integrationen → Eigene Geräte → Erweitert_, where each device's access is shown. What costs money is limited per device: calls to the language model a minute, its tokens a day and backups an hour, set in `bridge.json`. A refusal is the bridge's answer: the app tries no other way to the bridge instead.

### Changed

- **The remote collaboration run checks the Aleph credits first.** Aleph takes the test VM only while the paying wallet holds credits for a day of it, and otherwise refuses it with a bare "error 6" on every node. The run now compares balance and price before anything else and fails in seconds, saying how many credits are missing. When the IPFS gateway refuses a page's code (429) while the bookkeeping waits for a payment, the run reloads and unlocks again instead of waiting on a broken page.

- **The threat model in plain German, and the use cases brought up to date** (#680). In both languages: the books' keys come from the books' root, which the passkey opens; a device needs the books' key and to be known or let in; after a compromised browser, new keys for the books help. The use cases name the bridge share as for own devices only, list the two roles of an assistant, call the AI assistant's view by its name, and show the check both sides compare when joining.

- **The pages on AI, bank accounts, export, crypto and travel in plain German** (#683–#687), and their facts brought up to date in both languages:
  - AI: redaction stays on by default and goes off only when `setup:llm` stored "off", for a model on this computer or a pinned enclave; uploads, the shared folder and Paperless hits start reading too; e-invoices are read without a model.
  - Export: the settings paths (_Einstellungen → Buchhaltung (DATEV)_, _Kontenplan_), what holds the export back and what stays out of the ZIP, Akash network fees as one collective booking.
  - Crypto: Bitcoin, Filecoin and Monero are imported today; a token CoinGecko cannot price takes the rate of its Uniswap pool.
  - Travel: rates from the National Bank of Kazakhstan and cross rates through the ruble, Hong Kong with rates of its own, rental cars and public transport in trip proposals.

## [0.29.4] – 2026-11-06

### Fixed

- **The app's name in the header no longer breaks into single words** (#675). With a few more badges in the header (an unsaved backup, the DID) the name was squeezed under the logo, and back when a badge went. The badges now always take a row of their own.

### Changed

- **The backup card's "Erweitert" in sections** (#677): account and credits, this browser, full backup and increments, restoring, and where a backup lies. The list of backups keeps one short sentence; what goes out folds open below it. A refused backup says so once, with "Aleph erneut beauftragen" in its row. Texts corrected: any passkey of the books, or their recovery words, opens a backup; with credits for less than 30 days the automatic backup stops while "Jetzt sichern" still works.
- **The features page of the docs in plain German** (#674), and in both languages it now lists keys and backup, members with their two roles and the bridge's own node. The view for an AI assistant on this computer is named as such.

## [0.29.3] – 2026-11-06

### Security

- **The bridge on the books' devices, narrowed** (#670), a step towards scopes per bridge command (#579):
  - The bridge share through an open desktop tab answers the owner's own devices only, not the devices of members.
  - On the bridge's node, the device that paired it keeps its device list and unpairs it. Any other device of the books may only take devices off the list.
  - "Kopplung lösen" on another device says where it can be done, and changes nothing.

### Changed

- **The backup page of the docs in plain German** (#669), with three corrections in both languages: any passkey of the books opens a backup, only a full backup asks before upload when credits run low, and a member who only reads along does not back up.
- A steadier E2E spec for the member backup (#668).

## [0.29.2] – 2026-11-06

### Changed

- **The Filecoin reader is a package of its own** (#264): `@belege/chain-filecoin`, on `@belege/chain-core`, with its own tests in _Package tests_. Nothing changes in what Belege reads or books.
- **The Cosmos reader is a package of its own** (#264): `@belege/chain-cosmos` (Nym's Nyx and Akash, with the Akash Console history and the deployments), on the shared `@belege/chain-core` (fetcher, units, explorer links, swap detection, `WalletEntry`), each with its own tests in a new workflow, _Package tests_. The first step towards open building blocks; nothing changes in what Belege reads or books.
- **The backup card at a glance** (#656): a status line says whether everything is backed up and what needs doing; below it "Jetzt sichern", "Wiederherstellen …" and the automatic switch. Account, key, grant, the full backup, the chain and the explanations sit under "Erweitert", open by itself while something is still to set up.
- **Own devices at a glance** (#662): a status line says how many of the known devices are connected and when data last came; below it the requests to come in and the device list. This device's id and QR code, adding a device, the QR exchange, the bridge share and the sync log sit under "Erweitert", open by itself while no other device is known.
- **Faster CI for pull requests** (#264): the browser specs run in shards side by side (five over HTTP, two over the stream), and a pull request runs only what its files can affect – docs skip the browser specs and the bridge's tests, a change to the bridge alone runs only the specs that pair a bridge. A push to `main` and a release still run every test.

## [0.29.1] – 2026-11-06

### Added

- **Whose a device or a change is** (#650): the device list says which member a device belongs to, the history who made a change, and the members card when a member was last seen. What a member writes now names their write identity, the one the owner's member list shows.
- **A warning in the header when the backups' credits run low** (#653): everyone who opens the books, members too, sees when the Aleph account's credits keep the backups for less than 30 days.

### Changed

- **Backups ask "Hochladen?" only for a full backup** (#653); an increment goes up without asking. When this browser signs itself, a bridge that cannot be reached is a note, not an error.
- Steadier E2E specs where two devices sync (#649, #652).

## [0.29.0] – 2026-11-05

### Added

- **Members who write along or read along** (_Integrationen → Zusammenarbeit_, milestone C2, #641): when admitting, the owner chooses. "Schreibt mit" – the bookkeeping, or an assistant who works in the books – writes under their own name and backs up; your bridge only if you tick it. "Liest mit" – an assistant who follows the books from belege.le-space.de, wherever they sit – gets the keys to read and sync only: no write access, no backup, no bridge. A reader's session opens the books read-only and runs nothing that writes. Members admitted before keep what they had.

## [0.28.3] – 2026-11-05

### Security

Hardening from a review of members (C1) and new keys (C3):

- **Joining: both sides compare before anything is written or kept** (#640). The owner compares the join code's check with the bookkeeping's screen before the books grant anything; the bookkeeping compares a check of the books with the owner's screen before the member vault is kept.
- **Taking a member out puts back what only the owner sets** (#642) – where backups are kept and signed, the bridge, how devices meet, the vault on Aleph, the invoicing app – when the member set it last, and names their other last changes. Only devices the member alone wrote leave the list. New keys carry such settings only as the owner set them, and make a new browser key for Aleph.
- **A backup made before new keys counts only as the books of then signed it** (#643): every entry's identity and signature are checked, and it only adds records the books do not have – nothing overwritten, no settings.
- **Only devices the books know get in, in every mode** (#644). An unknown device that proves the key asks to come in under _Eigene Geräte_ ("Zulassen" / "Ablehnen"); books that never knew another device let their first one in.
- Test hooks only in E2E builds; a join code of a member taken out is refused – they join with a new one (#645).

## [0.28.2] – 2026-11-04

### Changed

- **Wallet bookings in the app's language** (#637): what wallet sync writes into the books itself – the network fee, sent and received, staking and mining, a swap's purpose and its numbers – follows the language at the time of the import. Bookings already imported keep theirs.

### Fixed

- **New keys for the books: the successor counts only as the books wrote it** (#638): a device switches to new keys only on an entry the books' own identity wrote, and a successor that does not open never keeps the books from opening.
- In English, the "bridge not reachable" message named the German button; a test of the recovery words no longer mistakes a field name for a word.

## [0.28.1] – 2026-11-04

What 0.28.0 brought, now on belege.le-space.de: 0.28.0 was tagged, but its deploy stopped at its own tests and never went out.

### Added

- **The sample books in the app's language** (#636): in English, accounts, counterparties, purposes, receipt excerpts and file names are English; the banks' booking codes stay.
- **The Le Space Credits balance card** under _Integrationen → Aleph_ (#593).
- **A test of collaboration over the internet** (#625): after each release, the owner on a GitHub runner and the bookkeeping on an Aleph VM, against belege.le-space.de through the public relays.

### Fixed

- **The E2E suite's local relay has room for every browser** (#634): it keeps a reservation until it expires, not until its peer leaves, and with the specs of several devices its 32 places ran out before the UCEP spec asked for one – which stopped 0.28.0's deploy. Test code only.

## [0.28.0] – 2026-11-04 (not deployed)

### Added

- **Members: the bookkeeping works in your books with their own passkey** (milestone C1, #6):
  - **Joining** (_Integrationen → Zusammenarbeit_, #611): the bookkeeping makes a join code on their own device and sends it; the owner pastes it under "Mitglied aufnehmen", which writes the member into the books, grants their own write identity write access in every collection's access list, and answers with the member bundle sealed to the code's one-time key (x25519, as the book move does). Only the device that made the code opens the answer; it keeps the bundle in a member vault under its own passkey (#610). Both screens show the same fingerprint.
  - **Opening the books as a member** (#612): the unlock screen asks which books to open when the passkey holds a membership. The member gets the keys to read, write, back up and reach the owner's bridge – never the books' root, their passkeys or recovery words – and writes under their own name; owner-only functions refuse.
  - **Backing up and restoring as a member** (#613): sealed with the books' backup key, kept on the books' Aleph account, the history says who made it. The member vault goes to an index of its own on Aleph, so an empty browser with the member's passkey finds the books and their backups.
  - **Taking a member out** (#614): what they wrote so far stays; anything they write after is refused by every device – the books' access controller keeps a list of their entries up to then instead of revoking the grant, which OrbitDB would apply to old entries too (`app/src/lib/store/books-access.js`); their devices so far leave the list and are refused.
  - Consent and docs (#615): `docs/keys`, `docs/backup`, `docs/device-proof`, `docs/threat-model`, a new use case, and two diagrams.
- **New keys for the books** (_Einstellungen → Schlüssel_, offered after taking a member out, #627): a new root in a new vault with a slot for every passkey that stays, the earlier roots kept inside; the books packed in the browser, sealed for the new root, and taken over into new databases after one reload. Another device of the owner finds the new vault in the old books (or on Aleph) and switches when its passkey has a slot; a passkey that was left out stays in the old books, which say so. Recovery words, members, the bridge pairing and the backup chain start anew.
- **A backup made before new keys still restores** (#628): it opens with an earlier root the vault keeps, and its records come into today's books one by one, only where these have no newer version.
- **A light for the relay in the network menu**: under the chosen way to meet, green while this device holds a place at a relay of that kind (a Le Space relay, or your bridge's), red when not – so "no device connected" and "not reachable at all" look different (`app/src/lib/sync/relay-light.js`).
- **"Alle Wallets synchronisieren"**: every wallet read by its address, one after the other, with the progress in percent on the card and on the tab _Integrationen_. The run goes on while you click elsewhere in Belege; only a reload ends it. At the end the card says what came – new bookings, without a rate, not fetched – and, with Belege in the background, a system notification says it too: asked for once on the click, with counts only, never an amount, a name or an address (`app/src/lib/wallets/sync-run.svelte.js`, `app/src/lib/notify.js`).

### Fixed

- **Devices reach the public Le Space relays again** (#631): since 0.27.0 the browser's rule against insecure WebSockets also refused `/tls/ws`, which is how the relays announce themselves, so devices in public mode never got a place at a relay. An address with `/tls` counts as secure, however its WebSocket part is written.
- **The name in the header is never cut off** (#620).
- **A device that lost its place at the relay takes it again**: libp2p reserves a place at each configured relay once, at start; when the relay connection went (a laptop asleep, another network, a redeployed relay), the device stayed unreachable for its other devices until a reload. Device sync now notices it in its 30-second round and listens on the relays again, waiting longer after each failure, up to ten minutes (`app/src/lib/sync/device-sync.js`).
- **Crypto bookings older than two years get a rate**: CoinGecko answers for the last 365 days only and Kraken's daily candles cover the last 720, so a Bitcoin booking before that stayed "Kurs fehlt". The bridge now asks Kraken's trade history for the first trade of that day after 00:00 UTC – the price the day's candle would have opened with – one call at a time and spaced; a day before Kraken listed the pair still has none (`bridge/src/rates.js`).

## [0.27.0] – 2026-11-03

### Added

- **The bridge is a peer of the books**: it runs a libp2p node of its own (`bridge/src/node.js`), with an Ed25519 peer key kept next to `bridge.json` and the same device gate as every device – a peer proves the bridge's own key and must be on the books' device list, strangers and relays are told nothing but identify. Until a device has handed the key over, the node is unarmed and offers pairing by invitation only: `pnpm bridge` prints a `web+ucep:pair?…` invitation, the app pairs over the stream and sends the key, the relays and the device list (`handover`); the key goes to the keychain (`bridge-auth`) and leaves with "Kopplung lösen". `pnpm bridge --no-node` keeps the bridge HTTP-only (#573, milestone M1 of #567).
- **Every bridge function works on a device paired by invitation only, and CI proves it** (#575): the app no longer takes the bridge's token as the only sign of a pairing – the bridge's node counts too, so reading receipts, bank, wallets, Kraken, Aleph, backup and the AI hints work without one (customer portals and shares for an assistant stay HTTP's own). Calls right after an unlock wait for the stream to be set up, and a call without a token waits for the node rather than falling back to HTTP. A second E2E job runs every bridge spec with device sync on, pairing by invitation and every HTTP request to the bridge refused (`pnpm test:e2e:stream`).
- **The app pairs the bridge's node and uses it over the stream** (_Integrationen → Bridge_, "Über Einladung koppeln", with device sync on): the device pairs by the invitation `pnpm bridge` printed, hands it a key of its own (derived from the books' root for this bridge and one generation of the pairing; the books' device key never leaves the browser), the relays and the device list, and adds the bridge to the books as their bridge. Devices prove themselves with that key toward this one peer only and let it reach none of their protocols, and "Kopplung lösen" moves to the next generation, so a copy of the key opens nothing – from then on every device of the books reaches the bridge through the relays, with no browser open on the computer, and the bridge's device list follows the app's. The bridge client prefers the stream, then HTTP on this machine, then another device's bridge; pairing by code stays. The Geräte card lists the bridge as a device; the bridge's node is dialled on this machine too (its WebSocket on 127.0.0.1), which libp2p's browser rule refused before (#575).
- **The bridge's functions over the stream**: armed, the node offers `request { method, path, body? }` on the `belege-bridge` extension, answered `{ status, contentType, json | base64 }` – the same command table, body limits and answers as HTTP (`bridge/src/stream.js`), so a device of the books reaches the bridge through the relays with no desktop browser open once the app's client speaks it (#575). Pairing, shares and the backup upload stay with HTTP; bytes out go base64 up to UCEP's limit and are refused `TOO_LARGE` above it, until blocks come in M2 (#574).

### Changed

- **The relay Belege falls back to is relay-main-ekb**, the relay of the relay-button account that also serves paperless-anywhere's attest relay: when Aleph cannot be asked, devices meet there. The orbitdb-relay of 2026-11-02 is retired, and with it the last guest wallet Belege trusted one by one; a relay now counts only when it runs on one of Le Space's Aleph accounts, checked on Aleph. The consent text on relays says so (`app/src/lib/ucep/net.js`).

- **The device gate and the quiet identify are a workspace package** (`packages/device-gate`, `@belege/device-gate`), shared by the app's sync node and, next, the bridge's own node (#573). The app imports it through its old paths; nothing changes in what a device or a relay sees.
- **Bridge: its functions are commands, apart from the transport** (`bridge/src/commands.js`): every route is now a named command (`bank.transactions`, `mail.search`, `llm.extract`, …) with the scope a device will need once the bridge speaks UCEP over libp2p; `server.js` is the HTTP front door that checks host, origin and token and dispatches. Nothing changes for the app; the first step of #567.

## [0.26.6] – 2026-11-02

### Changed

- **Le Space relays are trusted by the Aleph account that runs them, so a redeployed relay needs no new release (#564, #565).** Until now Belege counted a relay's registration on Aleph only from a wallet listed in the code. A relay makes that wallet at deploy time, so every redeploy meant a new release, and until then no relay. Now a registration also counts when three things hold: it names one of Le Space's Aleph accounts and its instance, Aleph holds that instance as a running VM of that account, and the address is the instance's own 2n6.me name. Belege computes that name from the instance's hash, so it contacts no new host. A forged entry can name the account but cannot point anywhere else. The relay Belege now uses also serves paperless-anywhere's attest relay, so one VM does both. The old relay and a second one that had gone silent are dropped from the list. The consent screen's entry on the relays says how they are trusted now; it opens once more (version 31).

### Fixed

- **"Rechnungen abgleichen" no longer stops at one invoice whose XRechnung the app gets wrong**: for an invoice taken over earlier, an XML the app does not deliver or delivers wrong is counted ("{count} XRechnungen … nicht oder falsch geliefert") and asked for next time, and the sync goes on to the other invoices and the payment notices – before, one such invoice ended every sync for good. A VAT line the app sends without a rate is left out instead of being kept as 0 % (`app/src/lib/ucep/issued.js`).
- **A restore fetches only what Aleph keeps, and finds every backup of the account**: an increment Aleph refused or never took is left out (its entries went again with the next one), where before the restore waited for a file nobody holds and failed; the list of backups is read page by page (Aleph answers 50 at a time, and a chain that backs up by itself has more within weeks), so older full backups and a long chain's first increments are found on an empty device; the history keeps every row of the current chain, not the newest 50 overall; and a backup that was uploaded but not kept (credits, a lost answer) gets its row, so "Aleph erneut beauftragen" sends a new STORE instead of the whole file again (`app/src/lib/backup`).
- **The devices' log survives on an iPhone**: once the sealed log passed 64 KiB (three hundred lines of file names and amounts), Safari refused the call that encoded it, the error was swallowed, and no line was kept on that device from then on – a reload showed the last log that still fit. The log is encoded in pieces now (`app/src/lib/sync/sync-log.js`).
- **"Aus Paperless holen" gets past a document the bridge cannot deliver**: one larger than 15 MB, or gone from Paperless, ended every fetch at that document, and nothing Paperless added after it ever came in. It is counted now ("{count} Dokument(e) kann die Bridge nicht liefern …"), stays in Paperless, and the fetch goes on. And the tags that leave mail-rule documents out apply only while "Belege ruft das Postfach trotzdem selbst ab" is on – with Paperless as the only mail reader, those documents are the receipts, and they were skipped for good (`app/src/lib/paperless/import.js`).
- **Bridge: one odd date no longer fails an Enable Banking fetch**: an entry whose booking or value date the bridge cannot read (another shape, an impossible day) is handed to the app without a date, which skips that one entry and counts it – before, the whole account's transactions request failed on it, on every fetch (`bridge/src/enablebanking-normalize.js`).
- **Bridge: a block time the Akash indexer did not give is asked for again**: an indexer that timed out once left those deployments' `createdAt`/`settledAt` empty until the bridge restarted (`bridge/src/chains/akash-deployments.js`).

- **Recovery words that were removed or replaced no longer open the books from another device**: when the books' current vault on Aleph has no slot for the words, the words are refused with "Diese Wörter wurden aus den Büchern entfernt oder durch neue ersetzt", the way a removed passkey is – before, the record filed under the words themselves still opened (`app/src/lib/books-vault.js`).

- **The redaction before a model call reads an IBAN in any spelling and a card number without spaces**: a hand-typed `de89 3704 …` is blacked out like `DE89 3704 …`, and sixteen digits in a row with a valid check digit are taken for a card and hidden except the last four; order and tracking numbers of the same length, which fail that check, stay readable for the model (`bridge/src/llm/redact.js`, docs/ai.md).

## [0.26.5] – 2026-11-01

### Added

- **A soft tone keeps a backup or restore alive through an app switch on a phone**: "Leiser Ton, solange es läuft" on the backup card (phones and tablets only, on by default, off per browser) plays a note every two seconds while a backup, a restore or the move of the books after an update runs, with a media notification that leads back into the app – a page that is audibly playing is one Chromium does not freeze. Whether it carries a restore through a real app switch is being measured (#525, docs/backup.md).

## [0.26.4] – 2026-10-31

### Added

- **A restore says where the backup came from, and can skip the gateway**: "Erst Alephs Gateway, dann das IPFS-Netz" (on by default) asks Aleph's gateway once and, when it stays silent for 15 s, fetches the backup over IPFS itself – a fetch-only Helia node dialling Aleph's nodes and the public routing's providers; unticked, the gateway is not asked at all. The card shows which one delivered, the gateway's host or how many peers, and how long it took (docs/backup.md).
- **The bridge card on a phone says what is true there**: no bridge runs on a phone, so instead of "is it running on this Mac?", a terminal command and "unpair", the card and the "needs you" row say how the computer's bridge reaches the phone – shared under Devices, this phone added there (#142).

## [0.26.3] – 2026-10-31

### Added

- **A restore error shows its technical detail**: under the explanation, "Technical detail" unfolds what the failing step said – which gateway, how many bytes, which CID – so a failed download on a phone can be reported, and retried knowing why.

- **An architecture overview** ([docs/architecture.md](docs/architecture.md), German twin): the degradation ladder from same room to no IP network, the layers from keys to archive with links to the page that describes each, and what the resilience benchmark measured. The README now links it and the resilience report; the report's list of weak spots no longer names the superlinear restore, which is gone, and names the relay stall's stopgap and #403.
- **An invoice the invoicing app issued as XRechnung comes with its XML (#515).** With Le Space Rechnungen from invoice extension 0.4.0 on, "Rechnungen abgleichen" also fetches the XRechnung of each invoice the app names as one (`formats`, `get-xml`), checks it against the SHA-256 the app states and that it is a CII e-invoice, and keeps it beside the PDF as the original (`xmlCid`), as a ZUGFeRD invoice keeps the XML it carries. The receipt says so, and the export puts the XML beside the PDF under the same number. An XRechnung comes through the relay, where a PDF waits for a direct connection; one too large for the relay comes at a later sync, and so does the XML of an invoice taken over before. An app before 0.4.0 is not asked.

## [0.26.2] – 2026-10-29

### Fixed

- **A restore refuses a download that came back short or damaged, instead of calling it the wrong passkey.** On a phone, a restore of a backup from the same books ended with "Dieses Backup lässt sich mit diesem Passkey nicht öffnen" – the key was right. The sealed file had come back by a dag-pb CID (every backup since 0.26.0), and nothing checked the bytes against it: a download cut short or damaged on the way reached the key, AES-GCM refused it, and that looked exactly like a wrong key. With `@le-space/orbitdb-storage-bridge` 0.27.2 every download is checked at the gateway – against the size the STORE names and against the CID, the file built again from the bytes the way Aleph's hosts built it – and asked for again when it does not match ("nicht oder nicht vollständig zurückgegeben"). The STORE now names the file's size (browser and bridge alike; `content.size`), so the list of backups from another device shows it instead of "Größe unbekannt", and the restore's progress has a total even when the gateway announces none. The "wrong passkey" text says what it means – another vault – and the two ways in: a slot for this passkey, or the recovery words.

## [0.26.1] – 2026-10-29

### Fixed

- **Restoring on a phone: the download is no longer cut off, shows how far it is, and the screen stays on.** The first restore of a real backup on a phone (722 MB) ended with "Alephs Gateway hat das Backup nicht zurückgegeben": the storage bridge aborted every gateway request after two minutes, whatever had arrived – a laptop at 10 MB/s just made it, a phone's Wi-Fi did not. With `@le-space/orbitdb-storage-bridge` 0.27.1 the two minutes are idle time (no bytes for that long), and the fetch reports its bytes: the card says "Backup wird von Aleph geholt … 412 von 722 MB – 57 %". While a backup, a restore or the move of the books after an update runs, Belege holds the screen awake (Screen Wake Lock, where the browser has it – Chrome on Android, Safari 16.4+) and takes the lock again when the tab comes back; the card says to keep the screen on and the tab in front (#512). A phone still needs the whole backup in memory – the streamed restore is #512 / orbitdb-storage-bridge#187.

## [0.26.0] – 2026-10-29

### Changed

- **One list of backups, by chain – and restoring from it.** The backup card showed every backup twice ("Ältere Backup-Ketten" with "Löschen", "Bisherige Backups" without), a deleted backup as large as a live one, and nothing marked the chain "Jetzt sichern" continues; the restore card listed the same backups a third time. Now one list, grouped by chain: the current chain first and marked, every chain with its increments and what it costs a day, "Wiederherstellen" on each full backup and "Löschen" on each older chain in the same line; what Aleph lists for the account is merged in, so a backup made on another device can be restored or deleted here too; chains Aleph has deleted are folded away, with "Aus der Liste nehmen" for their rows. A row is two lines; CID, the Aleph order and "Was drin ist" are under "Details". The restore card is gone: restoring runs from the list, or from "Per CID wiederherstellen" below it, with the same question, progress and result as before.

## [0.25.0] – 2026-10-27

### Changed

- **Backups upload through the storage bridge again, signed, up to 1 GB without Aleph's IPFS host.** 0.24.1 uploaded by itself – an own `upload.js` beside `@le-space/orbitdb-storage-bridge`, and through Aleph's API only up to 25 MiB, so a full backup failed while the IPFS host takes no uploads. The storage bridge (0.27.0) now does what both did: the IPFS host first, else an API node's `add_file`, with upload progress; with this browser's key granted the signed STORE goes beside the file and Aleph keeps it in the same call, up to 1 GiB – no second message; the bridge uploads the same way with its own key. `upload.js` is gone; `keeper.js` `createBackupUploader` builds the backend and what keeps the upload, for the card and for "Automatisch sichern" alike. A backup above what the API takes is refused before a byte is sent, and the card says to set up the grant. The fake Aleph judges a signed `add_file` as it judges a STORE.

## [0.24.1] – 2026-10-26

### Fixed

- **Backups go on while Aleph's IPFS host takes no uploads.** Since 2026-10-26 `ipfs.aleph.cloud` (and Aleph's other IPFS hosts) answer `/api/v0/add` with 404, so every backup failed with "Aleph ingest answered 404". A backup up to 25 MiB – an increment, as a rule, and so "Automatisch sichern" – now goes through an API node's `/api/v0/ipfs/add_file` instead, with real percentages (that host allows the preflight), and is kept by its STORE as before; the IPFS host is not asked again in that tab. A bigger one says in words that Aleph's API takes no more without a signed order and that increments go on.

## [0.24.0] – 2026-10-26

### Added

- **Recovery words: the books open when every passkey is gone (#406, stage 2).** 24 words on paper – BIP39, 256 random bits, drawn by Belege, never chosen – are one more slot in the books' vault, its key from the words' seed. Offered right after new books are made and under _Einstellungen → Schlüssel_: shown once, three asked back, then kept nowhere but as that sealed slot (and, when the vault is kept on Aleph, at an index derived from the words, with no names). On the lock screen, "Mit Wiederherstellungswörtern öffnen" takes the words as typed or pasted – numbered or not; a misspelt or swapped word is caught by the checksum before anything is made –, finds the vault in this browser or on Aleph, makes a new passkey (two prompts) and gives it a slot: the same books, identity and keys. The keys page no longer calls one passkey with words "the only key"; renewing the vault takes the words out. Consent version 30; `docs/keys.md` describes the words and shows slot W.

### Fixed

- **The vault's index on Aleph is kept, not only sent (#406).** It was broadcast once: an answer that never came (Aleph is slow at times, though it processes the message), or `pending` followed by a rejection, looked like a kept index or failed for good. Now, after a minute without an answer or on `pending`, Belege asks Aleph for the message's status for up to five minutes, sends the same signed message again while Aleph does not know it, and reports a rejection – as paperless-anywhere does.

- **A full backup of several hundred MB goes through on a home uplink.** The upload gave up after two minutes (since 0.23.0: two minutes and 1 MB/s), so a 500 MB backup on a slower line ended with "Aleph ingest is unreachable: signal timed out" and was never kept. It now waits two minutes plus the time at 100 kB/s – 85 minutes for 500 MB –, and when even that runs out says so in words: how long it waited, that nothing was kept or costs, and to try again on a faster line with the tab in front.

- **The header no longer shows "Backup {percent} %".** Where Aleph's IPFS host does not let the upload be counted – its real one, for every page but its console – the header took the text meant for a counted upload, without a number. It now says "Backup wird hochgeladen"; the fake Aleph in the tests refuses that preflight as the real one does, and never lets one be cached.

## [0.23.0] – 2026-10-25

### Added

- **"Nicht gesichert" in the header, and automatic increments.** When the last backup lacks something – a payment, a receipt, a link, an AI result, entries that came by sync – the header says "Nicht gesichert (n)", with the areas in its tooltip; Belege compares each database's heads with the ones the backup chain last shipped, a moment after every write and after every backup (here or on an own device). "Automatisch sichern (auf diesem Gerät)" in the backup card uploads an increment by itself five minutes after the last change – never a full backup – while the network is not paused, this browser is let in or the bridge runs, and the credits last more than 30 days; otherwise the header says why not. On for one device only (`localStorage`), so two devices do not write the same chain's next increment.

- **A second passkey opens the same books: the books' vault (#406).** Every key was derived from one passkey's PRF output, so its loss meant lost books and unreadable backups, and a second passkey opened other, empty books. The root every key is derived from – that very PRF output, so nothing is sealed anew – now sits in a vault, sealed under a random vault key, with a slot for each passkey. Under _Einstellungen → Schlüssel_ a passkey is added (two prompts), removed, or removed with the vault renewed (each remaining passkey answers once); while there is only one, the page says what its loss would mean. Every slot opens the same books and every backup, older ones included. Kept on Aleph if chosen – sealed, at addresses derived from each passkey and from the root, with no names – an empty device finds the vault with any of the passkeys, and the account its backups are kept for. Consent version 29; `docs/keys.md` shows the vault.

- **What Belege protects against, and what not.** `docs/threat-model.md` (and `.de.md`): what the sealing answers (storage and relays, a copied browser profile, devices that are not yours, the language model) and what no web app can (a device or browser not under your control – browser extensions included –, a tampered build, losing every passkey), with what to do: a browser profile of its own without extensions, Android's Chrome, the release's IPFS CID to compare, and a planned desktop app. Linked from the README and SECURITY.md; the consent screen recommends the separate profile.

- **Keys and recovery, explained.** A new page, `docs/keys.md` (and `keys.de.md`), with a diagram of where every key comes from today, what is stored where, the passkey prompts, and plainly what a lost passkey means – and the vault planned in #406. Linked from the README and from the consent screen, under the note on losing the passkey ("Wie die Schlüssel funktionieren", in a new tab).

### Changed

- **A backup goes on while you work elsewhere, and shows how far it is.** "Jetzt sichern" ran inside the backup card: leaving the page hid it, and coming back offered a second run beside the first. The run is now the app's: the header shows it on every page ("Backup 42 %", or "Backup wartet auf dich" when it asks before uploading), one click leads back to the card, and closing or reloading the tab asks first. The card shows the step out of three with a bar. The upload is counted where the host allows it; Aleph's IPFS host refuses the browser's preflight for that (its upload itself is open), so there the upload is sent as before and the bar shows that it is going and for how long.

### Fixed

- **"Beleg finden" starts with the payment's year.** With no suggestion, the search opened on "Alle Belege" – every receipt ever kept, so typing the provider's name showed ones from 2019 for a payment in 2025. It now opens on "Aus {year}"; when that year has none, the list says how many other years have and that they are under "Alle Belege", which still holds them all.

## [0.22.0] – 2026-10-25

### Changed

- **One passkey prompt fewer when creating or restoring.** Since the books sign as themselves (#496), the passkey no longer signs an OrbitDB identity: creating a passkey asks twice instead of three times ("Passkey-Abfrage 2 von 2"), restoring one three times instead of four. The passkey's DID is still the one shown and the author of every record; unlocking still asks once. The consent screen's technical notes (version 28) and `app/README.md` say how the books sign now, and what `localStorage` holds.

- **The books write as an identity of their own (#496).** Every collection was opened with OrbitDB's default access controller, its write list the DID of the passkey that made the books and part of each database's address – so a second passkey or a recovery phrase could never write there (#406). The books now have their own identity, an Ed25519 key from the books' secret (derived from the passkey's PRF result until the vault keeps it), the root of each collection's `OrbitDBAccessController`, whose own list database is sealed like the others. On the first unlock with this version the passkey's databases move there with every entry and its clock; the passkey's DID is still the one shown and the author of every record. The next backup is a full one; a backup from before the move restores and moves in on the next unlock.

## [0.21.0] – 2026-10-24

### Added

- **A fake token's "transfer" is told apart (address poisoning).** A token contract can log a Transfer out of any wallet without its key; spam runs do so by the thousand, from tokens named like real ones ("U⁯S⁯DΤ" with a Greek tau), to an address made to look like one the wallet really paid. Such a booking showed as a payment needing a receipt, an account and a rate. A token without any rate that someone else moved out of an own wallet, or whose symbol has characters no real token writes, is now "Fake-Token (Adressvergiftung) – nichts bewegt, kein Beleg nötig"; the payment warns never to send to its address (and names the address it imitates, where one is known), and asks for no rate.

## [0.20.0] – 2026-10-24

### Added

- **Older backup chains can be deleted on Aleph.** Each "Neues Vollbackup" starts a new chain, and the older ones went on costing credits (about 54 a MiB a day) with no way to stop it from the app. The backup card lists them now – when made, how many increments, what they cost a day – and "Löschen", after "Endgültig löschen?", has Aleph forget every STORE of that chain (FORGET, signed with this browser's key; Aleph lets it forget what it could have sent itself, the bridge's STOREs too). The current chain is never offered, nor anything while it is not kept.

### Fixed

- **The AI card: the Ollama guide looks like a guide, and failures keep their model names.** The folded guide "Lokal mit Ollama: nichts verlässt den Rechner" had lost its disclosure triangle and read like a statement about the current setup, also with a provider on the internet; it is marked as a guide now and opens as one. The most frequent failure reasons folded every number into `#`, so `qwen3.8-27b-tee` became `qwen#.#-#b-tee` and "HTTP 402" (no credit) looked like "HTTP 500"; only measurements standing alone are folded now.

## [0.19.0] – 2026-10-24

### Changed

- **A receipt in another currency links to its euro payment (#474).** Matching gave amount points only for the same amount in the same currency, so a USD or GBP invoice paid by card from a euro account almost never linked by itself. Now the bank's original amount in the receipt's currency ("USD 87,00" on a card payment) counts as the amount (+40); without one, a euro booking in the receipt's date window gets the ECB rate of its day from the bridge, kept only when at it the amount comes within 3 % of what is open, and counts as a converted amount (+25, so it needs another sign such as the invoice number). "Warum diese Zuordnung?" names the rate, its day, and how far off it is. Crypto stays as it was.

### Fixed

- **A device gossipsub has stopped talking to is hung up and dialled again (#489).** OrbitDB's heads ride gossipsub, which stays on the first connection to a device; when the relay closed that circuit, the direct WebRTC connection beside it carried no gossipsub, and nothing replicated while the device looked connected (#393). The redial round now asks whether a connection carries a gossipsub stream; one that has none for 45 s is hung up – at most once per device in five minutes – and the next dial builds one gossipsub uses. Measured: a stalled burst of 100 bookings came back after 53 s instead of never. A stopgap: the bug is gossipsub's, and #393 and #403 stay open.

- **"direkt" in the devices card means what the badge means.** The card called a device direct by libp2p's `limited` flag, the badge by the address; a circuit through a relay that sets no limits (the bridge's) was "direkt" in the card and "über das Relay" in the badge. Both read the address now, and a circuit through the bridge's relay, itself reached over `/webrtc-direct`, is no longer taken for WebRTC.

- **The network badge says how devices meet, and what is history.** Its first line was always "über ein Le-Space-Relay (TLS-WebSocket)", also in "Ohne Relay, per QR" where there is no relay; it follows the mode now (directly over WebRTC by QR; through the bridge's relay; both). The last ping answer of a device that is gone since says "seitdem nicht mehr verbunden" instead of reading as current, and an entry written here while no device is connected "geht beim nächsten Verbinden hinaus" instead of "an die Geräte".

## [0.18.0] – 2026-10-23

### Changed

- **Nothing is blacked out for LibertAI confidential, unless asked (#416).** Nobody between the Mac and the attested enclave can read the text, so redaction only cost reading quality. `pnpm setup:llm` (choice 2) now asks "Black out … anyway? [y/N]" and defaults to no; the bridge sends the text as it is into the pinned enclave, as to a model on this machine. The KI card says "aus – das Modell läuft in der attestierten Enklave", and every AI hint has its own wording for it ("ungeschwärzt – lesen kann ihn nur die geprüfte Enklave") instead of claiming "geschwärzt" or "auf diesem Rechner". `/llm/status` tells it apart (`redaction.enclave`). The consent screen says so (consent version 27).

## [0.17.0] – 2026-10-23

### Added

- **The QR invite is a link a phone's camera opens.** The invite's code is `https://…/#qr=<signed invite>`: the camera opens Belege at it, the invite leaves the address at once (the fragment never reaches the server), the tab keeps it ten minutes, and once the passkey has opened the books the network menu opens and shows the answer for the inviting device to scan. In-app scanning and pasting take the link or the bare code. A device that is not in "Ohne Relay, per QR" is offered the switch (it applies after a reload; the invite waits), never switched by itself. In iOS Safari outside the home-screen app the menu says that the app keeps its books apart from Safari and should be used instead.

- **The QR code exchange in the network menu.** In "Ohne Relay, per QR" (and "Beides") the header's network menu has "Gerät per QR verbinden": invite, scan, answer and paste, as in Integrationen → Eigene Geräte – unfolded when the menu opens with no device connected, since it is needed after every reload. The exchange is one component now (`sync/QrExchange.svelte`) for both places. A click that swaps its own button (scan → camera) no longer closes the menu.

- **LibertAI confidential: receipts read in an enclave the bridge attests itself (#416).** `pnpm setup:llm` offers "LibertAI, confidential": it looks up the enclave for `qwen3.8-27b-tee` in LibertAI's signed manifest, checks it (AMD signature chain, the report binding the TLS key served, the launch measurement, no debugging), shows deployment, measurement and source commit, and pins them on a yes. Every model request then goes to that enclave over a TLS session that ends inside it (`@libertai/confidential-inference`), never through `api.libertai.io`; a replaced deployment fails with `LLM_ATTESTATION_FAILED` until re-pinned on a yes – no fallback. Redaction stays on. The KI card shows the pin and the last check; the consent screen says what this proves and what LibertAI still sees (consent version 25); docs/ai says how. The key comes from console.libertai.io.

- **A data light and a sync log for own devices.** Beside the network badge's dot, a second light flashes gold when an entry comes from another own device and cyan when one written here goes to them; hovering names the last one (from which device, which book, when). Integrationen → Eigene Geräte shows per device when it last sent something, and a "Sync-Protokoll": per entry when, from which device or written here, which book, new/changed/deleted, and what it is – a receipt's file name, size and date, a payment's counterparty, amount and day, a setting's key. The log stays on this device only, sealed under a key of its own from the passkey, the newest 300; never in the books, or every device would log the others' log. Every device writes with the passkey's identity, so "here" is told by the entries this session wrote; what came is attributed to the device the database last exchanged heads with.

### Changed

- **LibertAI confidential reads without the model's "thinking".** In the enclave `qwen3.8-27b-tee` thinks before it answers; measured on six made-up receipts through Belege's own extraction request, that took 38 s and up to 6,000 tokens a receipt and left two unread, against 5.8 s, about 370 tokens and all six right with it off. In TEE mode the bridge now sends `enable_thinking: false`; other providers' requests are unchanged.

### Fixed

- **A phone that uses the Mac's bridge picks up the pairing when it arrives.** The token is the Mac's and comes to the phone with the books by sync, often after a page has read the settings; the KI card then said "Die Bridge ist nicht gekoppelt" until the app was reopened (#457 only re-read it when a page opened). While no token is known, every change to the settings now reads it again, and the bridge's status follows at once.

- **The shared folder reads new files with the AI only while "gleich auslesen" is on (#475).** The minute-by-minute folder check (and "Ordner jetzt prüfen" in a payment) sent every new file to the model whenever a bridge was paired, ignoring the switch beside the upload. It follows the switch now, which says so ("Neue Belege gleich auslesen und zuordnen (Hochladen und freigegebener Ordner)"); files left unread wait under Belege → Neu, and the result says how many, and how many images had no text. Images go to the extraction, which marks them without sending anything. The consent screen names the folder among the AI's uses (consent version 26).

- **Matching catches up on what came from another device, and on unlock (#473).** It ran only after an import or an action on this device: a receipt fetched on the Mac and its payment booked on the phone waited for the next click. Now one run starts 5 s after entries came by sync (payments, receipts, links, the matching settings), and one after unlocking when the books are not as this device's last run left them (a fingerprint kept in this browser). The same pair linked on two devices before they saw each other's link is settled on the next run: one link stays – a confirmed one before an automatic one, then the oldest – on every device alike.

- **"Aus Paperless holen" goes on past a slow document, and says where it is.** A first fetch of a thousand documents stopped at the first one Paperless did not deliver within two minutes, with a bare "TimeoutError: signal timed out" – the bridge's timeout also covers reading the file, and that part was not caught. Now the bridge names it ("Paperless did not deliver the document within 120 s", `PAPERLESS_TIMEOUT`), the app skips that document, counts it ("… diesmal nicht rechtzeitig geliefert – der nächste Abruf holt sie") and goes on, and the mark of the last fetch stays where it was, so the next fetch lists it again (the ones in already are not downloaded again). Three in a row, and Paperless is taken to be down: the fetch stops and says so. While it runs: "Dokument 412 von 1065 …".

## [0.16.0] – 2026-10-23

### Added

- **The network badge shows what is actually connected, and lights up when an own device answers.** Hovering it now names this device's peer id, its addresses at the relay, and for each connected own device its peer id and every connection to it – the remote multiaddr, direct (WebRTC) or through the relay, the last round trip in ms – and when the last ping came back. The dot flashes in another colour each time an own device answers the ping libp2p's connection monitor sends anyway (every 10 s): watched, not sent – no traffic of its own.

- **The backup card links Aleph's dashboard.** Beside the credits: "Credits kaufen oder überweisen" (app.aleph.cloud → Credits: top up, transfer, history). Under the grant command: the same grant without a terminal, in the dashboard's Permissions – the browser's address, message type STORE, channel BELEGE-BACKUP.

- **"Wer hält es?" for every backup.** Under each backup in the history, a click asks IPFS delegated routing (through Helia's delegated routing client) which nodes announce its CID, names those that are Aleph core channel nodes (Aleph's `corechannel` aggregate, by IP) and places each IP with ipwho.is: node, IP, city and country, network, and the spread by network and country. Asked only on that click; the card names the three services and what they see.

- **Incremental backups (#454).** After a full backup, "Jetzt sichern" uploads only what is new since the last one: the new log entries and receipt files, sealed as before, through the storage bridge's `/live-backup` (`collectIncrement`, `mergeIncrements`). A day of new payments is kilobytes instead of a whole copy of the books – about 500 MB, some 26,000 credits a day on Aleph, for a year of receipts. Aleph keeps an increment with its full backup's CID as the STORE's `ref`; "Wiederherstellen" lists each full backup with its increments, fetches all of them and refuses a chain with a hole. "Neues Vollbackup" starts a new chain. The bridge's `POST /backup/aleph/pin` takes the `ref` (an older bridge keeps the increment without it: the page says so and the next backup ships everything since again). Where the chain stands lives in the sealed settings, so another own device continues it.

### Changed

- **The backup card says, in a box of its own, where the backup lies and what that means.** Before anything goes up: spread over many of Aleph's IPFS nodes instead of one data centre (on all of them, according to Aleph's support – this may change), so it stays reachable when a provider or region goes down, as at OVH Strasbourg in 2021, and comes back from any node that has it; only the passkey opens it; public are the sealed file to whoever knows its CID and, in Aleph's message log, each backup's CID, time, size and paying account. Whether that suits is the user's choice; who does not want it waits for the backup on Filecoin Onchain Cloud (#459). docs/backup says how to list the nodes that hold a backup.

## [0.15.0] – 2026-10-23

### Fixed

- **A device that reaches the bridge through another one finds its pairing on every integration page.** The token comes with the books by sync; when it arrived after the first read, the overview showed "über deinen Mac" while the KI card said the bridge was not paired, until a reload. A page now reads the token again while none is known.

### Changed

- **The backup card says what a backup costs, asks Aleph again, and shows the paying address once.** Every backup is a whole copy, paid every day: above "Jetzt sichern" the card shows what the kept backups cost a day together and how long the credits last, and when a new one would leave less than 30 days, it asks before uploading (an estimate, about 54 credits per MiB and day). "Erneut prüfen" now asks Aleph about every backup in the list, by its STORE's item hash (shown, with a link): a request Aleph does not know or refused says so, and "Aleph erneut beauftragen" sends a new STORE for the same file without uploading it again. A 499 MB backup had stayed "Aleph hat noch nicht bestätigt" for good, though Aleph had no request for it. "Erneut prüfen" also reads the credits from Aleph again, not the bridge's answer from when the card opened. The paying account's address shows once, with "Ändern"; the field only to change it. The card says the sealed file lies on Aleph's IPFS – fetchable by its CID, not readable – and that Aleph does not say on how many nodes.

## [0.14.0] – 2026-10-22

### Added

- **"Beleg finden" searches Paperless too.** With Paperless-ngx set up in the bridge, a chip "Paperless" beside "Privates Postfach" asks Paperless' own full-text search – with the search text, else the payment's counterparty – and lists title, correspondent, date and type, and whether the document is among the receipts already. "Übernehmen und zuordnen" takes it over like an upload: read, linked to this payment as your decision, kept as from Paperless so a later fetch knows it. New bridge route `GET /paperless/search?query=` (at most 25, no OCR text; the log never gets the words).

### Changed

- **The KI card says why it blacks out a local model, and why reads failed.** A model on 127.0.0.1 whose `setup:llm` answer is missing (a config from before #423) is blacked out since #438; the card now says so, with `pnpm setup:llm` to copy. Under "Bisher" it shows how many failures were in the last 7 days and the three most frequent reasons, numbers folded – so an old run (credit used up, a slow model) is told apart from a problem now.

- **"Beleg finden" lists receipts by nearness in time, not by which came in last.** Where no receipt scores, the list opened on the newest receipts – a payment from January 2025 showed receipts of 2026 first. Now receipts with points come first, then the rest by how near their date (else the day they came in) is to the payment, undated last; a penalty (a far date, the other direction) no longer puts a receipt below the unranked. A receipt not read yet shows "eingegangen am …, noch nicht ausgelesen" instead of "—". A new chip "Aus <year>" lists only the receipts of the payment's year.

### Fixed

- **A folding phone shows the app at its own width again.** Below 768 px the payments page was as wide as its month strip – nine months made it 1,664 px – and the phone zoomed the whole app out to fit, small and movable sideways. The strip scrolls inside its column now. On a narrow screen a payment's account and amount take a line of their own instead of running off the edge; between 640 and 1024 px (a folding phone opened) the name and the switches share the first row of the header and the state takes the second, instead of the name squeezed to a column of single words. A new E2E spec checks six pages at 344 and 690 px.

## [0.13.0] – 2026-10-22

### Added

- **`pnpm setup:origins`: which pages may call the bridge**, without editing `bridge.json` or running `setup:hibiscus` again: `-- --add <origin>`, `-- --remove <origin>`, `-- --defaults`; without flags it lists them. Only `appOrigins` changes.

### Changed

- **A bridge that does not let this page in says so, with the command that does.** "Status prüfen" under Integrationen → Bridge said only "nicht erreichbar"; now it tells a running bridge that refuses this page apart and offers `pnpm setup:origins -- --add <this page>` to copy, as the setup guide does. The bridge's log names the same command for a refused origin, and its start-up line says how to change the list.
- **"Übernehmen" in Bücher umziehen shows where it is, and a take-over cut short carries on.** Large books (here: 357 payments, 1,399 receipts, 1,424 files) take minutes, and the card said only "Arbeite …". It now shows each step – opening the file, the receipt files, the records by collection, each with a bar – and the time so far, with a word to keep the tab open. A take-over stopped by a reload or a closed tab left half-filled books that refused any second try; now those books take the same file, or a newer one from the same old books, again and finish – records keep their ids, so nothing doubles. A file from other books is still refused.

## [0.12.8] – 2026-10-22

### Changed

- **Storage bridge 0.17.0 → 0.22.1.** Nothing Belege calls changed its shape: `createAlephBackend`, `createAlephPin`, `createAlephAuthorizer`, `listAlephStores`, `waitForMessage` and `buildAppBackup` answer as before. What the install drops is Storacha: the bridge no longer carries the 28 `@storacha/*`, `@ucanto/*` and `@web3-storage/*` packages for a service that shut down in May, and `dotenv` leaves with it. The lockfile leaves the bridge's optional Storacha peer unresolved on purpose, so a reinstall does not bring them back. 0.22.1 is the first version whose Storacha driver loads its client lazily; 0.22.0 broke the Vite build of any app without the peer.

### Fixed

- **The VAT card counts credit notes, other currencies, instalments and undated invoices right.**
  - Under Ist, an own credit note refunded to the customer took no VAT off; payments now count in the invoice's own direction.
  - An own invoice or a receipt in another currency was summed as if its amount were euros, the small-business limit (§ 19) included. Now it counts in euros: under Ist with the euros that came in, under Soll and on the VAT kinds with the euros the books know (a linked payment, a rate kept); without them it is listed apart ("Kurs fehlt", "andere Währung") and not summed.
  - Instalments rounded each payment's share on its own, so two halves of 1,01 € made 1,02 €; the parts now add up to the invoice's VAT to the cent.
  - Under Soll, an own invoice without a date counted nowhere and was not listed either; now it is shown as undated.

## [0.12.7] – 2026-10-19

### Changed

- **A move file made for an earlier one-time key says so.** Picking one on a page whose key has changed since (it was reloaded) named "another key, or changed"; now it names both fingerprints and says to make the file again with the key shown.
- **The identity-cache workaround comes from the provider now.** OrbitDB refuses another session of the same passkey ("… is not allowed to write to the log", orbitdb/orbitdb#1258); the wrapper that answered this in `session-identities.js` since #259 is `withoutStaleIdentityCache` of `@le-space/orbitdb-identity-provider-webauthn-did` 0.11.0, shared with simple-todo, and Belege imports it. The provider moves from 0.8.0 to 0.11.0 with it.

## [0.12.6] – 2026-10-17

### Fixed

- **A keychain that could not be read no longer means "no key".** `pnpm setup:aleph` made a new backup key when the keychain refused (denied, locked, a session without access) or held something else, and replaced the funded account's key for good; now only a missing entry makes one, anything else stops with the reason. The sealed Enable Banking file keeps its key the same way, and its setup no longer drops the linked banks on such an error.
- **A restore that fails leaves the books open.** The books were closed before the backup was opened; a backup made with another passkey, or a broken download, left a page that looked open but could no longer write. Now they close only once the backup opened with this passkey and fits these books; a failure after that reloads the page.

## [0.12.5] – 2026-10-17

### Security

- **Exports and mail intake harden against hostile content.** Text cells in the month overview CSV and the DATEV file that a spreadsheet would read as a formula are kept as text; a mail's character references that name no character become U+FFFD; a mail that cannot be read as text no longer stops the month's export; files embedded in a PDF are read only when their name is an e-invoice's, and only up to 5 MB; long words in a mail's PDF are cut by halving.

## [0.12.4] – 2026-10-17

### Security

- **Text goes unredacted only to a model `setup:llm` was told runs on this machine.** A bridge config from before #423 had no answer and counted a loopback URL as such a model – a proxy on 127.0.0.1 that forwards to a provider then got the text unredacted. Now an unanswered config blacks out (the bridge says at start how to switch it off), and `off` with a URL that is not loopback blacks out too. The request to the model follows no redirect. `/llm/status` says `local`, and the app's "ungeschwärzt" hints need it.
- **The app opens the books only on an origin of its own:** the domain, or a gateway that gives every CID its own subdomain. On a path-style gateway (`…/ipfs/<cid>/`), whose origin all CIDs there share, it asks for no passkey, opens nothing, removes its service worker, and says where to open it. The release notes no longer link a path-style gateway (since 0.9.1 they did).

### Fixed

- **Hospitality on a travel statement claimed too little input VAT in DATEV.** The deductible line carried 70 % of the net plus the whole VAT under the VAT key, the rest went to 4654 without one; DATEV works the VAT out of a line's gross, so of 19,00 € only 14,21 € were claimed, and a bill at 7 % and 19 % claimed none. Now each VAT rate's gross is split 70/30 onto 4650 and 4654, both with the input VAT key. A bill in another currency splits its euros from the statement, where it was booked as all non-deductible. Statements booked before keep their lines; a correction books the new ones.

## [0.12.3] – 2026-10-16

### Changed

- The backup card calls the product "Le Space Belege", as the consent screen does since #432.

## [0.12.2] – 2026-10-16

### Changed

- **The AI hints say "geschwärzt" only where it is true** (#431). With a model on the bridge's own computer nothing is blacked out (#423); the hints on "Alle neuen auslesen", the upload, mail and portal imports, "Mit KI weitersuchen", the AI suggestions and the vendor timeline then say that the text stays on the computer, unredacted. The app asks the bridge after unlocking and pairing; without an answer it keeps the cautious wording.
- **The consent screen folds its sections** (#431): "Nutzung und Haftung" and the coloured sections (Identität, Speicherung, Netzwerk, KI, Externe Dienste, Womit Le Space Belege arbeitet) open on a click, keeping their colours; "Nutzung und Haftung" and "Was Le Space Belege kann" got one too. The warning about losing the passkey stays in view. "Eigene Geräte einschalten …" opens the screen with the network section unfolded. The product is called "Le Space Belege" throughout the screen.

## [0.12.1] – 2026-10-16

### Fixed

- **A passkey prompt is answered only by the passkey it is for** (#429). After the first touch, every prompt names its credential, so a second Belege passkey on the same security key can no longer answer it – which left keys from one passkey and the identity from the other, and the first write failed with "… is not allowed to write to the log". The picker shows the name typed under "Name für den Passkey" instead of an id like `belege-3f2a…` (new passkeys only).

### Changed

- **Creating or restoring a passkey says what each further touch is for** (#429): before the second and third prompt of "Passkey anlegen" (and the third and fourth of a restore) a short dialog names the step ("Passkey-Abfrage 2 von 3"), says what it is for, and the prompt starts on "Weiter". "Abbrechen" stops before anything is opened. Unlocking stays one touch.

## [0.12.0] – 2026-10-15

### Added

- **`pnpm demo`: Belege with made-up books,** for trying it out or recording a demo. It starts the bridge in test mode on its usual port with a fake Hibiscus (a business account whose payments fit the invoices), a fake mailbox (invoices as PDFs, a phishing look-alike, a private mail, an invitation) and the local Ollama when it runs with its model, else a fake model (`-- --fake-llm`); `-- --lan` adds the relay for a phone in the same Wi-Fi. Nothing real is read or written; the configuration lives in a temporary folder, deleted on Ctrl+C.
- **Travel receipts ask: business trip, business without a trip, or private** (#425). Every trip proposal on _Reisen_ now has three answers: "Als Reise anlegen", "Geschäftlich, keine Reise" (was "Keine Reise") and "Privat", which sets each receipt aside as private and marks a payment from the business account that paid one as private (#293, #172), both reversible. A conference or event ticket alone is a proposal of its own ("Veranstaltung in …"), so it is asked about too. The AI only reads the receipts; rules propose, and nothing is decided without a click.
- **The Verlauf shows a receipt's preview,** as Zahlungen, Reisen and the export do: hovering "Beleg öffnen" on an entry – read, failed or decided – shows the receipt with its lens; on a touch screen a "Vorschau" button opens it.

## [0.11.1] – 2026-10-15

### Added

- **A guide for reading receipts with Ollama on your own computer** ([docs/ollama.md](docs/ollama.md), [Deutsch](docs/ollama.de.md)): what to download for how much memory, the two Ollama settings that matter (context length, keep-alive), the `pnpm setup:llm` answers, one AI request at a time, the measured speed on an Intel Mac, and what to do when something goes wrong. _Integrationen → KI – Beleg-Auslesen_ shows the steps in short, with a link to the guide; open while no model is set up or the model is local. Linked from the README and docs/ai.md.

### Changed

- **No redaction for a model on this machine** (#423). The bridge sends text as it is when the model runs on this computer (Ollama, LM Studio): nothing leaves, and redaction would only hide from the model what the receipt says. `llm.redaction` in `bridge.json`: `auto` (default) is off for a loopback base URL, on otherwise; `pnpm setup:llm` asks for a loopback URL whether the model runs there (a proxy may forward to a provider) and stores `off` or `on`, and asks for terms only when they are used. Every LLM route goes the same way. `GET /llm/status` and _Integrationen → KI_ show whether text is blacked out.

- **Who offers Belege, and on what terms.** The consent screen has a section "Nutzung und Haftung": Belege is provided free of charge by Le Space UG (haftungsbeschränkt) as free software (AGPL-3.0), without warranty; Le Space UG is liable only for intent and gross negligence (statutory liability for injury to life, body and health and under the Product Liability Act unaffected); the books are on the user's devices and theirs to back up; Belege prepares bookkeeping and replaces neither bookkeeping nor tax advice. It links the imprint and privacy policy of Le Space UG on le-space.de (`#impressum`, `#datenschutz`), and the footer has an "Impressum" link. Consent version 24.

### Fixed

- **A model on this machine gets ten minutes per answer.** On a CPU (Ollama on an Intel Mac) one receipt takes two minutes and more, and the first after a pause also loads the model; the bridge's three minutes cut a part of them off. A model on 127.0.0.1/localhost now gets 10 minutes, one elsewhere still 3. A timed-out attempt says `no answer within … s` instead of `unreachable: timeout`. [docs/ai.md](docs/ai.md) has the measured numbers and the Ollama settings that go with them.

## [0.11.0] – 2026-10-15

### Added

- **A provider that refuses stops the AI run and says so** (#417). No credit left (HTTP 402), an API key it refuses, a model it does not know, or no answer at all (a local Ollama not running) each get their own code from the bridge (`LLM_NO_CREDIT`, `LLM_AUTH`, `LLM_MODEL`, `LLM_UNREACHABLE`); the second model is not asked when the refusal holds for the whole account. "Alle neuen auslesen" and the AI suggestions stop at once instead of failing every receipt, mark none as failed, and say what to do ("Das Guthaben bei DeepSeek ist aufgebraucht …"); Home offers "Weitermachen" for the rest, with the reason. The bridge log names each attempt's model, status and time, never the text; `GET /llm/status` keeps the last refusal.
- **Paperless-ngx as a receipt source, in the app** (#318). With `pnpm setup:paperless` done, the Belege page fetches what Paperless added since the last fetch – when it opens and on "Aus Paperless holen" – as receipts of the new source "Paperless", read right away like mail. A document already known is not fetched again; the original file makes a mail attachment that also reached Paperless a duplicate; a scan or photo without a text layer is read with Paperless' OCR text. While Paperless is on, Belege does not fetch the mailbox itself (it says so where the mail card was), unless "Belege ruft das Postfach trotzdem selbst ab" is ticked – then documents with the Paperless tags named there are left out. Integrationen lists Paperless; the consent screen names it (consent version 23); the Verlauf records each fetch.
- **Paperless-ngx as a receipt source, the bridge's part** (#318). `pnpm setup:paperless` stores the address (https, or http on this machine only) and the API token (keychain). `GET /paperless/documents?since=` lists what Paperless added, with its OCR text, tag, correspondent and document type names; `GET /paperless/document?id=` hands out the original file when it is a PDF or an image – so a mail attachment and its Paperless copy have the same hash – else the archive PDF. No redirect is followed, nothing over 15 MB, and the log gets counts, never titles or text. The app's side follows.

### Changed

- **The consent screen says first what sets Belege apart** (#412). The intro names bank accounts, crypto wallets and exchanges together with receipts – locally on the device, not in a cloud. Three highlights follow right under it, before anything is folded away: _Local, not in a cloud_, _Crypto included_ (Kraken and own wallets, booked in euros at the day's rate, matched like bank payments, in the DATEV export) and _Bank and receipts, matched_. In the folded feature list, crypto now comes right after privacy. What is consented to is unchanged.

### Fixed

- **Books no longer rest on the browser's goodwill unasked.** Everything lies in the browser's IndexedDB, and a browser that has not granted persistent storage may clear it when the disk runs low – silently, while the passkey still unlocks, into empty books. Belege now asks for persistent storage on every unlock, not only from a button under _Einstellungen → Speicher_. Home warns while the browser has not agreed and there is no second copy (no backup in the last 7 days, no own device), with the way to each; once the browser keeps the books, a reminder asks for a backup, put away for a week at a time.

## [0.10.0] – 2026-10-14

### Added

- **Payroll and tax documents linked to their payments** (#233, #410). On a receipt, "Lohn- oder Steuerunterlage …" keeps it as a payroll run's payslips or journal, a wage-tax return, a contribution statement or a tax assessment, for a period (`12/2025`, `2025-Q4`, `2024`). Kind and period are proposed from the file name, subject and text; the payments of that kind and period are ticked, and one click links the document to all of them – nothing is linked by itself. The DATEV booking text of such a payment says what it is and for which period (`Lohn 12/2025 …`, `LSt 12/2025 …`) instead of the vendor. See [matching.md](docs/matching.md).
- **Docs: where the secret lives.** An illustration in the backup docs (`docs/backup.md`, `docs/backup.de.md`) shows what stays on the device — passkey, HKDF, data key, the encrypted receipt files and OrbitDB log — and that only ciphertext crosses the device boundary. The README's docs list now links the backup docs.
- **Company credit cards** (#382; #405, #407). Each card is an account of its own, under _Integrationen → Bank_, with a name and the card number's last four digits. See [banking.md](docs/banking.md).
  - **The statement from the issuer's CSV,** read in the browser: the columns recognised by their usual German and English names, the lines shown before the import, a column or the sign changeable, the choice kept for the next statement. Charges become money out; an amount in another currency keeps its currency and the issuer's rate.
  - **Each line is a payment:** the matching links it to its receipt, which then counts as paid by the company – and a receipt in another currency on a trip takes the euros the card charged.
  - **The monthly debit** on the bank account is an own transfer to the card, no receipt asked for: paired with the card's settlement line, or known by the card's last four digits and a card word – four digits alone never do.
- **Employees as travellers** (#380; #398, #400). Under _Einstellungen → Reisende_: the owner and employees, each with their own clearing account (an employee's statement is not made without it) and the IBAN's last four digits, which suggest a person's statements for a transfer. Reisen, a trip and a receipt's "Zu einer Reise …" say whose a trip is. An employee's statement uses the employee accounts (466x) whatever the legal form. For employees only, **nights without a hotel invoice** can be ticked one by one: 20 € in Germany (R 9.7 Abs. 3 LStR), abroad the BMF letter's overnight rate, booked on 4666 without VAT.
- **Advances before a trip** (#381, #402). On a payment, "Vorschuss für Reisekosten …" marks it for a person and, if known, a trip – no receipt of its own, booked against the person's clearing account. Advances settle with the statements (for a trip on its statement, else the oldest first); the statement and its PDF show "Bereits als Vorschuss gezahlt" and what is left to pay out, or what the person owes back.
- **Meal allowances abroad** (#379, #392): the per-country table of the BMF letters for 2025 and 2026, exactly as printed, with cities that have rates of their own (Moskau, Paris, New York City …) picked on the border crossing. A country the letter does not list takes the rates the letter names (Luxembourg's; a territory its mother country's), named as a warning. Generated from the letter's text by `app/scripts/travel-rates-abroad.mjs`; a test fails in a new year until its letter is in.
- **Month balances of crypto accounts from their source** (#287; #389, #396). The monthly statement takes a wallet's opening and closing balance from Blockscout's own balance history (the native coin of an EVM chain), from the Monero CLI export's running balance, or from a wallet's history summed where it adds up to the chain's balance – and reconciles the month: a booking missing or deleted shows as "nicht abgestimmt" in the month it belongs to. Cosmos wallets and EVM tokens still work back from today's balance (#395).
- **Resilience, measured** (`pnpm --filter @belege/app bench:resilience`, [docs/resilience-report.md](docs/resilience-report.md)). Two devices of one passkey replicating over the test relay and with no relay (QR), a partition with writes on both sides, a browser that lost everything restoring from the archive, and the app's first visit from the domain and from an IPFS gateway by CID (`bench/delivery.mjs`) — at 50, 500 and 2 000 bookings, raw numbers in `app/bench/results/`. Found and named: a burst over a relay with the library's default circuit limit stalls, the 23 s reconnect after a pause, and a restore that grows superlinearly (orbitdb-storage-bridge#152). The test relay lifts its circuit limit with `E2E_RELAY_UNLIMITED=1`.
- **The relay stall, explained** (#393). The benchmark now watches both devices' connections, their streams, gossipsub's peer list and OrbitDB's heads exchanges during the burst (`__belegeE2E.bench.connections()`, `pubsubPeers()`, `netlog()`), keeps the result even when the burst stalls, and can wait before the burst (`RESILIENCE_BURST_DELAY_MS`) and bound the stall (`RESILIENCE_BURST_TIMEOUT_MS`). The test relay takes one limit at a time (`E2E_RELAY_DATA_LIMIT`, `E2E_RELAY_DURATION_MS`). What it showed: gossipsub keeps its streams on the relay circuit even once a direct WebRTC connection exists, and when the relay closes the circuit it opens no new ones — the burst then arrives only if a connection is young enough to trigger a connect event after the close, and never after a circuit expires on an idle, established connection (0 of 100). The report had blamed orbitdb-relay#59; that bug is real, but on the relay, and the benchmark's relay runs no orbitdb-relay code. The report and its German twin say so now.
- **The resilience benchmark can run against a real relay.** `BENCH_RELAY_ADDR` names an outside relay — one of the Le Space relays on Aleph — and the run starts no local one; the result records which relay it went against. For the circuit expiry of a production relay (20 minutes) together with `RESILIENCE_BURST_DELAY_MS`.
- **Three runs against the Le Space relay on Aleph** (`app/bench/results/2026-10-14-resilience-replication-relay-50-aleph-quiet21m*.json`, [docs/resilience-report.md](docs/resilience-report.md)): the burst of 100 arrives in full over WebRTC every time, but both devices lose the relay within seconds to minutes and never dial it again (#403). Read from the relay's journal and the pages' own libp2p logs, the cause is libp2p's connection monitor aborting after a ping unanswered for 5 s on a lossy uplink — the relay was healthy (NiKrause/orbitdb-relay#63). `BENCH_LIBP2P_DEBUG=<debug namespaces>` turns libp2p's logging on in both pages and the benchmark keeps the matching console lines in the result.
- **Two more runs against the Le Space relay, at 50 and at 500 bookings, without the quiet** (`app/bench/results/2026-10-14-resilience-replication-relay-{50,500}-aleph-0-10-10.json`, [docs/resilience-report.md](docs/resilience-report.md)): bursts 100/100 in 5.5 s and 2.4 s — through the relay's circuit this time, gossipsub never left it, and no connection was lost. Pairing 1.8 and 3.3 s, late joiner 2.4 and 17.6 s, round trips 233 to 378 ms.

### Fixed

- **A form in a payment's detail kept its choice** (payout of travel statements, advance, outlay repayment): it closed whenever the payment came back from a refresh – after every matching run – and what was being picked was lost.
- **The payout of an employee's travel statement** was suggested the owner's account (the shareholder clearing account, or 1800 for a sole proprietor); payouts and advances now go against the person's own clearing account.
- **Hospitality bills without a trip** were in every traveller's statement; they are the owner's only.
- **A release opens by CID from a path-style IPFS gateway** (`https://ipfs.aleph.sh/ipfs/<cid>/`), not only from a subdomain gateway: the start page is prerendered, so its asset paths are relative and it finds its base under any path; the manifest and the service worker follow. The SPA fallback a deeper route reloads into is now `200.html`; the domain's catch-all serves it. See [deploy.md](docs/deploy.md).

## [0.9.1] – 2026-10-13

### Changed

- **The logo leads to the product page** (le-space.de/belege/), not to the local-first stack site: someone who clicks the mark wants to know what this app is, and that page says so – and names the set-up offer.

## [0.9.0] – 2026-10-13

### Added

- **VAT on Home: output VAT, the payable, and the international cases** (#195, #355; #354, #356, #357, #358, #359, #361). The card showed the input VAT only.
  - **Output VAT** of our own invoices, when the money comes in (Ist, the default) or on the invoice date (Soll) – a setting under Buchhaltung – and the **VAT payable** or refund per month or quarter. The invoicing app sends each invoice's VAT per rate and category and the customer's VAT ID (UCEP invoice extension 0.3.0, #361); an invoice whose VAT it did not send (an older app) is named, never counted as zero.
  - **Own invoices among the receipts** – uploaded or from the mailbox – are recognised by the company names or the own VAT ID (a new setting) and counted as output VAT; before, their VAT was counted as input VAT. Each receipt says so and can be set otherwise.
  - **The international cases**, read from the invoices (the parties' countries, the customer's VAT ID, a category per VAT line; from the XML for e-invoices): intra-EU supplies with the lines for the EC Sales List (ZM), third-country turnover, §13b in Germany, exempt turnover and intra-EU acquisitions. What cannot be told without guessing is named with a link to the receipt.
  - A small business (§19 UStG) sees its turnover against the limits.
  - A help for the advance return, not the return itself.
- **Travel expenses** (#213; #362–#378). Trips with their receipts, the statutory meal allowances, mileage and hospitality; one statement a month, booked and paid out. See [travel.md](docs/travel.md).
  - **Trips:** destination, reason, departure and return, each border crossed with its country; the allowance per day by hours and by the country reached last, with the three-month rule; meals provided deducted; mileage by route. A receipt in another currency counts in euros, never its amount as euros (#375).
  - **Recognised, never assigned by itself:** a receipt's kind of travel cost from the extraction, and without AI from the words tickets and bills print in eleven languages (#365, #369); trips proposed by rules from fares and hotels that fit together (#370); appointments from the calendar part of an invitation mail – title, place and times only (#371).
  - **The statement:** numbered (`RK-…`), a German A4 PDF in the look of the Eigenbelege with the trips, allowances, mileage and receipts; a correction replaces it (#372).
  - **Booked** on the traveller's clearing account by legal form, each line on SKR 03 travel accounts – allowances and mileage without VAT, hospitality 70 % of net plus the VAT; receipts already booked as outlays or paid by the company are not booked again. The lines go into the month's DATEV Buchungsstapel, the statement and its receipts into the ZIP (#376).
  - **The payout:** a transfer to the traveller is linked to the statement, in parts or several at once, and booked against the clearing account as a private repayment; Reisen says what is paid out (#377).
- **E-invoices: XRechnung and ZUGFeRD / Factur-X** (#160, #350, #352). Since 1 January 2025 every business in Germany must be able to receive B2B e-invoices, and for an e-invoice the XML is the original to keep. Belege had refused an XML file as unsupported.
  - **XRechnung** (UBL or CII), uploaded or from the mailbox: kept as the XML it came as, read at once without AI – seller, number, dates, VAT per rate, lines, total; credit notes negative, reverse charge recognised – and shown as a plain view of its fields.
  - **ZUGFeRD / Factur-X**: the PDF is read from the XML it carries, which is kept beside it; a PDF from a sender not confirmed is opened only after the confirmation. MINIMUM and BASIC WL are named as no EN 16931 e-invoice.
  - The export puts the XML into the ZIP (beside the PDF for ZUGFeRD); backups and book moves carry it.
- **Move books to another passkey** (#328, #341, #342, #346). A passkey belongs to its address, and the books' DID and keys come from it: books on `localhost` and on belege.le-space.de, or under an old and a new passkey, were separate books with no way from one to the other. Integrationen → Backup → _Bücher umziehen_ now takes every payment, receipt with its file, link and setting into the **empty** books of another passkey; ids, links and times are kept, files are sealed anew.
  - **By a one-time key** (the default): the new books show a key as a QR code and as text with a fingerprint; the old books seal the move file to it (X25519, HKDF, AES-256-GCM). Only those books open it.
  - **By a passphrase**, when both books are not open at once: Belege makes it (100 bits, groups of five), shows it once to write down, and asks for it in the new books.
  - Left out, as they belong to the old passkey or device: the bridge pairing, the backup key and list, the invoicing app's pairing, the network mode, own devices. The old books stay as they are. See [docs/backup.md](docs/backup.md).
- **Receipts in any language** (#366, #368). The extraction asked for German or English receipts; it now reads receipts in any language and writes what they print in other forms the same way – amounts with a dot (`4 512,30`), European and airline dates (`12/03/2026`, `14MAR26`), currencies as ISO codes (руб., TL, zł, Kč, грн, درهم) – with places and stations in their own script. How well a model reads a language is the model's matter; a small local model reads less.
- **Receipt previews where receipts are named** (#374). The open points, proposals, hospitality bills, statement checks and a trip's receipts on Reisen, and the receipts in the export's "Vor dem Export" list, show the receipt's first page with the lens on hover, as Belege and Zahlungen do; a "Vorschau" button on a touch screen.
- **Link previews** (#343, #345). A link to the app shows a card on X/Twitter, LinkedIn, Telegram and others: title, description and a preview image, in German at `/` and in English at `/en/`, which also opens the app in English. Search engines stay out.

### Changed

- **The DATEV format, not one program** (#334, #348). The app and its docs named one bookkeeping program as the export's target; they now name the format (DATEV) and "deine Buchhaltung", since many programs read it.

### Fixed

- **Travellers' names and documents in other languages are blacked out** (#366, #367). Before a receipt's text goes to the model, the bridge blacked out names only after German and English salutations and labels, in Latin script: a traveller's name on a Russian, Turkish, Spanish, Italian or Arabic ticket went out as it was. It now finds names in any script after salutations and passenger, traveller and guest labels in eleven languages, an airline's `SURNAME/GIVEN`, passport and ID numbers, and dates of birth and phone numbers after labels in these languages. Redaction still limits what leaves; it does not make a text anonymous.
- **Text in any script in the PDFs and the DATEV export, not "?"** (#373). The PDFs Belege draws – a mail made a receipt, the account statements, the Eigenbelege, the vendor account, the Aleph, Akash and travel statements – turned every letter outside Windows-1252 into "?": a Russian station or a Turkish vendor came out as question marks in the ZIP. They now embed DejaVu Sans and Noto Sans Arabic (only the letters used): Latin, Cyrillic, Greek and Arabic, right to left. The Buchungsstapel stays Windows-1252, as DATEV wants; Cyrillic and Greek are now written in Latin letters there (`Москва` → `Moskva`), Arabic and Chinese stay "?".
- **The outlay form stays open** (#351). It closed while a rate was being typed when its receipt was refreshed in the background, after the matching say; the rate was gone.

## [0.8.0] – 2026-10-06

### Added

- **A mail receipt kept as it came** (#288, #339). A receipt that is the mail itself – a shop's receipt without a PDF – now keeps the mail as it was received (`.eml`), sealed like any file, beside the excerpt used for search and matching.
  - **Export:** the `.eml` goes into the ZIP beside the PDF, and the PDF shows the mail's whole text instead of at most 2,000 characters.
  - **Preview:** the whole text, read from the original – always as text, never its HTML.
  - **Receipts from before** get their original when the mail is fetched again, or with "Original holen", as long as it is still in the mailbox; the receipt says when it no longer is.
  - The bridge hands out a whole mail only when it was sent to the accounting address. Backups include the kept mails.
- **Bookings without an account onto a suspense account, optionally** (#323, #338). Full pre-assignment stays the default. With a suspense account named in the bookkeeping settings, the export page offers to put bookings that are still unclear onto it instead of waiting: without a BU key, the booking text starting with "Ungeklärt:", marked in the overview to be re-booked. A bank account without its ledger account still blocks. See [docs/export.md](docs/export.md).
- **Rates for the tenge and other currencies the ECB does not publish** (#325, #337). For KZT the National Bank of Kazakhstan's official rate; for UZS, GEL, AMD, KGS, AED and the others the Bank of Russia rates, a cross rate through the ruble – named as such on the outlay, the booking and the statement (CBR-X), not an official euro rate.

### Changed

- **A ruble rate as people say it** (#312, #329). A private outlay in a weak currency shows and takes its rate as units per euro – 95,2381 RUB je 1 EUR instead of 0,0105 EUR –, with the other direction beside it and a button to type it that way. The full rate is still what is booked; the euro amounts do not change.
- **Belege shows one month at a time, and opens in a fraction of the time** (#313, #317). The months stand beside the sources with their counts and what is open (a select on a phone), "Alle Monate" on request; a search spans every month, and a receipt opened by link shows its own month. The list had looked up every row's matches and payments anew: with a year of receipts it took seconds to open; it now takes about a tenth of a second.

### Fixed

- **Own devices switched on in the consent screen** (#327, #336). Switched on there while the node had stayed offline at unlock, the network menu still said "aus" and offered "Einschalten …" again. It now says "ein – ab dem nächsten Entsperren", offers the reload, and can be switched off again; the consent screen also shows the switch as the menu last left it.
- **A monthly statement's balances, taken from the source and checked** (#287, #332, #333). A crypto account's opening and closing balance had been worked back from today's: any movement not booked since shifted every earlier month, silently.
  - **Kraken:** the balances come from Kraken's own ledger, which carries the balance after every entry; "(laut Kraken)". They are kept from the next sync; for earlier months, sync again from the month's first day.
  - **Checked:** Kraken's start plus the month's bookings must give its end; a wallet read in full must add up from nothing. Agreed, the balance says "abgestimmt"; not, the statement prints "Nicht abgestimmt" with what the bookings give and the difference, and Export names the account.
  - Everything else says "(errechnet)".
- **A learned bank fee covers only what looks like one** (#320, #322, #324, #326). "Bankgebühr ohne Beleg" had been learned from a booking and then covered payments with an invoice, such as a phone bill. It now applies only to bookings that look like a fee; a learned rule can be forgotten where it applies ("Diese Regel vergessen"), and Home lists the payments it covered wrongly.

## [0.7.0] – 2026-10-05

### Added

- **Whole entries sealed: OrbitDB's replication layer.** Every log entry was sealed in its payload; its writer, clock and links to earlier entries were readable by whoever got the block. Now each entry is sealed once more as a whole, with a key of its own from the passkey (`belege/replication-key/v1`), so a peer without it gets blocks it cannot decode and cannot walk or replicate the log. Own devices derive the same key and sync as before.
  - The seal is deterministic (AES-256-GCM with a synthetic nonce, an HMAC of the entry): OrbitDB seals an entry again when it joins one and files it under the hash of the result, and the same entry has to seal the same way on every device. Not `@orbitdb/simple-encryption`, which reuses one nonce for many entries.
  - The books move once, on the first unlock: into new databases whose names say nothing of what they hold. Every entry is sealed anew with its own clock and links, so the new logs order exactly as the old ones; a second device moving its own copy adds duplicates that change nothing, and a later move from an older state cannot undo an edit made after the move. The old databases stay untouched.
  - A backup made before goes back into the old databases and moves in on the next unlock. New backups hold the sealed databases.
  - All devices need this version: one that has not updated keeps syncing only the old databases, with devices that have not updated either.

- **Backup on Aleph Cloud** (#77). _Integrationen → Backup → "Jetzt sichern"_ packs everything Belege keeps in this browser into one file: all eight databases block by block, with their writers and heads, and every receipt file. The file is sealed with a key from the passkey, so Aleph sees one opaque file and its size.
  - The browser uploads it directly to Aleph's IPFS host. The bridge only signs the order that has Aleph keep it, with its own backup key from `pnpm setup:aleph`. The setup prints the address of the Aleph account that pays, never the key.
  - The page counts as it packs (database by database, then the receipt files, then sealing). Afterwards it shows what went in per database. The history keeps every backup with its CID and contents; the overview shows when the last one ran.
  - The backup is built with `@le-space/orbitdb-storage-bridge` 0.17.0 (`bundleDatabases`). A test puts it back into an empty node through the package's `restoreFromBlocks`, and the books, the receipt file and the writer come back.
  - All of it in [docs/backup.md](docs/backup.md) ([Deutsch](docs/backup.de.md)). The consent screen names the backup and what leaves (consent version 20).

- **Restore a backup** (#77). _Integrationen → Backup → "Wiederherstellen"_ after unlocking with the same passkey.
  - It lists the backups the bridge's Aleph account had kept (new `GET /backup/aleph/list`) and those made from this browser, or takes a typed CID.
  - It fetches the sealed file from Aleph's gateway, opens it with the passkey's key, puts every database and receipt file back through the storage bridge's `restoreFromBlocks`, and reloads.
  - It merges and deletes nothing. A backup of another passkey, or of other books, is refused with a clear message, and a failed restore says why instead of reporting success.
  - The consent screen says the browser fetches from Aleph's gateway (consent version 21). All of it in [docs/backup.md](docs/backup.md).

- **A backup is paid in credits, and another key may keep backups for the bridge's account** (#77, Le-Space/invoice#28). With `@le-space/orbitdb-storage-bridge` 0.17.0:
  - **Credits.** The bridge's STORE message is paid in credits. Before, it was booked as `hold`, which only ALEPH held on the account covers. Aleph refuses a backup when the account has less than a day of it, about 54 credits per MiB and day (measured 2026-10-03). The backup page then says how many credits the account has and how many it takes.
  - **A pending answer** from Aleph is followed until Aleph has decided, so "kept" means kept.
  - **`pnpm setup:aleph -- --authorize <address> --channel <CHANNEL>`** lets another key keep backups at the bridge account's expense: STORE only, on that channel only. `--grants` lists the keys, `--revoke` takes a grant back. This is how Le Space Invoice backs up from the browser without the bridge running.
  - **The list of backups** asks Aleph by the paying account (`owners=`), so what such a key kept is in it too.

- **The browser keeps its own backups, and finds them without the bridge** (#77, Le-Space/invoice#28).
  - **Its own key.** Belege makes a key of its own in this browser and keeps it sealed in the settings. Once the bridge's account allows it (`pnpm setup:aleph -- --authorize <address> --channel BELEGE-BACKUP`; the page shows the command), the browser signs the STORE itself, for the bridge's account and paid in its credits, and the bridge need not run. Until then the bridge signs, as before. Where two keys meet after a restore or a sync, the first one made for the books wins, so a grant holds.
  - **Restore without the bridge.** "Wiederherstellen" lists the account's backups straight from Aleph (`owners=`), whoever sent them. The address comes from the settings or the paired bridge, or is typed. A browser that lost everything needs the same passkey and that address, or a backup's CID.
  - **Said where it is needed.** Integrationen → Backup and [docs/backup.md](docs/backup.md) ([Deutsch](docs/backup.de.md)) say what a restore needs. The bridge's `GET /backup/status` names the Aleph API the browser uses. The consent screen says what the browser now sends to Aleph's API (consent version 22).

- **Invoices paid in instalments** (#258). One invoice can carry several payments until they add up to it; each instalment is covered by the same invoice, and what is open comes from the links.
  - **Matching:**
    - a partly paid invoice stays in play;
    - a smaller payment scores as an instalment when the invoice is partly paid, or its purpose names the invoice's number and says "Teilzahlung", "Rate" and the like;
    - the exact rest scores as the amount;
    - a late date counts for nothing either way.
  - **By hand:** "Als weitere Teilzahlung zuordnen" keeps the other links.
  - **What you see:** the payment says "Teilzahlung 2 von 3 · … offen" or "bezahlt"; Belege says "teilweise bezahlt · 7.000 von 10.000" or "in 3 Raten bezahlt".
  - **Export:** every instalment carries the invoice's number; the file goes into the package once. See [docs/matching.md](docs/matching.md).

- **Monero** – an own wallet from its own export. Monero hides amounts and parties on its chain, so nothing is read by an address.
  - "Verlauf importieren (CSV)" reads the history exported by the Monero GUI (History → Export) or the CLI (`export_transfers`), in the browser only.
  - Confirmed transfers become bookings valued at the day's rate (CoinGecko); an outgoing fee is booked apart; a mined block is "Mining-Ertrag"; importing again adds only what is new.
  - The consent screen lists Monero and xmrchain.net; [docs/crypto.md](docs/crypto.md) explains the export and how XMR from private holdings is booked.
- **README and consent screen name every supported blockchain and the backup service** (Aleph Cloud through the OrbitDB Storage Bridge).
- **Private outlays** (#293). What the managing director paid privately for the business – cash abroad, a private card – is booked from its receipt.
  - **"Privat ausgelegt …"** on a receipt books it on an account of its own, _Auslagen Geschäftsführung_, and links the receipt to it (#295). The account's ledger account comes from the legal form in Buchhaltung.
  - **Another currency:** the amount stays as the original, booked in euros at the ECB rate of the day. For the ruble, which the ECB no longer publishes, the Bank of Russia's official rate is used, or a rate from a document entered by hand (#300).
  - **Paying back:** "Erstattet Auslagen …" on a transfer links it to the open outlays it pays back. One transfer can clear several, several one; it needs no receipt and is booked against the private account of the legal form. Home lists what is still open (#298).
  - **"Privat, nicht geschäftlich"** sets a receipt from the private mailbox aside with its reason: out of the matching, the questions and the export (#297).
  - See [docs/outlays.md](docs/outlays.md).
- **Akash, as it is paid now** (#305).
  - **Burn-mint:** AKT burnt for ACT, the credit deployments are paid in, is booked as a swap that needs no receipt (#304).
  - **A Kraken funding the indexer's listing leaves out** is found by the hash of the Kraken withdrawal (#304).
  - **A monthly usage statement** on an Akash wallet's card, as an Eigenbeleg: the network fees with their hashes, the top-ups, and each deployment's usage from the node. It covers the month's fees, and the DATEV export books them as one collective line per wallet account (switchable) (#307).
  - **The ACT account:** ACT topped up, used and left, month by month, at cost (#309).
- **One rule for every network fee** (#306). "Für alle Netzwerkgebühren übernehmen" in a fee's account block puts all of a wallet's network fees on their account, future ones too, instead of confirming each.
- **USDFC on Filecoin, and swaps through SushiSwap** (#301, #302). A Filecoin wallet's token transfers are read too; USDFC is booked by its contract, and FIL ⇄ USDFC is one swap through SushiSwap.
- **Upload receipts from every page** (#308, #310). "Belege hochladen" in the tab row (a "+" above the tab bar on a phone) opens a drop zone; files dropped on any page are uploaded. The upload button on Belege is gone.
- **Crypto movements in an open, MIT-licensed format** (crypto-ledger v1, #268): CAIP ids, exact amounts, the fee as its own movement, the euro value with its source. Export from Belege, and read such a file into the books (#275). See [schema/README.md](schema/README.md).
- **A receipt previewed on hover, with a lens** (#273): when assigning a receipt, in the Belege and in the Zahlungen lists (#278, #282).
- **Instalments of an invoice in another currency** (#292): a USD invoice paid in euros or in Monero, counted at the ECB rate of each payment's day, within 5 %.
- **Unlocking says where it is** (#285): opening the books, moving them, each step timed in the console.
- **Export: the account statements are optional** (#289), and a mail receipt without an attachment goes into the ZIP as a PDF (#291).

### Changed

- **A wallet payment's detail says whose address is whose, and where the money went** (#254).
  - "Von" and "An" are built the same way. The own side is marked "eigene Wallet"; each address is shown once, short, with copy (in full) and a link to its page in the explorer.
  - The heading names the other side, not a bare address: an own account the payment went to, a named address, or "An f410f…". Filecoin addresses are now recognised as addresses.
  - Each fact appears once: the transaction hash only under Details ("Transaktion"); no repeated "Gesendet · Tx …" purpose, and no second "Gegenadresse" row. The rate is shown with at most six significant digits, the full one on hover. A Filecoin message counts as "gleicher Tx-Hash", not as an exchange's reference. "Konto fehlt" says on hover that the booking account (SKR 03) is missing.
  - **"Wohin ging das Geld?"** for a wallet transfer nothing explains yet:
    - a deposit (or withdrawal) of nearly the same quantity of the same asset on an own account that day is offered as the same transfer, linked with one click;
    - how many other bookings have this address, with a jump to them;
    - "Adresse benennen" gives the address a name, which every booking with it then carries.

- **"Ist das ein eigenes Konto?"** (#256). An IBAN that sends money under the company's own name is very likely an own account, a Wise account for example, whose statements never name its IBAN. Payments back from it were own transfers already, by the name; payments to it asked for a receipt, because the bank names the payee "Wise Europe SA".
  - Home and the payment's detail now offer such an IBAN, with how many open payments it would explain. "Ja, eigenes Konto" saves it under the own IBANs, and every payment to it becomes an own transfer (1360). "Nein, nicht unseres" stops the offer for good.
  - Nothing is saved without the click: a customer whose name only looks like the company's is offered too, and refused there.
  - [docs/banking.md](docs/banking.md) explains it under Wise.
- **Kraken through ccxt** (#265, #281): the bridge reads Kraken with the open-source ccxt library instead of its own client; the entries are the same as before.
- **Every ECB reference currency** (#300): a rate for TRY, GBP, CHF and the others the ECB publishes, not only USD.
- **Export: "Belege ohne Zahlung" says what it means** (#286): those receipts link to Belege, and a copy of a linked receipt is named apart.
- **Adding comes first** (#276): on Integrationen the form to add an account or wallet stands above the list it adds to, and a payment's upload above its receipts (#277).
- **Export keeps its month** (#314, #315): the chosen month is in the address (`?month=`) and kept for the session, so going to Zahlungen and back, or a reload, shows the same month.

### Fixed

- **An invoice in another currency is no longer "partly paid".** A USD invoice paid from a EUR account showed "Teilzahlung 1 von 1 · 1,63 USD offen": euros were subtracted from dollars. Payments now count in the invoice's currency only, by their original amount where the bank gives one (Wise, CAMT); where it does not, the invoice counts as paid by its link, with nothing open (#258).
- **Test bookings can be removed.** "Testbuchung anlegen" – a button of the development build – could put made-up payments (Testpartner GmbH, −19,99 €) into real books, with device sync even onto every own device; nothing could take them out, and with no bank account they blocked the export of their month. They are now marked, Zahlungen says so with "Testbuchungen entfernen", older ones are found by what the button wrote. The button now books onto a "Testkonto", so test bookings can be exported on request ("Testbuchungen mitexportieren", off by default; the package is then called TEST\_…).
- **Entries from an earlier session of the same passkey are accepted again.** OrbitDB 4.0.0 caches a verified identity by its id signature and refused every other identity with the same signature without asking the provider. A passkey's identity carries a new proof in each session, so a backup's entries, and possibly entries synced from an own device, were refused ("not allowed to write to the log"). Such an identity is now checked again the way OrbitDB checks one it has not cached; nothing it would refuse is accepted ([orbitdb/orbitdb#1258](https://github.com/orbitdb/orbitdb/issues/1258)).
- **Akash's older history is read again** (#303). The Akash Console indexer changed its listing (`hasMore` instead of `count`); a pruned node's wallet stayed without its older history and said "Indexer nicht erreichbar".
- **A mail receipt's PDF keeps its lines** (#311). Every line break was printed as "?", so the mail came out as one block; long tracking links are now shortened to their host.

## [0.6.0] – 2026-10-01

### Added

- **Bank accounts through Enable Banking** (#224), for banks Hibiscus does not reach (Revolut, Wise, most banks outside Germany), with your own Enable Banking application – a production one in restricted mode, active once your own accounts are linked in its Control Panel; no contract needed.
  - `pnpm setup:enablebanking` checks the application id and its key (the panel's `.pem`, or the `-keyout` file of an own certificate), says whether the application is active and the redirect URL registered, and seals the key beside the bridge's configuration; the key to it is in the keychain or the Windows Credential Manager. Requests are signed (RS256), go to one host, follow no redirect and are limited in time and size.
  - Integrationen → Bank → "Über Enable Banking": choose country and bank, consent on the bank's own page, come back to `/integrationen/bank/verbunden`. The bank's one-time code leaves the address before the passkey is asked for; the bridge takes it only for a link it started, once, within 30 minutes.
  - Only accounts released in the bridge leave it (`pnpm setup:enablebanking -- --accounts`, by IBAN ending). "Umsätze holen" fetches on a click: 90 days the first time, then from a week before the last fetch; booked transactions only. An account a statement file brought is continued from the day after its last booking.
  - "Braucht dich" warns two weeks before a consent ends, and "Erneuern" replaces it. The Bank page says what goes out, with the technical view under "Technisch"; the setup checklist names the three ways in.
  - All of it in [docs/banking.md](docs/banking.md) ([Deutsch](docs/banking.de.md)). The consent screen names Enable Banking as a service that runs when set up (consent version 19).

- **Filecoin wallets** – an own Filecoin address as an account, typed as `f1…`, `f3…`, `f410f…` or, for an Ethereum-style account, `0x…` (kept as its f410f form). The bridge reads it from Filfox's public API (no key) after checking the address's checksum: every send and receipt, and a message's miner and burn fee as one fee booking, valued at the day's rate. The message CID is the hash, so a withdrawal to Kraken pairs with Kraken's deposit as an own transfer by itself. The consent screen names Filfox for Filecoin.

- **A deposit's hash names its blockchain and links the explorer** (#215). For a Kraken deposit or withdrawal the payment's detail tells the chain from an own wallet's booking of the same hash, from the network Kraken names (now passed on by the bridge), or from the hash's form with the asset – a Filecoin message CID (`bafy2bzace…`) is Filecoin. A clear chain shows its name and "Im Block-Explorer ansehen"; an EVM hash without a named network lists its candidate chains, each linked. Nothing is asked of any explorer until you click. The consent screen lists Filfox and Solscan among the explorers.

- **Wages, wage tax, contributions and tax payments are recognised** (#233). A payment to the tax office (by its name or a tax number in the purpose), to the Minijob-Zentrale or a health insurer, or a wage – to a person on the new employees list in Einstellungen, or with Lohn, Gehalt or Minijob in the purpose – no longer asks for a receipt: "Warum?" names the document that stands for it (payslip, wage-tax return, contribution statement, return or assessment) and the period. An SKR 03 account is suggested (1740, 1741, 1742, 1780/1790, 2200, 4320). On Home, taxes to the tax office have a line of their own.

### Changed

- **What goes to the language model is blacked out further, and the app says what that is worth** (#226). New: names after a salutation or a label, phone numbers, dates of birth, tax ids and tax numbers, card numbers, e-mail addresses of others (the domain stays), four-digit postcodes, and the company names from Einstellungen (the app sends them with each call). The texts no longer promise more than that: redaction limits what leaves, it does not make a text anonymous; a local model sends nothing, and that is what the docs and the consent screen advise for now, until fast models in a TEE with a checkable attestation are available. The consent screen opens once more for it, and no longer names a bank.

### Fixed

- **Private money that came in on the business account can be matched** (#248). "Privat (Irrläufer)" now works the other way round too: a refund or payment meant for the private account that came in on the business one is marked, and its pass-on to the private account settles it ("Weiterleitung verknüpfen …"). The note and the hints say so, and the account follows the money's way – in a deposit, out a withdrawal (1890 / 1800 for a sole proprietor; a UG's clearing account both).

- **Uploaded receipts are read and matched at once, and no longer hide in another year.** A receipt uploaded or read from the folder had no date until it was read, so it counted under the year of the upload: with last year chosen, "Alle neuen auslesen" did not count it. Such a receipt now shows in every year until it has a date. And uploads get the mail's switch – "Hochgeladene Belege gleich auslesen und zuordnen", on by default: new receipts are read by the model and matched right after the upload.

- **"Beleg finden" no longer searches the mailbox for ourselves** (#231). A counterparty that is a company name or one of the new _own names_ in Einstellungen (owners, shareholders), or a payment service such as PayPal or Stripe, gives no search word; the merchant after a payment service's star (`PAYPAL *VENDOR`) or the first telling word of the purpose is searched instead, with bank boilerplate (Kartenzahlung, SEPA, VISA, …) and own names passed over. The hint says when the word came from the purpose; with no telling word the search runs by amount and date.

- **Crypto bookings older than a year get their rate again.** CoinGecko's free API answers for the last 365 days only, so older days fall to Kraken – and Kraken's public API refuses more than a handful of calls in a row ("EGeneral:Too many requests"), so a wallet with bookings on many days was left with "Kurs fehlt: no rate found for BTC on …". The bridge now asks Kraken once per asset for its last 720 daily candles, keeps the completed days and answers every later day from them; days asked at once share that one call, and a "too many requests" answer is asked again after a growing wait. The rate is still the open of the day's 00:00 UTC candle, labelled Kraken.
- **The "EUR je …" field no longer suggests 0,0042 for every asset.** The fixed example fit a cent token, not BTC. The field now shows the booking's own rate as it is typed (no thousands separators), or nothing when there is none.
- **A rate typed by hand is no longer read 1000× too small.** "58.123" in the "EUR je …" field was taken as 58.123 EUR, although in German it means 58 123. A rate is now read the same in either language: with both marks (`60.123,40`, `60,123.40`) the last is the decimal, a mark used twice separates thousands, and `0,0042` or `1,5` stay decimals. A single mark before exactly three digits (`58.123`, `1,500`) could be either and is refused with a note on how to write it.

### Security

- **A relay no longer learns what a node speaks.** identify now has two lists: a peer that has not proved the passkey, every relay included, is told identify and the relay protocols only; gossipsub, Bitswap, WebRTC signalling and the extensions a desktop serves its own devices are named to a device after its proof. A later change is pushed to each with its own list (#209).

- **identify no longer names the databases.** libp2p's identify tells any peer that asks – a relay too – which protocols a node speaks, and OrbitDB registers one per database, with the database's address in its name. The sync node now leaves those out of identify and identify-push; the databases are still reachable for a device that proved the passkey. It also calls itself `js-libp2p` instead of sending the browser's user agent string. The device proof's protocol, which names the app, is not announced either, and is no longer offered to a relay the node dials. The consent screen says what a relay does see, including the protocol list (consent version 17) (#209).

## [0.5.0] – 2026-09-30

### Added

- **A guided first run (#200).**
  - Home asks how to start: look around with sample data, a bank statement file (no bridge needed), or the full path with the bridge (#211).
  - A setup checklist on Home, and for good under Einstellungen. Its steps are done by what the books and the bridge say, never by a tick; a step can be put off and taken up again (#204).
  - The bridge step shows the commands to copy, notices a started bridge by itself, and says why it does not answer: nothing there, this page not in `appOrigins`, an https page and a plain-http address elsewhere, or a bad address (#204).
  - Sample books, made up and marked on every page, removed with one click. The export refuses a month where sample and real bookings stand side by side (#214).
  - Help in context: every integration's page says what it is and how to set it up, with the command to copy and the docs in the app's language; empty pages name the next step; a bridge error offers a way out (#216).
- **Income and expenses of the year on Home (#194):** bank and crypto apart, their total and the balance. Own transfers, swaps and trades count as neither; a refund is netted against its charge; private payments and loans stand on lines of their own. Every figure links to the bookings it sums (#207).
- **Input VAT on Home (#195):** from the receipts at 19 % and 7 %, per month or quarter and for the year, by receipt date. Foreign VAT, §13b, other currencies and receipts without a VAT line are shown apart. Buchhaltung gets the period of the advance return and Kleinunternehmer (§19 UStG). Output VAT follows once the invoicing app sends the VAT per rate (#208).
- **Statements from Wise (#218):** an account without an IBAN, entries without transaction details (the merchant of a card payment, a fee tied to its payment), the amount in the currency it was paid in, and a statement in dollars valued at the day's ECB rate (#219).
- **Storage and factory reset (#212):** Einstellungen shows what each database and the receipt files take and where they are. "Alles in diesem Browser löschen" asks for a typed word and leaves nothing of the app in this browser; it is on the unlock screen too (#217).
- **The bridge on Windows (#205):** its secrets go into the Windows Credential Manager, one credential per account (`belege-bridge:<account>`), reached through Windows PowerShell with nothing to install; a secret is never on a command line. Every setup command and the bridge pick the store by platform. A Windows runner in CI does a real round trip (#220).
- **Test badges in the README:** unit, E2E and bridge tests are workflows of their own (#206).
- **A lint guard against German outside the catalogue** (`belege/no-german`, in `pnpm lint`), and an English smoke run over every page (#202).

### Changed

- **Security rules for people and agents** in `AGENTS.md` ("Security: what must stay true"), and `SECURITY.md` with how to report a weakness privately. The audit plan is #209 (#210).
- A booking the bank types `FEE` is a bank fee (#219).
- On a phone the header's switches wrap instead of covering the name (#204).

### Fixed

- "Später" in the setup checklist is stored before it shows, so a reload right after keeps it (#211).

## [0.4.0] – 2026-09-29

### Added

- **The language switch in the consent screen too.** On a first visit the consent screen covers the header; its DE|EN switch now sits beside "Technisch" (#199).

### Changed

- **A compact README:** what Belege is today, the live app, every setup command, and a docs index. Details moved to `docs/matching.md` and `docs/phase-0.md`. Values from real receipts in the phase-0 notes were replaced by made-up ones (#201).

## [0.3.0] – 2026-09-29

### Added

- **English (#192).** The whole interface in German and English, switched in the header at once and offline; the first visit follows the browser's language. Amounts, dates and crypto quantities follow the language; the Eigenbeleg, the statements and the DATEV export stay German (#193, #196, #197).
- **Own devices (#133, #138, #156).** The same books on phone and computer, kept in step peer to peer; a device is added by QR code, removed with one click, and gets the books only after it proves the passkey. A phone uses the desktop's bridge (#144).
- **Where devices meet (#148).** Chosen per book: public Le-Space relays, without any relay by exchanging two QR codes (#186), at a relay in the own bridge in the own network only (`pnpm setup:relay`, WebRTC-Direct with the relay's own ten-year certificate, #187, #188), or all of them, with a new device let in only by QR or the own relay (#191).
- **The network under your hand.** The header badge says when Belege is online (#179) and switches everything, or own devices and the invoicing app one by one, off and on (#181).
- **Invoicing app over UCEP.** Eigenbelege made by the invoicing app (#86); it learns which of its invoices were paid (#159); its catalogue in memory, offline after unpairing (#158).
- **A read share for an assistant** – scoped, redacted, expiring, logged (#125).
- **Installable app (PWA)** with the app shell offline (#143).
- **Wallets.**
  - A name, ledger account and cost centre per wallet (#71).
  - Dust needs no receipt, and a lookalike sender is named (#66).
  - Tokens not in the list are booked, each in its own account (#130).
  - Delegations are booked (#136), and an Akash wallet's older history comes from the Akash indexer (#137).
  - Pruned Cosmos nodes are detected and the balance checked (#106).
- **Swaps and transfers.**
  - DEX swaps are recognised, with both sides, the router and the gas (#118).
  - A swap across chains is paired with its arrival (#171).
  - Own transfers across chains via IBC and bridges are recognised (#104).
  - Token migrations are recognised (#182).
- **Rates.**
  - A swap leg without a rate is priced by its other side (#164).
  - A token CoinGecko does not price is priced by its DEX pool at the block: Uniswap V2, V3 and V4, against WETH or USDC (#166, #185).
  - A booking without a rate is kept, and a rate can be set by hand, 0 included (#182, #184).
- **Aleph credits** as a monthly statement per account, as an Eigenbeleg (#139).
- **Matching.**
  - Refunds are paired with their charge (#120).
  - Two bookings can be linked by hand as one own transfer (#107), with an AI suggestion for the other side (#110).
  - The AI queue asks "own transfer?" before it looks for a receipt (#140).
  - Twin own transfers are paired (#177).
  - A crypto payment gets only receipts that name it (#96).
  - "KI-Vorschlag" says what it checked (#168).
- **Private payments** from the business account are marked, documented and settled (#173).
- **Vendor accounts** for prepaid and collective billing: a timeline with a balance, billing periods, positions, AI notes and a PDF (#122, #132).
- **Eigenbeleg for crypto** with the full hash, both addresses and every movement including gas (#127), and the transaction as a QR code (#128).
- **Receipts.**
  - Mail receipts are read right after the fetch, and signs of a scam are flagged (#85).
  - A crypto payment's mail is found by hash, address and quantity (#72).
  - A mail can be moved to the Trash, by hand and after a confirmation (#87).
  - One "Beleg finden" panel searches receipts, the private mailbox and portals (#89).
- **AI.**
  - One queue for AI runs: a few at a time, aware of rate limits, and resumable (#99).
  - AI suggestions for all open questions at once, as suggestions only, never links (#92).
  - Storage and AI usage (tokens and cost per day, week, month and receipt) on the stats page (#94).
- **Payments.**
  - Booking time, the other side of a trade (#68), and a name for every payment, with sender and receiver for crypto (#111).
  - Bookings that belong together are one click apart (#90).
  - Full addresses and the hash can be copied (#116).
  - Payments without a receipt are marked in every filter (#129).
  - A compact header (#91).
- **One fiscal year at a time**, with a year switch (#102); month and year are picked from lists, and "Ganzes Vorjahr" is offered for the mail fetch (#80).
- **Integrationen and Einstellungen.**
  - An overview and a page per integration, in one card pattern (#154, #155).
  - "Braucht dich" on Home (#157).
  - An Einstellungen page behind a gear (#153).
- **Consent screen.**
  - What Belege works with, with logos (#131).
  - What the Le-Space relays see (#147).
  - A feature list by category, also in the README and `docs/features.md` (#189).
- **Performance:** a benchmark of the books with a baseline (#81); one refresh after a burst and an id index (#82).

- **Own EVM wallets through Alchemy.** `pnpm setup:alchemy` stores an optional Alchemy API key in the macOS keychain (hidden prompt, checked with `eth_chainId` on each network; Enter keeps it, `-` deletes it). With it the bridge reads Ethereum, Base, Arbitrum, Optimism and Polygon wallets from Alchemy instead of Blockscout, whose keyless API answers only a few requests per half hour: `alchemy_getAssetTransfers` from and to the address, the gas from the receipts, failed transactions and approvals found through the nonce, balances through `eth_getBalance` and `alchemy_getTokenBalances`. The key goes only into the URL of the requests to Alchemy; `GET /chains` reports `alchemy: true/false`. Value, gas and token ids are the same as from Blockscout, and the app pairs internal transfers (which the two number differently), so switching the source books nothing twice. On Arbitrum and Optimism, where Alchemy has no internal transfers, those still come from Blockscout. Errors `WALLET_ALCHEMY_AUTH`, `WALLET_ALCHEMY_DENIED`, `WALLET_ALCHEMY_RATE_LIMIT`. _Eigene Wallets_ says which source is used and, without a key, how to set one up; the consent screen's _Blockchain-Abfrage_ names Alchemy (version 6). See [docs/crypto.md](docs/crypto.md#alchemy).

- **The release in the footer, and releases that count up.** The footer shows `v0.2.1` (a build of the release tag) or `v0.2.1+3` (three commits after it), linked to the GitHub release. `release.yml` without a version counts up from the last tag (`bump`: patch, minor or major).

- **Own crypto wallets as accounts (#53).** _Integrationen → Eigene Wallets_ adds a wallet by chain and address – read only, never a key: Nym (Nyx) and Akash on Cosmos, Ethereum, Base, Arbitrum, Optimism and Polygon on EVM. The card shows the node and the block explorer that will be used (official or chain-registry defaults, an own https endpoint allowed, an archive node suggested where the default is pruned). _Synchronisieren_ has the bridge read the whole history and the balance from a public node (`POST /<chain>/wallet`; Cosmos: CometBFT `tx_search` for sender and recipient, paged, plus REST; EVM: Blockscout's Etherscan-compatible API, paged by start block, with retries on its rate limit) and books every transfer on an account per wallet and asset (_Wallet NYM ···w6d0y_) at the day's rate, the fee this address paid as its own booking (`<hash>:fee`, also for a failed transaction), staking rewards as rewards and delegations as `stake` (a kind of their own, `crypto-stake`: no receipt, not on 1360, since the tokens return from unbonding without a transaction). Entry ids are built from where an entry stands in its transaction (message and event index, log or trace index), so an entry indexed late or a token listed later never duplicates a booking. An EVM API must name its chain id first. Every booking keeps the other side's address (`counterpartyAddress`), the hash as `txRef` and its explorer link (_Im Block-Explorer ansehen_); the wallet links to its address page. A transfer between two own wallets is an own transfer on both sides (same hash), one to an own wallet on the same chain not synced yet by its address. Only listed assets are booked (NYM, NYX, AKT, ETH, POL, USDC by its verified contract); others are counted. New assets NYX and POL, POL priced by CoinGecko or Kraken. The consent screen lists _Blockchain-Abfrage_ (version 5). [docs/crypto.md](docs/crypto.md#own-wallets) says what was checked about each chain's endpoints and explorers, and what not.

- **✦ KI-Vorschlag under "Beleg zuordnen".** When the list of receipts to choose from is long, the model gets the booking (counterparty, purpose, amount, day) and up to 25 receipts nearest by amount and date as their read fields (vendor, amount, currency, date, invoice number, summary), redacted by the bridge (`POST /match/assist`), and names the one that fits with a short reason; the person links. What was sent is shown; the Verlauf logs it. Listed on the consent screen, in the README and in `docs/ai.md`.

- **Your own chart of accounts.** _Eigene Anweisungen → Kontenplan einlesen_ reads a DATEV _Kontenbeschriftungen_ file (from the bookkeeping's DATEV export) or any CSV with account numbers and names, UTF-8 or Windows-1252, shows a preview and keeps it sealed. "Konto" then suggests those accounts with their names and marks numbers outside the chart. An info icon and _Wie komme ich an die Datei?_ explain the export.

- **Account assignment (_Konto_, SKR 03).** Every booking gets a contra account and a BU key: the app suggests, the person confirms with _Übernehmen_ (stored sealed on the transaction as `booking: { account, taxKey, confirmedAt }`). Suggestions: own transfer → 1360, bank fee → 4970 (no BU key), else the account the person gave this vendor last time (_gelernt_: confirming a booking whose receipt names a vendor stores `account` and `taxKey` on the vendor's partner record), else a small SKR 03 catalogue to search, or any 4–8 digit number. The BU key comes from the receipt: VAT 19 % → 9, 7 % → 8 on money out, 3 / 2 on money in, `reverse_charge` → 94 (to be checked with the tax adviser), none on an Automatikkonto (8400, 8300). _Zahlungen_ marks bookings _ohne Konto_ and filters them. _Eigene Anweisungen → Buchhaltung (DATEV-Export)_: each bank account's ledger account (placeholder 1200, 1210, …), Beraternummer, Mandantennummer, start of the fiscal year, Sachkontenlänge and the BU keys.
- **Monthly DATEV export.** _Export_: pick a month, see what is missing (bookings without a confirmed account and bank accounts without a ledger account block the export; bookings without a receipt, receipts linked to nothing and unconfirmed senders warn), confirm the automatic accounts of transfers and fees in one click, download `DATEV_<YYYY-MM>.zip`, made in the browser with fflate: `DATEV/EXTF_Buchungsstapel_<YYYY-MM>.csv` (EXTF 700, category 21, format version 13, Windows-1252, CRLF; Konto = the bank's ledger account, S for money in, H for money out), `Belege/<YYYY-MM-NNN>_<vendor>.pdf` (the linked receipts, opened from the sealed blob store) and `Uebersicht_<YYYY-MM>.csv` (UTF-8). An own transfer between two of our accounts is exported once, from the lower ledger account against the other. Receipt numbers are kept on the receipt (`exportNumber`), so a re-export gives the same ones. The Verlauf records _DATEV-Export 2026-09: 4 Buchungen, 1 Belege_. [docs/export.md](docs/export.md) ([Deutsch](docs/export.de.md)) says how to import it into the bookkeeping and what to check with the tax adviser; not yet tried with a real import.

### Fixed

- Kraken: private calls go out one at a time, so the nonces arrive in order; balances and ledgers fetched together no longer fail with _Invalid nonce_ (#190).
- A linked receipt no longer vanishes, neither through sync nor through a second upload (#175). Saving "Eigene Anweisungen" keeps what was linked by hand (#174).
- "Alle neuen auslesen" runs once, app-wide, and never overwrites newer changes (#75). A booking that changes on re-import loses its confirmation and is marked (#76).
- Twin own transfers compare the readable purpose, not the raw one (#178).
- Wallets stay within Alchemy's compute units per second (#64). A swap's plan is read from the IBC message's memo (#183).
- Aleph is asked with the checksummed address (#150). The Le-Space relays are found on Aleph (#147).

- Nym/Cosmos wallets: the sync failed on real nodes with _the node refused tx_search: … cannot unmarshal string into Go value of type bool_. `tx_search` sent `prove` as the string `"false"`; CometBFT's JSON-RPC takes integers as strings but a bool only as a JSON bool. The fake node in the tests is now as strict.

- **A re-sync no longer "updates" every crypto booking.** The store hands records back with their keys sorted, so a booking's `valuation` compared unequal to the same valuation just computed; Kraken and wallet syncs counted every known crypto booking as updated and rewrote it.
- **The bridge's test mode never reads the macOS keychain.** The Kraken key and an optional CoinGecko key come from `BELEGE_BRIDGE_TEST_KRAKEN_KEY` and `BELEGE_BRIDGE_TEST_COINGECKO_KEY` like the other test secrets; before, a test bridge with Kraken set up asked the real keychain.

## [0.2.0] – 2026-09-25

### Added

- **How each receipt was linked, in the receipts overview (#31).** Every linked receipt carries _Automatisch · 120 P._, _Automatisch (gelernt) · 90 P._, _Bestätigt_ or _Von Hand_, with the reasons on hover (the words of _Warum diese Zuordnung?_); a receipt that _Mit KI weitersuchen_ found carries _✦ KI-Fund_ with the model's reason. Filters by origin with counts, and per month _1 automatisch · 2 bestätigt · 0 von Hand · 0 KI-Fund · 4 offen_. Receipts taken from the private mailbox keep `foundBy` (`mail-search` or `mail-assist`).

- **Transfers between our own accounts by their counter-booking (#29).** A booking with exactly one booking of the opposite amount on another of our accounts within 4 days, and a sign on either side (_Umbuchung_, _Übertrag_, _Transfer_, _Top-up_, _Aufladung_, _Einzahlung_, or our company as counterparty), is an own transfer (1360) on both sides – without a company name set up and without IBANs (Revolut CAMT gives names only). Two candidates, no sign, too far apart: nothing is guessed. _Warum kein Beleg nötig?_ names the other side and links it (_Gegenbuchung öffnen_); _Keine Umbuchung – Beleg nötig_ keeps the pair apart for good.

- **Bank fees on every account (#32, rules part).** Besides the booking type (GLS _Abschluss_, _Entgelt_), a booking is a bank fee when its CAMT bank transaction code is a charge (`BkTxCd` family or sub-family `CHRG`, `FEES`, `COMM`, now kept as `bankCode`), or when its purpose names a fee (_Gebühr_, _Entgelt_, _Kontoführung_, _fee_, _charge_) and nobody but the bank is on the other side (the Revolut plan fee). _Bankgebühr – kein Beleg nötig_ on a booking teaches the account and the purpose words without digits; the next one like it needs no receipt either. _Eigene Anweisungen → Gelernte Bankgebühren_ lists them with _Vergessen_. _Warum kein Beleg nötig?_ names the rule that fired.

- **Where AI is used, said everywhere.** Every button that calls the language model carries the ✦ mark with a hover of what goes out (_Auslesen_, _Alle neuen auslesen_, upload to a booking, _Als Beleg übernehmen_, _Rechnungen holen_, _Mit KI weitersuchen_). The consent screen has a section _KI: wo ein Sprachmodell hilft_: Le Space runs no AI, each installation sets up its own model, public or local; what uses it and what runs on fixed rules (version 4, so it opens once more). README section _AI_ and `docs/ai.md` / `docs/ai.de.md`.

- **License.** App and bridge under AGPL-3.0-or-later (`LICENSE`); the portal recipes in
  `bridge/src/portals/recipes/` under MIT, so they can be reused anywhere.
- **Customer portals – Vodafone MeinKabel.** The bridge starts its own Chromium (Playwright) with
  a persistent profile per portal (`~/.config/belege/portals/<portal>/profile`, 0700): the first
  login happens in a visible window (the user types any one-time code or bot check), later runs
  are headless on the saved session. An optional password (`pnpm setup:portal vodafone`) lives in
  the keychain and is only typed into the portal's login form. Invoices must be PDFs by their
  bytes (≤ 15 MB). New endpoints under `/portals`; one run at a time per portal; "Abmelden" ends
  the session and deletes the profile. In the app: Integrationen → Kundenportale, receipts of
  source "Vodafone MeinKabel" (deduplicated by `vodafone:<invoice id>` and SHA-256), read and
  matched like every receipt. Recipes are data (`bridge/src/portals/recipes/*.json`: steps,
  selectors, extraction rules) run by a generic engine; invoices come from the portal's own JSON
  API with the headers the logged-in page sent, else from the page. The Vodafone recipe is
  written without visiting the live portal and may need an edit on the first real run. The
  consent screen lists the portals (version 3, so it opens once more).
- **"Portal aufzeichnen".** Integrationen → Kundenportale: click through the portal once in the
  bridge's window, from the start page to the invoices, and download one. The bridge records the
  trusted clicks on links, buttons, tabs and menu items as `{ role, name }` selectors (digits as
  `\d+`, anchored) or stable attributes – never an input value, a keystroke or anything on a page
  with a password field – and the control that downloaded. After a review ("Als Rezept speichern"
  / "Verwerfen") it is saved as a recipe override `~/.config/belege/recipes/<portal>.json` (0600),
  merged over the bundled recipe; later fetches replay the route without an LLM. The override is
  refused when it would hold an e-mail address, an IBAN or five digits in a row, and can be
  exported as JSON for sharing. New endpoints `POST /portals/:id/record/{start,stop,save,discard}`
  and `GET /portals/:id/recipe/export`.
- **"Zugangsdaten speichern" from the app.** Each portal card takes a user name; the bridge asks
  for the password in a native macOS dialog on its own Mac (`osascript … with hidden answer`, the
  portal's name and host passed as argv, never into the script) and stores it in the keychain
  (`portal:<id>`), the user name in `bridge.json`. The password never passes through the web app,
  no log line or response carries it, and `GET /portals` only says `hasCredentials`. Cancelled or
  empty: nothing stored. "Zugangsdaten löschen" removes both. New endpoints
  `POST`/`DELETE /portals/:id/credentials`; off macOS they point to `pnpm setup:portal`.
- **"Neues Portal aufzeichnen" – portals of your own.** From a name and an https start page (e.g.
  Anthropic, `https://claude.ai`) the bridge makes a local portal (`local-<slug>`, never colliding
  with a bundled id) and opens its recording window there; you log in by hand (magic links, SSO,
  codes and bot checks stay yours; login pages are not recorded and restart the route) and click to
  one invoice. Hosts other than the site's that the way passed through (`invoice.stripe.com`,
  `pay.stripe.com`) are listed in the review and must each be confirmed; they become the recipe's
  `allowedHosts`, and the replay aborts every other top-level navigation and refuses downloads from
  elsewhere. Saved as `~/.config/belege/recipes/local-<slug>.json` (0600), the portal is listed as
  „eigenes Rezept, lokal“ with Anmelden, Rechnungen holen, Portal aufzeichnen, Zugangsdaten and
  "Portal entfernen" (recipe, profile, credentials). Its generic login fills stored credentials
  only when a password field is on screen; dates and amounts are read in German and English
  formats. The invoice downloaded while recording (any recording) is kept and becomes a receipt
  right away. Also offered from a payment's detail ("Beim Anbieter holen": a portal matching the
  counterparty → Rechnungen holen, else Neues Portal aufzeichnen; an invoice that fits the payment
  is offered for it) and from a mail receipt that links to the vendor ("Portal für <host>
  aufzeichnen", the link's origin only). New endpoints `POST /portals/new`,
  `POST /portals/:id/remove`; `record/save` takes `{ hosts }` and returns the recorded invoice.

### Fixed

- A pair that was undone and then linked by hand again counted as _bestätigt_ with the old reasons; it is _von dir zugeordnet_ now, with the reasons it was linked on.

## [0.1.0] – 2026-09-24

### Added

- **Phase 1, step 1 – identity and sealed books.** A passkey is the identity (DID from its P-256
  key); every record is sealed with AES-GCM under a key derived from the passkey's PRF answer and
  kept in the browser (OrbitDB + Helia on IndexedDB). No private key at rest. Consent screen first,
  Le Space look, light and dark.
- **Phase 1, step 2 – bank transactions.** A bridge on `127.0.0.1` reads the allowed accounts from
  Hibiscus (pinned certificate, IBAN-suffix filter); CAMT.053 statements (Revolut) import in the
  browser; no duplicates; Zahlungen by month and day with search. Sync from a chosen date.
- **Phase 1, step 3 – receipts.** Mails to the accounting address over IMAP (read-only), uploads
  and a shared folder; every file sealed before it is stored; "Auslesen" sends the PDF's text,
  redacted by the bridge, to an LLM (DeepSeek); senders that fail DKIM/SPF wait for a
  confirmation.
- **Phase 1, step 4 – matching.** Receipts are scored against bookings (amount, invoice and
  customer number, vendor IBAN, vendor name, date window, direction); sure pairs are linked,
  unsure ones and missing receipts become questions ("Rückfragen", answered from Home). Own
  transfers (→ 1360), bank fees, loans and your own rules ("Eigene Anweisungen") need no receipt.
  Zahlungen shows real coverage and badges, and a booking's detail links and unlinks receipts,
  marks "Kein Beleg nötig", and searches the private mailbox for a missing receipt (only the hits
  are read). Matches and questions are sealed like everything else; a person's decision is never
  overridden by a later run.
- **Transparency: how things happen.** Integrationen has a "KI – Beleg-Auslesen" card (provider
  host, models, whether the bridge holds an API key – never the key –, redaction terms as a count,
  the mail server id, last extraction, totals) and says plainly that the AI only reads receipts
  while the app matches by points. A receipt shows the model, duration, tokens and redactions and
  the redacted text that was sent; a booking says why it was matched, which rule made it need no
  receipt, or which candidates a question offers with their points. A sealed activity log
  (`events`) is listed under Verlauf with filters and links. The bridge adds `GET /llm/status` and
  a fuller `POST /extract` answer.
- **Grace period** for missing receipts: no question before a booking is older than 7 days
  (configurable in Eigene Anweisungen); until then it shows "wartet noch (x Tage)".
- **One booking, one click further**: "Portal öffnen" when the purpose names the vendor's portal,
  "Beleg hochladen und dieser Zahlung zuordnen" (drag and drop too), and "Ordner jetzt prüfen"
  with a folder check every minute while the app is visible.

### Fixed

- A mail fetched again brings a changed sender verdict up to date (a bridge fixed since the first
  fetch left "Absender nicht bestätigt" standing), unless you already confirmed or ignored it.

### Changed

- The purpose shown for a booking drops the TAN method GLS appends ("SecureGo plus", "pushTAN",
  "chipTAN").
