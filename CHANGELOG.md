# Changelog

All notable changes to Le Space Belege. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Test bookings can be removed.** "Testbuchung anlegen" – a button of the development build – could put made-up payments (Testpartner GmbH, −19,99 €) into real books, with device sync even onto every own device; nothing could take them out, and with no bank account they blocked the export of their month. They are now marked, Zahlungen says so with "Testbuchungen entfernen", older ones are found by what the button wrote, and the export never takes one.

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

- **Your own chart of accounts.** _Eigene Anweisungen → Kontenplan einlesen_ reads a DATEV _Kontenbeschriftungen_ file (MonKey Office: Import & Export → Export DATEV → Kontenbeschriftungen) or any CSV with account numbers and names, UTF-8 or Windows-1252, shows a preview and keeps it sealed. "Konto" then suggests those accounts with their names and marks numbers outside the chart. An info icon and _Wie komme ich an die Datei?_ explain the export for MonKey Office and others.

- **Account assignment (_Konto_, SKR 03).** Every booking gets a contra account and a BU key: the app suggests, the person confirms with _Übernehmen_ (stored sealed on the transaction as `booking: { account, taxKey, confirmedAt }`). Suggestions: own transfer → 1360, bank fee → 4970 (no BU key), else the account the person gave this vendor last time (_gelernt_: confirming a booking whose receipt names a vendor stores `account` and `taxKey` on the vendor's partner record), else a small SKR 03 catalogue to search, or any 4–8 digit number. The BU key comes from the receipt: VAT 19 % → 9, 7 % → 8 on money out, 3 / 2 on money in, `reverse_charge` → 94 (to be checked with the tax adviser), none on an Automatikkonto (8400, 8300). _Zahlungen_ marks bookings _ohne Konto_ and filters them. _Eigene Anweisungen → Buchhaltung (MonkeyOffice / DATEV)_: each bank account's ledger account (placeholder 1200, 1210, …), Beraternummer, Mandantennummer, start of the fiscal year, Sachkontenlänge and the BU keys.
- **Monthly DATEV export.** _Export_: pick a month, see what is missing (bookings without a confirmed account and bank accounts without a ledger account block the export; bookings without a receipt, receipts linked to nothing and unconfirmed senders warn), confirm the automatic accounts of transfers and fees in one click, download `DATEV_<YYYY-MM>.zip`, made in the browser with fflate: `DATEV/EXTF_Buchungsstapel_<YYYY-MM>.csv` (EXTF 700, category 21, format version 13, Windows-1252, CRLF; Konto = the bank's ledger account, S for money in, H for money out), `Belege/<YYYY-MM-NNN>_<vendor>.pdf` (the linked receipts, opened from the sealed blob store) and `Uebersicht_<YYYY-MM>.csv` (UTF-8). An own transfer between two of our accounts is exported once, from the lower ledger account against the other. Receipt numbers are kept on the receipt (`exportNumber`), so a re-export gives the same ones. The Verlauf records _DATEV-Export 2026-09: 4 Buchungen, 1 Belege_. [docs/export.md](docs/export.md) ([Deutsch](docs/export.de.md)) says how to import it into MonkeyOffice and what to check with the tax adviser; not yet tried with MonkeyOffice itself.

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
