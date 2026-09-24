# belege

Local-first bookkeeping helper: matches bank transactions (via [Hibiscus](https://github.com/willuhn/hibiscus)) with receipts from e-mail, folders and Telegram, and exports a monthly DATEV package. Runs in the browser; a small bridge on `127.0.0.1` does what a browser cannot (IMAP, Hibiscus XML-RPC, Telegram).

## Status: phase 1, step 1

The app lives in [`app/`](app/README.md): passkey identity, every record encrypted with a key from the passkey, stored locally in the browser (OrbitDB + Helia on IndexedDB). A navigation shell; bank import follows in step 2.

```bash
pnpm install
pnpm dev
pnpm lint && pnpm check && pnpm test:unit && pnpm test:e2e
```

## Phase 0 (feasibility spikes)

| Spike | Question | State |
|---|---|---|
| `spikes/hibiscus` | Can we read accounts and transactions from a local Hibiscus over XML-RPC? | script ready, waiting for Hibiscus |
| Revolut → Hibiscus | Does Revolut's CSV/CAMT export import into a Hibiscus offline account? | open |
| `spikes/imap` | Can the bridge list receipt mails, and what do their attachments look like? | done: works with a Mailu auth token; 1 month ≈ 420 mails, ≈ 5 % with a PDF, many PDFs sent as `application/octet-stream`; see `docs/phase-0.md` |
| LLM extraction | How well does DeepSeek extract amount, date, invoice number from real receipts? | open |
| DATEV → MonkeyOffice | Which EXTF fields and receipt links does MonkeyOffice import? | later |

```bash
pnpm install
read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
pnpm spike:hibiscus

cp .env.example .env   # fill in IMAP_*
pnpm spike:imap -- --month 2026-08 --accounting              # the accounting alias only
pnpm spike:imap -- --find Vodafone --amount 52,59 --around 2026-08-22   # one missing receipt
```
