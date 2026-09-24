# belege

Local-first bookkeeping helper: matches bank transactions (via [Hibiscus](https://github.com/willuhn/hibiscus)) with receipts from e-mail, folders and Telegram, and exports a monthly DATEV package. Runs in the browser; a small bridge on `127.0.0.1` does what a browser cannot (IMAP, Hibiscus XML-RPC, Telegram).

## Status: phase 1, step 3

The app lives in [`app/`](app/README.md): passkey identity, every record encrypted with a key from the passkey, stored locally in the browser (OrbitDB + Helia on IndexedDB). Step 2 added bank transactions: the [bridge](bridge/README.md) on `127.0.0.1` reads the allowed accounts from Hibiscus, the app lists them under Zahlungen; CAMT.053 statements (Revolut) import in the browser. Step 3 adds receipts: the bridge reads the mails to the accounting address over IMAP (read-only), the app takes uploads and a shared folder too, seals every file before it is stored, and "Auslesen" sends the PDF's text – redacted by the bridge – to an LLM (DeepSeek) for vendor, amount, date and invoice number. Mails whose sender fails DKIM/SPF wait for a confirmation. Matching receipts to transactions comes next. Gaps: no OCR for images yet, HTML-only invoices and portal downloads (see [app/README.md](app/README.md#gaps)).

```bash
pnpm install
pnpm dev
pnpm setup:hibiscus && pnpm setup:mail && pnpm setup:llm && pnpm bridge   # see bridge/README.md
pnpm lint && pnpm check && pnpm test:unit && pnpm test:bridge && pnpm test:e2e
```

## Phase 0 (feasibility spikes)

| Spike | Question | State |
|---|---|---|
| `spikes/hibiscus` | Can we read accounts and transactions from a local Hibiscus over XML-RPC? | script ready, waiting for Hibiscus |
| Revolut → Hibiscus | Does Revolut's CSV/CAMT export import into a Hibiscus offline account? | open |
| `spikes/imap` | Can the bridge list receipt mails, and what do their attachments look like? | done: works with a Mailu auth token; 1 month ≈ 420 mails, ≈ 5 % with a PDF, many PDFs sent as `application/octet-stream`; see `docs/phase-0.md` |
| LLM extraction | How well does DeepSeek extract amount, date, invoice number from real receipts? | done: 12 real PDFs, both models right on vendor, gross, currency; flash with v4-pro as retry; see `docs/phase-0.md` |
| DATEV → MonkeyOffice | Which EXTF fields and receipt links does MonkeyOffice import? | later |

```bash
pnpm install
read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
pnpm spike:hibiscus

cp .env.example .env   # fill in IMAP_*
pnpm spike:imap -- --month 2026-08 --accounting              # the accounting alias only
pnpm spike:imap -- --find Vodafone --amount 52,59 --around 2026-08-22   # one missing receipt
```
