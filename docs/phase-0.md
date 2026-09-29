# Phase 0 findings

Before phase 1, a few spikes answered whether the plan could work at all. What became of each:

| Spike                | Question                                                                    | Outcome                                                                                     |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `spikes/hibiscus`    | Can we read accounts and transactions from a local Hibiscus over XML-RPC?   | yes: the bridge does it ([bridge/README.md](../bridge/README.md))                           |
| Revolut → Hibiscus   | Does Revolut's CSV/CAMT export import into a Hibiscus offline account?      | not needed: CAMT.053 statements import straight into the app                                |
| `spikes/imap`        | Can the bridge list receipt mails, and what do their attachments look like? | yes, with a Mailu auth token; many PDFs come as `application/octet-stream` (below)          |
| `spikes/llm`         | How well does DeepSeek extract amount, date, invoice number from receipts?  | well: vendor, gross and currency right; a faster model with a stronger one as retry (below) |
| DATEV → MonkeyOffice | Which EXTF fields and receipt links does MonkeyOffice import?               | built in phase 1 ([export.md](export.md)); not yet tried with MonkeyOffice itself           |

The spikes still run (made-up values in the examples):

```bash
read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
pnpm spike:hibiscus

cp .env.example .env   # fill in IMAP_*
pnpm spike:imap -- --month 2026-08 --accounting                          # the accounting alias only
pnpm spike:imap -- --find Beispiel --amount 12,34 --around 2026-08-15   # one missing receipt
```

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
  `12,34`, `12.34`, `1.190,00`, `1,190.00`) within ± N days of the bank booking. Only the hits
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

Samples: invoices from five software, hosting and hardware vendors, a direct-debit notice, a
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
  (`2026-10000101.07.2026 01.08.2026`, made up here). Tables need a layout-aware extraction or a check
  against the letter date.
- Text extraction mangles numbers: `ABCDEFGH 0001` for `ABCDEFGH-0001` (made up here). Matching must compare
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

## Hibiscus (a bank via FinTS)

- Works: `hibiscus.xmlrpc.konto.find` and `hibiscus.xmlrpc.umsatz.list` over HTTPS with the
  master password; the certificate is pinned. Only the `konto` and `umsatz` services are shared.
- Plugins `jameica.webadmin`, `jameica.xmlrpc`, `hibiscus.xmlrpc` live in the repository
  "Plattform-Erweiterungen" (`…/jameica/updates/extensions`), not in the default one.
- The web server listens on all interfaces (`*:8080`) by default; `listener.http.address`
  restricts it. With the macOS firewall off it is reachable from the LAN (password-protected).
- One Hibiscus may hold private accounts too: filter by IBAN suffix before reading anything.
- Formats: `betrag` and `saldo` as German strings (`-12,34`), `datum`/`valuta` ISO. `gvcode` is
  empty; `art` carries the booking type (Basislastschrift, Überweisungsauftrag, Abschluss …).
- `zweck_raw` carries what matching needs: invoice numbers, customer numbers, `EREF`, `MREF`,
  `CRED` (creditor id) and the counterparty `IBAN`; `endtoendid` separately.

## Matching (first try, spikes/matching)

Score: amount 40, invoice number in the purpose text 50, customer number 20, vendor IBAN 15,
vendor name 20, date window 10; penalties for far-off dates and for incoming money.

- All business receipts with a bank booking in the sample matched, each with a clear lead.
- The invoice number decides where amount and vendor cannot: a subscription bills the same amount
  every month, and one month's invoice belongs to the next month's debit, while its direct-debit
  notice belongs to the debit a few days later.
- A shop paid by bank transfer matched through the customer number we put in the reference.
- A vendor paid by card from a second account has no right match on the main account: that
  side shows only the transfer to our own second account.
- Bookings that need no receipt are recognisable: own transfers (counterparty is our own
  company → neutral account 1360), bank fees (`Abschluss`, `Mehrwertsteuerbelastung`, receipt is
  the statement), a shareholder loan.
- Incoming payments name our outgoing invoice numbers ("Rechnung 2026-001", made up here): customers are
  matched from the Sent folder.
