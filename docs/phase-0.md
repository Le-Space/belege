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
