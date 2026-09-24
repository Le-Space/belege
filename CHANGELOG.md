# Changelog

All notable changes to Le Space Belege. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions will follow
[Semantic Versioning](https://semver.org/) once there is a release.

## [Unreleased]

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
