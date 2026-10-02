# belege

[![Unit tests](https://github.com/Le-Space/belege/actions/workflows/unit.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/unit.yml?query=branch%3Amain)
[![E2E tests](https://github.com/Le-Space/belege/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/e2e.yml?query=branch%3Amain)
[![Bridge tests](https://github.com/Le-Space/belege/actions/workflows/bridge.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/bridge.yml?query=branch%3Amain)
[![Release](https://img.shields.io/github/v/release/Le-Space/belege?label=Release)](https://github.com/Le-Space/belege/releases/latest)
[![Sponsor](https://img.shields.io/github/sponsors/Le-Space?label=Sponsor&logo=githubsponsors&color=EA4AAA)](https://github.com/sponsors/Le-Space)

Local-first pre-accounting for a small business: matches bank and crypto transactions with receipts from the accounting mailbox, uploads, a folder and customer portals, and exports a monthly DATEV package. The books live encrypted in the browser, under a passkey. A small bridge on `127.0.0.1` does what a browser cannot: Hibiscus, IMAP, the language model, customer portals, exchanges and wallets.

**Use it:** [belege.le-space.de](https://belege.le-space.de/) – the latest [release](https://github.com/Le-Space/belege/releases/latest). Still early: keep your statements and receipts somewhere else as well. What changed: [CHANGELOG.md](CHANGELOG.md).

## Features

- **Privacy:** passkey instead of a password, everything sealed with keys from it, the books only in the browser; the network paused or switched part by part from the header.
- **Payments:** Hibiscus through the bridge, CAMT.053 statements, one fiscal year at a time, private payments settled.
- **Receipts:** accounting mailbox, uploads, a folder, customer portals (recorded once); DKIM/SPF and scam checks; Eigenbelege.
- **Matching:** a score, own transfers (across accounts, chains and bridges), bank fees, refunds, vendor accounts, learning from your links.
- **AI, only on a click (✦):** your own model in the bridge, redacted; five places, usage and cost in view.
- **Crypto:** Kraken, Cosmos, EVM, Bitcoin and Filecoin wallets; euros at the day's rate with its source (CoinGecko, Kraken, ECB, Uniswap V2–V4 pools, trade, migration, by hand); swaps and migrations.
- **Export:** SKR 03 and BU keys, a monthly DATEV EXTF ZIP for MonkeyOffice with the receipts.
- **Devices:** the same books on phone and computer after a passkey proof, over public relays, a relay in your own bridge, or by QR without any relay (a new device only over the own network, if you like); the computer's bridge for the phone; the invoicing app over UCEP.
- **German and English:** switched in the header; documents for German bookkeeping stay German.

All of it, with links: [docs/features.md](docs/features.md) ([Deutsch](docs/features.de.md)).

## Getting started

The app runs at [belege.le-space.de](https://belege.le-space.de/) or locally. Without the bridge you can already import CAMT.053 statements. Everything else goes through the bridge, which runs on your own computer, from a checkout of this repository:

```bash
pnpm install
pnpm bridge            # prints the pairing code; pair under Integrationen
```

Each source is set up once, in the terminal; secrets go into the macOS keychain, or on Windows the Credential Manager, by hidden prompt ([bridge/README.md](bridge/README.md)):

| Command                    | For                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm setup:hibiscus`      | bank accounts from Hibiscus                                                                       |
| `pnpm setup:enablebanking` | optional: banks through Enable Banking, your own application ([docs/banking.md](docs/banking.md)) |
| `pnpm setup:mail`          | the accounting mailbox (IMAP)                                                                     |
| `pnpm setup:llm`           | your own language model for reading receipts ([docs/ai.md](docs/ai.md))                           |
| `pnpm setup:portal <id>`   | optional: the login of a customer portal, e.g. `vodafone`                                         |
| `pnpm setup:kraken`        | Kraken, read only                                                                                 |
| `pnpm setup:alchemy`       | optional: EVM wallets through Alchemy                                                             |
| `pnpm setup:bitcoin`       | a Bitcoin wallet by its extended public key (xpub, ypub, zpub)                                    |
| `pnpm setup:coingecko`     | optional: a CoinGecko key for rates                                                               |
| `pnpm setup:relay`         | optional: a relay for your own devices in your own network                                        |
| `pnpm setup:aleph`         | optional: the bridge's own key for the backup on Aleph Cloud                                      |

Own Cosmos and EVM wallets are added in the app (_Integrationen → Eigene Wallets_) and need no setup.

## Development

```bash
pnpm dev               # the app on http://localhost:5173
pnpm lint && pnpm check && pnpm test:unit && pnpm test:bridge && pnpm test:e2e
```

Every push and pull request runs them as three workflows (unit, E2E, bridge), the badges above; a release runs all three again before anything is published.

The app is in [`app/`](app/README.md), the bridge in [`bridge/`](bridge/README.md). A release deploys to belege.le-space.de ([docs/deploy.md](docs/deploy.md)).

## Docs

- [Features](docs/features.md) ([Deutsch](docs/features.de.md))
- [Matching: fiscal years, refunds, vendor accounts](docs/matching.md) ([Deutsch](docs/matching.de.md))
- [AI](docs/ai.md) ([Deutsch](docs/ai.de.md))
- [Bank accounts: statement files, Hibiscus, Enable Banking](docs/banking.md) ([Deutsch](docs/banking.de.md))
- [Accounts and DATEV export](docs/export.md) ([Deutsch](docs/export.de.md))
- [Crypto](docs/crypto.md) ([Deutsch](docs/crypto.de.md))
- [Performance](docs/performance.md) ([Deutsch](docs/performance.de.md))
- [Phase 0: the feasibility spikes](docs/phase-0.md)

## License

Belege (app and bridge) is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE):
use it, change it and run it yourself; whoever offers a changed version as a service to others
must publish their changes too.

The portal recipes in [`bridge/src/portals/recipes/`](bridge/src/portals/recipes/) are
[MIT-licensed](bridge/src/portals/recipes/LICENSE), so they can be reused in any tool, open or not.
