# belege

Local-first bookkeeping helper: matches bank transactions (via [Hibiscus](https://github.com/willuhn/hibiscus)) with receipts from e-mail, folders and Telegram, and exports a monthly DATEV package. Runs in the browser; a small bridge on `127.0.0.1` does what a browser cannot (IMAP, Hibiscus XML-RPC, Telegram).

## Status: phase 0 (feasibility spikes)

| Spike | Question | State |
|---|---|---|
| `spikes/hibiscus` | Can we read accounts and transactions from a local Hibiscus over XML-RPC? | script ready, waiting for Hibiscus |
| Revolut → Hibiscus | Does Revolut's CSV/CAMT export import into a Hibiscus offline account? | open |
| `spikes/imap` | Can the bridge list receipt mails, and what do their attachments look like? | script ready, waiting for `.env` |
| LLM extraction | How well does DeepSeek extract amount, date, invoice number from real receipts? | open |
| DATEV → MonkeyOffice | Which EXTF fields and receipt links does MonkeyOffice import? | later |

```bash
pnpm install
read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
pnpm spike:hibiscus

cp .env.example .env   # fill in IMAP_*
pnpm spike:imap
```
