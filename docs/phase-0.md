# Phase 0 findings

## IMAP (one month of a mixed personal/business mailbox)

- Login: use a Mailu auth token, not the account password.
- About 420 mails per month; about 20 carry a PDF, 7 an image. Most mails have no attachment.
- Almost half of the PDFs arrive as `application/octet-stream` or with an upper-case `.PDF`:
  detect PDFs by magic bytes (`%PDF-`), not by MIME type.
- Many receipts carry no attachment: order confirmations, payment notices (Klarna, card
  payment services), "your invoice is online" mails with a portal link. The filter must read
  the body and recognise download links; some receipts will only come from a vendor portal.
- Look-alike phishing uses the same words as real invoices ("subscription paused – update
  payment method", "storage payment issue"). Receipts must only be accepted from senders that
  pass DKIM/SPF (the `Authentication-Results` header) and that match a known partner, or
  after a question to the user.
- Unsolicited PDFs from unknown senders (job applications, "offers") are a malware vector:
  never open them automatically, and never send them to an LLM without a check.
- The mailbox mixes private and business mail. Private vs. business needs its own rules
  ("custom instructions") plus the LLM, and a question when unsure.
- Travel shows up as a bundle: train/bus tickets as PDF, payment receipts, and `.ics`
  calendar attachments with departure and arrival times. The `.ics` files give trip start
  and end for the travel-expense logic.
- `Sent` holds outgoing invoices and forwarded receipts; keep it in the scan.

### Two tiers: the accounting address first, the private mailbox only on request

- The accounting address is an alias that lands in the same mailbox. Filter on `To:`
  (plus `Received: … for <address>` for Bcc); `X-Original-To` and `Delivered-To` are not set.
  That leaves about 7–10 mails a month instead of about 420, almost all of them receipts.
- Receipts that went to the personal address (for example a subscription billed to it) are
  found with a targeted server-side search: vendor text and amount (every spelling:
  `52,59`, `52.59`, `1.190,00`, `1,190.00`) within ± N days of the bank booking. Only the hits
  are fetched; the rest of the private mailbox is never read.
- A vendor search also returns newsletters that mention the vendor, and an amount search
  returns unrelated mails with the same number. The hits need ranking: sender domain matches
  the partner, both vendor and amount matched, attachment present, DKIM passed. The final
  check is the attachment's content (LLM or PDF text).
- The server search does not see amounts inside PDF attachments.
- imapflow turns `SINCE`/`BEFORE` into `YOUNGER`/`OLDER`; Dovecot rejects `OLDER 0`, so a
  window that reaches into the future must leave its end open.

## DeepSeek

- The API lists `deepseek-flash` and `deepseek-v4-pro`; `deepseek-chat` is gone. The key check
  warns when `DEEPSEEK_MODEL` is not in the list.
- CORS is open: the API answers a preflight from `http://localhost:5173` with that origin. The
  browser could call DeepSeek directly; whether it should (the key would live in the browser)
  is a separate decision.
- A key with no credit passes `/models` but every completion fails with HTTP 402.
- Both models reason before answering, and the reasoning counts against `max_tokens`: with 60
  tokens both stop with `finish_reason: length` and an empty answer. A one-line invoice needs
  about 100–140 reasoning tokens. Budget generously and treat anything but `stop` as a failure.
- On the test invoice both return the same correct JSON; flash in about 1.4 s, v4-pro in about 2.8 s.

### Extraction test: 12 real PDFs, both models

Samples: invoices (Sage, easyname, Hetzner, Anthropic, Cyberport), a direct-debit notice, a
payment reminder, a receipt, a bus and two train tickets, a credit-card statement.

- All 12 PDFs have a text layer; no OCR needed for this set. unpdf (pdf.js) extracts it.
- Redaction needs a positional rule: street lines without a suffix ("Name 44") are only
  recognisable as the line above a postcode line. Tickets carry fellow travellers' names –
  `REDACT_TERMS` must cover the family name. Station names stay: travel expenses need them.
- Vendor, gross amount, currency, document type: identical and correct in both models for
  all 11 documents both answered.
- Where they differ: flash marked a card fee as reverse charge (wrong), missed the paid date on
  a receipt, but found a ticket's order number that v4-pro missed. v4-pro took the right last
  digits of our own masked IBAN on a direct-debit invoice (the account that will be debited –
  it tells which bank account to match against).
- Both got the date of one direct-debit notice wrong: pdf.js glued a table row together
  (`2026-122069916.07.2026 15.08.2026`). Tables need a layout-aware extraction or a check
  against the letter date.
- Text extraction mangles numbers: `ZIVYFQIJ 0002` for `ZIVYFQIJ-0002`. Matching must compare
  invoice numbers with separators stripped.
- flash: 113 s for 12 documents, one failure (reasoning ran past 6000 tokens). v4-pro: 354 s,
  no failure. Output tokens are similar; both runs together cost about 0.07 USD.
- Plan: flash by default, v4-pro as retry when flash fails or checks fail (net + VAT ≠ gross,
  date outside the mail's date ± 60 days, missing gross). Extraction runs in the background,
  so 10–30 s per document is acceptable.

## Revolut and Hibiscus

- Revolut offers no FinTS/HBCI, so Hibiscus cannot fetch Revolut itself.
- Revolut Business exports an "accounting export" as CAMT.053 or MT940; Hibiscus imports MT940
  into an offline account. That is the phase 0 path.
- An experimental Hibiscus plugin for the Revolut Business API exists (UB-GH/HibiscusRevolut,
  June 2026, untested, one star). It would hold API credentials for a bank account; do not use
  it without a review. The Revolut Business API can later be called by the bridge directly.
