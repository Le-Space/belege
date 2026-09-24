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
