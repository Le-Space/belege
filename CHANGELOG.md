# Changelog

All notable changes to Le Space Belege. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions will follow
[Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

### Added

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
