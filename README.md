# belege

[![Sponsor](https://img.shields.io/github/sponsors/Le-Space?label=Sponsor&logo=githubsponsors&color=EA4AAA)](https://github.com/sponsors/Le-Space)

Local-first bookkeeping helper: matches bank transactions (via [Hibiscus](https://github.com/willuhn/hibiscus)) with receipts from e-mail, folders and Telegram, and exports a monthly DATEV package. Runs in the browser; a small bridge on `127.0.0.1` does what a browser cannot (IMAP, Hibiscus XML-RPC, Telegram).

## Status: phase 1, step 4

The app lives in [`app/`](app/README.md): passkey identity, every record encrypted with a key from the passkey, stored locally in the browser (OrbitDB + Helia on IndexedDB). Step 2 added bank transactions: the [bridge](bridge/README.md) on `127.0.0.1` reads the allowed accounts from Hibiscus, the app lists them under Zahlungen; CAMT.053 statements (Revolut) import in the browser. Step 3 adds receipts: the bridge reads the mails to the accounting address over IMAP (read-only), the app takes uploads and a shared folder too, seals every file before it is stored, and "Auslesen" sends the PDF's text – redacted by the bridge – to an LLM (DeepSeek) for vendor, amount, date and invoice number. Mails whose sender fails DKIM/SPF wait for a confirmation. Step 4 matches receipts to transactions: a score from amount, invoice and customer number, IBAN, vendor and date; sure pairs are linked, the rest become questions on Home; own transfers, bank fees, loans and your own rules need no receipt; a missing receipt can be searched for in the private mailbox from the booking (only the hits are read). Invoices from a customer portal (Vodafone MeinKabel first) come through a browser the bridge starts on this Mac ([Kundenportale](bridge/README.md#kundenportale)). See [CHANGELOG.md](CHANGELOG.md). Gaps: no OCR for images yet, HTML-only invoices and other portals (see [app/README.md](app/README.md#gaps)).

```bash
pnpm install
pnpm dev
pnpm setup:hibiscus && pnpm setup:mail && pnpm setup:llm && pnpm bridge   # see bridge/README.md
pnpm setup:portal vodafone   # optional: Vodafone MeinKabel invoices, see bridge/README.md#kundenportale
pnpm lint && pnpm check && pnpm test:unit && pnpm test:bridge && pnpm test:e2e
```

## AI

Belege uses a language model in three places, each only on a click of a button marked **✦**: reading a receipt's text (vendor, amounts, dates, numbers), _Mit KI weitersuchen_ in the private mailbox (search words, then a pick from the hits' subjects, sender domains and file names), and _KI-Vorschlag_ under _Beleg zuordnen_ (a pick among receipts by their read fields; the person links). Matching, questions, transfers, fees, learning and the portals run on fixed rules. **Le Space runs no AI:** each installation sets up its own model in the bridge, a public one such as DeepSeek or a local one such as Ollama, and everything sent is redacted first. Details: [docs/ai.md](docs/ai.md) ([Deutsch](docs/ai.de.md)).

## Accounts and DATEV export

Every booking gets an SKR 03 account and a BU key: suggested (own transfer, bank fee, learned per vendor, VAT from the receipt), confirmed by you. Once a month, _Export_ makes a ZIP in the browser: a DATEV Buchungsstapel (EXTF) for MonkeyOffice and the receipts as PDFs. How to import it and what to check with the tax adviser: [docs/export.md](docs/export.md) ([Deutsch](docs/export.de.md)).

## Crypto assets

Exchanges and wallets are on their way as accounts: one account per asset, every crypto booking in euros with the exact quantity, the rate of its day and the rate's source kept next to it. The foundation (quantities, rates through the bridge, the Buchungstext) is described in [docs/crypto.md](docs/crypto.md) ([Deutsch](docs/crypto.de.md)); Kraken is the first connector.

## Phase 0 (feasibility spikes)

| Spike                | Question                                                                        | State                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `spikes/hibiscus`    | Can we read accounts and transactions from a local Hibiscus over XML-RPC?       | script ready, waiting for Hibiscus                                                                                                              |
| Revolut → Hibiscus   | Does Revolut's CSV/CAMT export import into a Hibiscus offline account?          | open                                                                                                                                            |
| `spikes/imap`        | Can the bridge list receipt mails, and what do their attachments look like?     | done: works with a Mailu auth token; 1 month ≈ 420 mails, ≈ 5 % with a PDF, many PDFs sent as `application/octet-stream`; see `docs/phase-0.md` |
| LLM extraction       | How well does DeepSeek extract amount, date, invoice number from real receipts? | done: 12 real PDFs, both models right on vendor, gross, currency; flash with v4-pro as retry; see `docs/phase-0.md`                             |
| DATEV → MonkeyOffice | Which EXTF fields and receipt links does MonkeyOffice import?                   | later                                                                                                                                           |

```bash
pnpm install
read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
pnpm spike:hibiscus

cp .env.example .env   # fill in IMAP_*
pnpm spike:imap -- --month 2026-08 --accounting              # the accounting alias only
pnpm spike:imap -- --find Vodafone --amount 52,59 --around 2026-08-22   # one missing receipt
```

## License

Belege (app and bridge) is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE):
use it, change it and run it yourself; whoever offers a changed version as a service to others
must publish their changes too.

The portal recipes in [`bridge/src/portals/recipes/`](bridge/src/portals/recipes/) are
[MIT-licensed](bridge/src/portals/recipes/LICENSE), so they can be reused in any tool, open or not.
