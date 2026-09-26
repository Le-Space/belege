# @belege/bridge

A small local service on `127.0.0.1` that does what the browser app cannot: read accounts and
transactions from a local [Hibiscus](https://github.com/willuhn/hibiscus) over XML-RPC, read receipt
mails over IMAP, ask an LLM to read a receipt, and download invoices from a customer portal
([Kundenportale](#kundenportale)) with a browser of its own. The app calls it with a bearer token it got by
pairing; the bridge hands out only accounts whose IBAN ends in a suffix you allowed, only mails
addressed to the accounting alias, and sends only redacted text to the LLM.

## Setup (macOS)

1. **Jameica plugins**: install `jameica.webadmin`, `jameica.xmlrpc` and `hibiscus.xmlrpc` from
   the repository "Plattform-Erweiterungen" (not the default one), restart Jameica.
2. **Loopback only**: Jameica's web server listens on all interfaces (`*:8080`) by default. Set
   `listener.http.address=127.0.0.1` in the webadmin plugin's properties file under
   `~/Library/jameica/cfg/` (with Jameica stopped), start Jameica, and check with
   `lsof -nP -iTCP:8080 -sTCP:LISTEN` that it shows `127.0.0.1:8080`, not `*:8080`.
3. **Set up the bridge** (from the repo root):
   ```bash
   pnpm install
   pnpm setup:hibiscus
   ```
   It asks for host and port, shows the certificate fingerprint for you to compare with the one
   Jameica shows, pins it on "yes", asks for the IBAN suffixes that may leave the bridge and the app
   origins, then the Jameica master password in a hidden prompt (stored in the keychain), and
   offers one test call.
4. **Start it**: `pnpm bridge`. Until a browser is paired it prints a one-time pairing code (10
   minutes, one use). `pnpm bridge -- --pair` prints a new one to pair another browser.
5. **Pair**: in the app, Integrationen → Bridge → enter the code → Koppeln.
6. **Mail** (optional): `pnpm setup:mail` asks for IMAP host, port and user, the accounting
   address (default `buchhaltung@le-space.de`) and the password or Mailu auth token (hidden prompt,
   into the keychain). `IMAP_*` from the repo's `.env` are offered as defaults, `IMAP_PASSWORD`
   once instead of the prompt. It offers one test login that only counts folders.
7. **LLM** (optional): `pnpm setup:llm` asks for the provider's base URL (default
   `https://api.deepseek.com`, https only), the model and the retry model (default `deepseek-flash`,
   `deepseek-v4-pro`), the terms to black out (your name, family names; `;`-separated) and the API
   key (hidden prompt, into the keychain). `DEEPSEEK_*` and `REDACT_TERMS` from `.env` are offered.
8. **Alchemy** (optional, for own EVM wallets): `pnpm setup:alchemy` asks for an Alchemy API key
   in a hidden prompt (Enter keeps a stored one, `-` deletes it), checks it with `eth_chainId` on
   each network (Ethereum, Base, Arbitrum, OP Mainnet, Polygon – enable them for the app in the
   Alchemy dashboard) and stores it in the keychain. Without it, EVM wallets are read from
   Blockscout, which answers only a few requests per half hour and IP address. Read on every
   sync: no restart needed. Nothing is taken from `.env`.
9. **Restart the bridge** after either setup: `pnpm bridge`. `/health` says what is set up.
10. **Unpair**: "Kopplung lösen" in the app makes the bridge forget that token too. For a device
   that cannot do it itself (lost, wiped, or the bridge was off): stop the bridge, then
   `pnpm bridge -- --list-pairings`, `pnpm bridge -- --revoke <n>` or `pnpm bridge -- --revoke-all`.

## Where things are kept

| What | Where |
|---|---|
| Hibiscus master password | macOS keychain, service `belege-bridge`, account `hibiscus` |
| IMAP password or auth token | macOS keychain, service `belege-bridge`, account `imap` |
| LLM API key | macOS keychain, service `belege-bridge`, account `llm` |
| Alchemy API key (optional; `pnpm setup:alchemy`) | macOS keychain, service `belege-bridge`, account `alchemy`; only ever in the URL of the bridge's requests to Alchemy |
| A portal password (optional; `pnpm setup:portal` or "Zugangsdaten speichern") | macOS keychain, service `belege-bridge`, account `portal:<portal>` |
| A portal's browser profile (cookies, the live session) and `state.json` (last login, last run) | `~/.config/belege/portals/<portal>/` (0700), next to `bridge.json` |
| A recorded recipe ("Portal aufzeichnen"): route, download control, confirmed other hosts, review | `~/.config/belege/recipes/<portal>.json` (0600, directory 0700) |
| A portal of your own ("Neues Portal aufzeichnen"): name, start page, route, … | `~/.config/belege/recipes/local-<slug>.json` (0600) |
| Host, port, pinned SHA-256, IBAN suffixes, app origins, hashes of paired tokens; IMAP host/port/user, accounting address; LLM URL, models, terms to black out; a portal's user name | `~/.config/belege/bridge.json` (0600; `BELEGE_BRIDGE_CONFIG` overrides) |
| The bearer token | the app's encrypted store (`settings`), never on the bridge's disk |
| Own wallets (chain, address, own endpoints) | the app's encrypted store (`settings`, key `wallets`); the bridge keeps nothing, it gets them with each `POST /<chain>/wallet` |

## API

All JSON, `127.0.0.1:8765` by default. Everything except `/health` and `/pair` needs
`Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /health` | `{ ok, paired, pairingOpen, hibiscus: { configured }, mail: { configured, accountingAddress }, llm: { configured, models }, portals: { available }, kraken: { configured }, wallets: { available } }` |
| `POST /pair` `{ code }` | `{ token }`, once per code |
| `POST /unpair` | forgets the calling token; `{ ok: true }` |
| `GET /hibiscus/accounts` | allowed accounts: `id, ibanMasked, ibanLast4, name, currency, balanceCents, balanceDate` |
| `GET /hibiscus/transactions?account=<id>&since=YYYY-MM-DD` | `date, valueDate, amountCents, currency, counterpartyName, counterpartyIban, purpose, endToEndId, bookingType, sourceId, fingerprint` |
| `GET /mail/messages?since=YYYY-MM-DD[&until=YYYY-MM-DD]&scope=accounting` | mails to the accounting address received in [since, until): `id, folder, uid, date, receivedAt, from { address, name }, subject, auth { verdict, dkim, spf, dmarc, domain }, outgoing, attachments [{ part, name, type, size, kind, isPdf, mime }], excerpt, addressedBy` |
| `GET /mail/attachment?id=<id>&part=<n>` | the bytes of one attachment: PDFs and images only (by their bytes), at most 15 MB |
| `GET /mail/search?text=&amount=&from=&term=…&around=YYYY-MM-DD&days=14` | the targeted search in the whole mailbox (Junk included, Trash and Drafts not): the same shape plus `matched` (`"text"`, `"term"`, `@domain`, or which amount spelling). `term` (up to 6, each 3–100 of letters, digits and `.,:_-`): more words anywhere in the mail, e.g. a crypto payment's hash, address and quantity |
| `GET /llm/status` | `{ configured, provider, models { primary, fallback }, keyConfigured, redactTerms, mail { authServId } }`: the provider's host only (no path, query or `user:password@`), whether the keychain holds a key (yes/no, never the key), and how many terms are blacked out (a count, never the terms) |
| `GET /kraken/balances` | `{ balances: [{ asset, wallet: 'spot' \| 'earn', amount, decimals }] }`: every non-zero balance, Kraken's asset codes normalised (`XXBT` → BTC, `DOT.S` → DOT/earn). 503 until `pnpm setup:kraken` |
| `GET /kraken/ledgers?since=YYYY-MM-DD` | `{ since, entries: [{ id, refid, time, date, type, subtype, asset, wallet, amount, fee, decimals }] }`, oldest first; all pages (`ofs`), with a pause between pages and retries on Kraken's rate limit. The log gets counts, never amounts |
| `GET /rates?asset=BTC&date=YYYY-MM-DD[&prefer=kraken]` | `{ asset, date, currency: 'EUR', rate, usdRate, source, at }`: EUR per whole unit at 00:00 UTC of the day, from CoinGecko, else Kraken (daily candle open); USD from the ECB reference rate. Rates are decimal strings. 400 for an unknown asset or a future day, 502 when no source answers. See [docs/crypto.md](../docs/crypto.md) |
| `GET /chains` | the chains an own wallet can be on: `{ chains: [{ id, kind (cosmos \| evm), name, shortName, caip2, assets, nativeSymbol, bech32Prefix?, endpoints, alternatives, explorer { name, tx, address }, alchemySupported?, alchemyInternal? }], alchemy }`; `alchemy`: whether an Alchemy key is set up – never the key |
| `POST /<chain>/wallet` `{ address, endpoints? }` | an own wallet's whole history and balance, read from a public node, from Alchemy for an EVM chain when a key is set up and the wallet names no `api` endpoint of its own, or from the https `endpoints` given: `{ chain, endpoints, source (evm: alchemy \| blockscout), entries [{ id, hash, height, time, date, type (sent \| received \| fee), kind, asset, amount, decimals, counterparty, counterpartyLabel, memo, success, explorerUrl }], balances [{ asset, amount, decimals }], transactions, unknownAssets, history { earliestHeight, earliestTime, pruned }, addressUrl }`. 400 `WALLET_ADDRESS` (bech32 prefix or EIP-55 checksum wrong; no node is asked), `WALLET_ENDPOINT`, `WALLET_WRONG_CHAIN` (the node or the Blockscout API serves another chain); 502 `WALLET_CHAIN_UNVERIFIED` (a Blockscout API that does not say its chain id); 502/504 `WALLET_UNREACHABLE`, `WALLET_NODE`, `WALLET_TIMEOUT`, 429 `WALLET_RATE_LIMIT`; with Alchemy 502 `WALLET_ALCHEMY_AUTH` (key refused: run `pnpm setup:alchemy`), `WALLET_ALCHEMY_DENIED` (network not enabled for the Alchemy app, capacity used up), `WALLET_ALCHEMY` (a call refused), 429 `WALLET_ALCHEMY_RATE_LIMIT`. The log gets counts, never an address. See [docs/crypto.md](../docs/crypto.md#own-wallets) |
| `POST /extract` `{ text, hints: { subject, from, fileName, receivedAt }, source: { mailId }, confirmedByUser }` | `{ extraction, model, usage { prompt, completion, reasoning }, ms, attempts [{ model, ok, reason, ms, usage }], fallback { used, reason }, redactions { terms, iban, email, street, postcode, total }, sentText }`; 403 `SENDER_UNVERIFIED` for a mail whose sender did not pass, 502 `EXTRACT_FAILED` with the attempts when no model gave a usable answer |
| `GET /portals` | every portal the bridge knows: `id, name, recipeVersion, state, lastLoginAt, lastRun { at, ok, count, code, step }, running, recordable, recorded, review, credentials, hasCredentials, source, pending, host`, with `source` `bundled` or `local` (a portal of your own), `pending` for a new one not saved yet, and `state` one of `logged-in`, `needs-login`, `never`; starts no browser |
| `POST /portals/:id/login` | opens the visible window and answers once logged in: `{ state: 'logged-in' }`; 408 `PORTAL_LOGIN_TIMEOUT` after 10 minutes, 409 `PORTAL_CANCELLED` when the window was closed or the login cancelled |
| `POST /portals/:id/cancel` | ends a waiting login |
| `POST /portals/:id/fetch?since=YYYY-MM` `{ known: [invoice ids] }` | lists the invoices from that month on and downloads those not in `known`: `{ listed, skipped, invoices [{ id, date, period, amountCents, invoiceNumber, fileName, size, sha256 }], errors [{ id, code }] }`; 409 `PORTAL_NEEDS_LOGIN` (with `reason`: `never`, `expired`, `otp`, `captcha`, …) when nobody is logged in |
| `GET /portals/:id/invoice?ref=<invoice id>` | the PDF's bytes, from the last fetch (kept in memory only) |
| `POST /portals/:id/logout` | logs out on the portal when it can, deletes the profile: `{ state: 'never' }` |
| `POST /portals/:id/record/start` | "Portal aufzeichnen": opens the visible window on the portal's start page and answers `{ recording: true }` once it is open |
| `POST /portals/:id/record/stop` | ends the recording (or returns the stopped one): `{ at, download, pausedOnLogin, steps [{ kind: 'click', role, label, download, usable, host? } \| { kind: 'page', path, host? }], hosts, invoice }` – `hosts`: the other hosts the way passed through, `invoice`: the downloaded PDF was kept; 409 `PORTAL_NOT_RECORDED` |
| `POST /portals/:id/record/save` `{ hosts }` | the recording becomes the portal's recipe override; `hosts` are the other hosts the user confirmed: `{ saved, recipeVersion, route, allowedHosts, invoices }` (`invoices`: the one downloaded while recording, fetched with `GET …/invoice` like any other); 422 `PORTAL_HOSTS_UNCONFIRMED` (with `step`: the first host not confirmed), `PORTAL_RECORDING_NO_DOWNLOAD`, `PORTAL_RECORDING_UNUSABLE`, or `PORTAL_RECIPE_REJECTED` with `step` (a JSON path) and `reason` (`email`, `iban`, `digits`, `shape`) |
| `POST /portals/:id/record/discard` | ends and drops a recording: `{ discarded }` |
| `GET /portals/:id/recipe/export` | the saved override as JSON, for sharing; 404 `PORTAL_NO_RECORDED_RECIPE` |
| `POST /portals/new` `{ name, startUrl }` | "Neues Portal aufzeichnen": a portal of your own (`local-<slug>`), its recording started: `{ id, recording: true }`; 400 `PORTAL_NEW_INVALID` with `reason` `name` or `url` |
| `POST /portals/:id/remove` | "Portal entfernen": a portal of your own – its recipe file, profile and credentials: `{ removed: true }`; 409 `PORTAL_NOT_LOCAL` for a bundled one |
| `POST /portals/:id/credentials` `{ username }` | "Zugangsdaten speichern": asks for the password in a native macOS dialog on the bridge's Mac, stores it in the keychain and the user name in `bridge.json`: `{ hasCredentials: true }`; 409 `PORTAL_CREDENTIALS_CANCELLED`, 422 `PORTAL_CREDENTIALS_EMPTY` (nothing stored either way), 400 `PORTAL_CREDENTIALS_INVALID`, 501 `PORTAL_CREDENTIALS_UNSUPPORTED` off macOS (use `pnpm setup:portal <id>`) |
| `DELETE /portals/:id/credentials` | "Zugangsdaten löschen": the keychain entry and the user name: `{ hasCredentials: false }` |

All portal calls answer 409 `PORTAL_BUSY` while another run of the same portal is going on, and 502
`PORTAL_STEP_FAILED` with `step` when the portal did not look as the recipe expects.

### Mail

- Every folder is opened read-only (EXAMINE). The listing skips Trash, Junk and Drafts (by
  SPECIAL-USE, else by the usual names) and keeps Sent. `X-Original-To` and `Delivered-To` are empty
  on this server, so the server is asked for `To:` or `Received: … for <alias>`, and every hit is
  checked again against its parsed `To:`/`Cc:`/`Received:` headers before it leaves.
- Of a mail, only headers, the MIME structure, the first KB of each attachment that may be a
  receipt (to tell a PDF by `%PDF-`, since about half arrive as `application/octet-stream` or
  `.PDF`) and the first 16 KB of its text part (for a 2 KB excerpt, HTML stripped) are fetched.
  Inline images (logos) are not receipts; images count only as attachments.
- The sender verdict comes from `Authentication-Results`: only the topmost header counts (our
  server's; a sender can add its own further down), or only headers of `mail.authServId` when
  that is set in `bridge.json`. `pass` needs DKIM or SPF passing for the From: domain (or a
  subdomain) or DMARC passing; a pass for another domain only is `none`; an explicit fail is
  `fail`. Mails in Sent are marked `outgoing`.
- A window that reaches into the future leaves its end open (imapflow turns SINCE/BEFORE into
  YOUNGER/OLDER, and Dovecot rejects `OLDER 0`).
- `/mail/search` is for one missing receipt (step 4 uses it): vendor text and every spelling of
  an amount (`52,59`, `52.59`, `1.190,00`, `1,190.00`) within ± days; only the hits are read.

### LLM

- The bridge redacts, not the browser: every `/extract` goes through `src/llm/redact.js` (the
  phase-0 rules: the terms from `bridge.json`, IBANs with the last four characters kept, SEPA
  creditor ids kept, e-mail addresses of our own domains – from the IMAP user and the accounting
  address –, postcode + town, street + number, and suffix-less streets by position above a
  postcode line). The hints (subject, sender, file name) are redacted too.
- The prompt and schema are the spike's. `max_tokens` 6000 (both models reason first), JSON mode,
  and anything but `finish_reason: stop` is a failure. An answer must check out – gross present,
  ISO currency, dates that are dates, net + VAT = gross within one cent when both are there –
  or the retry model is asked. A 401 is not retried.
- Before a mail's text goes out, the bridge looks up that mail's sender verdict itself (from the
  last listing, else from its headers); unless it passed or the mail is our own (Sent), the
  request must carry `confirmedByUser: true`.
- Neither the text nor the answer is logged; the log says which model answered, how long it
  took and how many places were blacked out.
- `/extract` answers with what it did, so the app can show it: the model that answered, whether
  the retry model was needed and why (the first attempt's reason), the duration, the tokens of
  every attempt (a failed attempt is billed too), the blacked-out places by kind, and `sentText`,
  the redacted user message exactly as it went to the provider. The app keeps it inside the
  sealed receipt record ("An die KI gesendet"). The system prompt is the fixed `SYSTEM` in
  `src/llm/extract.js`.
- The API key stays in the keychain. It is read for each `/extract` and by `/llm/status` to say
  whether it is there; no response carries it (`test/extract.test.js` checks every one). It is
  changed with `pnpm setup:llm`, not from the browser: a key typed into the page would be readable
  by any script that ever runs there.

## Kundenportale

Invoices that only exist in a customer portal (first: **Vodafone MeinKabel**, i.e. MeinVodafone
for cable customers) are fetched by a browser the bridge starts on this Mac: Playwright's own
Chromium, **not** your everyday Chrome, with one persistent profile per portal. No cloud browser,
no LLM in the login, no screenshots anywhere.

### Setup and the first login

1. Install the browser once: `pnpm --filter @belege/bridge exec playwright install chromium`.
2. Optional: store your user name and password, either in the app (Integrationen → Kundenportale →
   **Zugangsdaten speichern**, see below) or with `pnpm setup:portal vodafone` (user name in
   `bridge.json`, password from a hidden prompt into the keychain account `portal:vodafone`; restart
   the bridge afterwards). Without them you type both in the window at every login.
3. In the app: Integrationen → Kundenportale → **Anmelden**. A browser window opens on the portal's
   login page. With a stored password the bridge fills the form and ticks "Angemeldet bleiben";
   the cookie banner gets "Nur notwendige". A one-time code (SMS, e-mail) or a bot check is always
   yours: type it in the window. The bridge waits up to 10 minutes until it sees you logged in,
   then closes the window. Closing the window yourself, or "Abbrechen" in the app, cancels.
4. **Rechnungen holen** (from a month on): headless on the saved session. The app sends the ids it
   already has, the bridge lists the invoices, downloads only the new ones, checks every file is a
   PDF by its bytes (≤ 15 MB) and hands them to the app, which seals them as receipts of source
   "Vodafone MeinKabel" (`sourceRef` `vodafone:<invoice id>`, no duplicates by that or by SHA-256),
   reads them with the LLM when one is set up, and matches them to bookings.
5. When the session has expired, the bridge logs in again headless with the stored password if
   that works without you; otherwise the app shows "Anmeldung abgelaufen" and you press
   **Anmelden** again.
6. **Abmelden** logs out on the portal when it can and deletes the profile.

### Zugangsdaten speichern (from the app)

Each portal card has a user name field and **Zugangsdaten speichern**. The app sends the user name
only (`POST /portals/:id/credentials`). The bridge then asks for the password in a **native macOS
dialog** on its own Mac (`osascript`, `display dialog … with hidden answer`, title "Le Space
Belege", naming the portal and its host) and stores it in the keychain (service `belege-bridge`,
account `portal:<id>`), the user name in `bridge.json` – the same places `pnpm setup:portal` uses,
effective at once, no restart. The password never passes through the web app and is in no log line
and no response; `GET /portals` says `hasCredentials: true|false`, nothing more.

- The portal's name and host reach the AppleScript as `argv` (`on run argv`, after `--`), never
  interpolated into the script, so a portal name cannot change what runs.
- **Abbrechen** in the dialog (or 5 minutes without an answer) → 409 `PORTAL_CREDENTIALS_CANCELLED`;
  an empty password → 422 `PORTAL_CREDENTIALS_EMPTY`. Nothing is stored in either case.
- Not macOS → 501 `PORTAL_CREDENTIALS_UNSUPPORTED`: use `pnpm setup:portal <id>` there.
- **Zugangsdaten löschen** (`DELETE /portals/:id/credentials`) removes the keychain entry and the
  user name.
- The dialog is a function `startBridge` is handed (`portalPasswordDialog`); the tests hand in a
  fake, and `--test-mode` answers `$BELEGE_BRIDGE_TEST_PORTAL_DIALOG` (or cancels) without a window.

### The recipe, the first real run, and when the portal changes

A recipe is **data**: `src/portals/recipes/vodafone-meinkabel.json` holds the paths, the selectors
(German labels first: `Anmelden`, `Rechnungen`, `Rechnung herunterladen`, `PDF`, `Angemeldet
bleiben`, each with fallbacks), the login steps (`click`, `fill`, `check`, `stopIf`, `outcome`;
the password step is `{ "value": "$password", "secret": true }`) and the extraction rules. The
engine (`src/portals/recipe.js`) has nothing portal-specific in it and refuses a recipe it cannot
run, saying where. Invoices are listed by the first strategy that works:

1. **api**: the JSON endpoints the portal's own web client calls after login (for MeinVodafone,
   per public open-source downloaders: `api.vodafone.de/meinvodafone/v2/user/userInfo` → cable
   contracts → `…/customer/urn:vf-de:cable:can:<contract>/invoice` → `…/invoiceDocument/<id>` as
   base64). The bridge does not log in to the API itself: it reuses the `Authorization` and
   `x-api-key` headers the logged-in page sent to that host during the same browser run (in
   memory only, never logged or stored), and only for the paths in the recipe.
2. **dom**: the download controls on the documents page
   (`/meinvodafone/services/notifizierung/dokumente`), and the date, month, amount and invoice
   number read from the text around each one; plain links are fetched with the browser's cookies,
   anything else is clicked and the download taken.

The recipe was written **without visiting the live portal** (`"verified": false`, shown in
`GET /portals` as "unverified"). The tests run it against a fake portal built from the same
assumptions, so they prove the machinery, not the paths and selectors. Expect the first real run
to need an edit:

- When something does not fit, the app says which **step** failed (e.g. `login.username`,
  `invoices.open`, `invoices.download`) and the bridge logs `portal vodafone: step … failed
  (TimeoutError)` and which strategy it used (`strategy api: 12 invoice(s)` or `strategy api
  unavailable (401)`) – never page content, a user name, a password or a token. Report the step
  and what you saw in the window; if you edit the JSON yourself, bump `version`.
- Portals often end sessions after some days or when the browser closes; if you are asked to log
  in every time, "Angemeldet bleiben" may be named differently (the `remember` selectors).
- Portals may treat a headless browser as a bot. If fetching fails where the window works, set
  `"headless": false` under `portals.vodafone` in `bridge.json`: fetches then run in a visible
  window too.

### Portal aufzeichnen

When the bundled recipe does not find the invoices, record the way once (Integrationen →
Kundenportale → **Portal aufzeichnen**, after a login). The bridge opens its window on the portal's
start page (`baseUrl`); you click to your invoices and download one. **Aufzeichnung beenden**
shows the steps (e.g. `Link ‚Rechnungen‘`, `Button ‚herunterladen‘ (Download)`); **Als Rezept
speichern** keeps them, **Verwerfen** drops them. From then on every fetch replays the clicks,
without an LLM (`src/portals/recorder.js`, engine in `src/portals/recipe.js`):

- **What is recorded**: only real (trusted) clicks on `a`, `button` and `[role=button|tab|link|menuitem]`
  in the top frame. Each becomes one selector: `{ role, name }` by the accessible name, digits
  turned into `\d+` and anchored (`Rechnung vom 01.07.2026` → `^Rechnung vom \d+\.\d+\.\d+$`),
  else a stable attribute (`[automation-id]`, `[data-testid]`, …, an `#id` without digits). A
  control with neither (or whose name holds an e-mail address or an IBAN) is shown as not usable
  and left out. Pages appear as masked paths in the review only; the replay never opens a recorded
  URL.
- **What never is**: input values, keystrokes, anything in or at an input, textarea, select or
  contenteditable, and anything while a password field is on the page (login pages are only
  counted).
- **The downloaded invoice** is kept in memory when it is a PDF by its bytes (≤ 15 MB) and handed
  to the app when the recording is saved (`invoices` in the answer, then `GET …/invoice`), so the
  recording already yields a receipt; Playwright's download folder is temporary.
- **Other hosts**: clicks and pages on hosts other than the portal's site are recorded with their
  `host` (an invoice page on `invoice.stripe.com`, a PDF from `pay.stripe.com`). The review lists
  them and each one must be ticked before the recording can be saved; they become the recipe's
  `allowedHosts`. The replay follows a click that opens a new window, clicks a step with a `host`
  in the window on that host, aborts every other top-level navigation (`context.route`, only for
  recipes with `allowedHosts`) and refuses a download from any other host.
- **The result** is an override in `~/.config/belege/recipes/<portal>.json` (0600): `route` (the
  clicks before the download), `dom.downloadControls` (the control that downloaded, put before the
  bundled ones), `recorded { at, steps }`, `verified: false`, version `<bundled>+rec.<day>`. It is
  merged over the bundled recipe whenever the recipes are built (bridge start, and right after
  saving); one that does not pass is ignored and logged.
- **The replay**: with a `route`, `listInvoices` opens the start page (`paths.start`, else `baseUrl`) and clicks each target (failures are
  steps `route.open`, `route.1`, …), then lists by the recipe's strategies as before; the `dom`
  strategy also finds the recorded `{ role, name }` control. The API strategy, when it works,
  still comes first.
- **Sharing**: **Rezept exportieren** (`GET /portals/:id/recipe/export`) downloads the override as
  JSON, meant for a future open `@le-space/portal-recipes` package. Before it is saved (and when it
  is read) it is refused if any value holds an e-mail address, an IBAN or a run of five digits.

### Neues Portal aufzeichnen (a portal of your own)

For a vendor the bridge ships no recipe for (e.g. **Anthropic**, `https://claude.ai`): Integrationen
→ Kundenportale → **Neues Portal aufzeichnen** (name + start page), or from a payment's detail
("Beim Anbieter holen", prefilled with the counterparty) or from a receipt that came by mail and
links to the vendor ("Portal für <host> aufzeichnen", the link's **origin only** – a link may carry
a token). `POST /portals/new` (`src/portals/local.js`):

- **The id** is `local-` + a slug of the name (`Müller & Söhne` → `local-muller-sohne`), `-2`, `-3`
  when taken; bundled ids have no prefix, so they never collide. The name is one line of at most 60
  characters without an e-mail address, an IBAN or five digits; the start page must be `https://`,
  without user, password or port; its query and fragment are dropped, a path with five digits is
  refused.
- **The recipe** is a generic definition (baseUrl = the start page's origin, the start path is login
  and invoice page) with the recording merged over it. The window opens on the start page and you
  **log in by hand** – magic links, "Mit Google anmelden", one-time codes and bot checks are always
  yours; the bridge never automates or bypasses them. For a new portal a page also counts as a login
  page by its address (`…/login`, `…/signin`, `…/auth`, `accounts.…`, …) or a user-name or
  one-time-code field; nothing there is recorded, and every login page starts the route afresh (the
  replay begins logged in, so what came before the login is not part of it). Then click to one
  invoice (on another host, if that is where it is) and download it.
- **Saved**, it is `~/.config/belege/recipes/local-<slug>.json` (0600) with a `local` block
  (`name`, `baseUrl`, `start`), `allowedHosts`, `route`, `dom.downloadControls`, `recorded`. It is
  listed with `source: 'local'` (the app shows „eigenes Rezept, lokal“) and has Anmelden,
  Rechnungen holen, Portal aufzeichnen, Zugangsdaten, Rezept exportieren and **Portal entfernen**
  (`POST /portals/:id/remove`: recipe file, profile and credentials). A new portal discarded before
  it was ever saved is gone with its profile. `pnpm setup:portal local-<slug>` works too.
- **Logged in** means: the first recorded control (else the download control) shows on the start
  page. With stored credentials and a **password field** on screen, the bridge fills the first text
  or e-mail field before it and the password field and submits; without a password field (a magic
  link, SSO, a two-step form) the login stays yours ("Anmelden", `409 PORTAL_NEEDS_LOGIN` on fetch).
- **Invoices**: the route leads to one invoice (for a list of "Rechnung ansehen" links: the first,
  i.e. usually the newest), the recorded control downloads it; date, amount and number are read from
  the text around the control in German and English formats (`03.09.2026`, `September 3, 2026`,
  `1.039,99 €`, `$20.00`).
- In tests only (`portalLoopback`, `--test-mode`) the start page may be `http://127.0.0.1:<port>`;
  a local recipe with a loopback origin is ignored otherwise.

### What is stored, and the risks

- The **profile holds a live session**: anyone who can use your macOS account (or read
  `~/.config/belege/portals/`) can use your portal account without the password until the
  session ends. Keep FileVault on; **Abmelden** deletes the profile. The directories are 0700.
- The optional password is in the keychain and is only ever typed into the portal's login form by
  Playwright; it is not logged, not in any response and not sent anywhere else.
- Downloads are kept in the bridge's memory until the app has taken them; Playwright's own
  download folder is temporary. `state.json` holds times and counts only.
- **Terms of service**: a portal's terms may restrict automated access, even to your own account.
  The connector only does what you would do by hand (log in, open the invoice list, download
  PDFs), at your click, at human pace – but check the terms of your provider.

## Threat model

- **Other machines**: the bridge binds `127.0.0.1` only and refuses to start on anything else;
  Jameica should listen on loopback too (step 2).
- **Other websites in your browser**: CORS lets only the configured app origins read answers, the
  `Host` header must be `127.0.0.1`/`localhost` (no DNS rebinding), and without a token nothing but
  `/health` answers.
- **A fake Jameica**: the certificate is pinned; every call checks it on its own connection before
  the keychain is asked, so a mismatch never sends the password.
- **Private accounts in the same Hibiscus**: filtered by IBAN suffix straight after `konto.find`;
  other accounts and their transactions are never requested or returned.
- **What leaves this machine**:
  - to the mail server: the IMAP login (from the keychain) and read-only commands over TLS
    (`tls: none` is refused for anything but a server on this machine);
  - to the LLM provider (DeepSeek: servers in China): per "Auslesen", the redacted text layer of
    one PDF (up to 30 000 characters) or a mail's text excerpt, with the redacted subject, sender
    address and file name, and the API key. Never the file itself, never a mail that was not
    asked for. Redaction is pattern-based: a name not in the terms list, or an address in an
    unusual layout, can get through. The provider sees the vendor, amounts, invoice numbers.
- **Look-alike phishing and malicious PDFs**: mails whose sender did not pass DKIM/SPF are neither
  sent to the LLM (the bridge refuses) nor previewed in the app (pdf.js, with eval off) until you
  confirm them. The bridge hands out only PDFs and images, by their bytes.
- **Customer portals**: the browser talks to the portal's own site only (a base URL in
  `bridge.json` is honoured for loopback test servers alone); a download is accepted only as a PDF
  by its bytes. The browser profile with the live session is the new asset here, see
  [Kundenportale](#kundenportale).
- **Not covered**: other processes running as your user can read the config and ask the keychain
  (macOS may prompt), and can use a portal session from its profile; a stolen app token works
  until you remove its hash from `bridge.json`.

## Development

```bash
pnpm test:bridge            # node:test: a fake HTTPS Hibiscus, a fake IMAP server (hoodiecrow)
                            # with a synthetic mailbox, a fake OpenAI-compatible API, and a fake
                            # Kundenportal driven by a real headless Chromium
pnpm --filter @belege/bridge exec playwright install chromium   # once, for the portal tests
pnpm --filter @belege/bridge lint
```

`--test-mode` (used by the app's E2E suite) takes the secrets from `BELEGE_BRIDGE_TEST_PASSWORD`,
`BELEGE_BRIDGE_TEST_IMAP_PASSWORD`, `BELEGE_BRIDGE_TEST_LLM_KEY` and
`BELEGE_BRIDGE_TEST_PORTAL_PASSWORD` (and the Kraken, CoinGecko and Alchemy keys from
`BELEGE_BRIDGE_TEST_KRAKEN_KEY`, `…_COINGECKO_KEY`, `…_ALCHEMY_KEY`) instead of the keychain, sends
an Alchemy key only to the fake at `BELEGE_BRIDGE_TEST_ALCHEMY_URL` (`http://127.0.0.1:<port>`;
without it the key is refused), never opens a portal window (headless only), and refuses the real
config file. No test talks to a real mail server, Hibiscus, LLM, portal, chain node or Alchemy
(`test/support/fake-alchemy.js` is as strict as Alchemy about methods, parameter types and error
shapes).
