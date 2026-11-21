# belege

[![Unit tests](https://github.com/Le-Space/belege/actions/workflows/unit.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/unit.yml?query=branch%3Amain)
[![E2E tests](https://github.com/Le-Space/belege/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/e2e.yml?query=branch%3Amain)
[![Bridge tests](https://github.com/Le-Space/belege/actions/workflows/bridge.yml/badge.svg?branch=main)](https://github.com/Le-Space/belege/actions/workflows/bridge.yml?query=branch%3Amain)
[![Release](https://img.shields.io/github/v/release/Le-Space/belege?label=Release)](https://github.com/Le-Space/belege/releases/latest)
[![Sponsor](https://img.shields.io/github/sponsors/Le-Space?label=Sponsor&logo=githubsponsors&color=EA4AAA)](https://github.com/sponsors/Le-Space)

Local-first pre-accounting for a small business: bank and crypto transactions matched with receipts, and a DATEV package every month. The books live on your devices and on those of the colleagues you admit, sealed with a passkey and synced peer-to-peer. No server holds a copy.

**Use it:** [belege.le-space.de](https://belege.le-space.de/) – the latest [release](https://github.com/Le-Space/belege/releases/latest). Still early: keep your statements and receipts somewhere else as well. What changed: [CHANGELOG.md](CHANGELOG.md).

## What makes it different

- **Local-first.** The app runs entirely in the browser. Every device holds a full copy of the books, each record and each receipt file sealed with keys derived from a passkey (WebAuthn PRF). There is no account and no backend; the app itself is static files served from IPFS.
- **Peer-to-peer.** Your devices and your team's replicate the books directly over libp2p and OrbitDB, end to end sealed, after a device proof. A relay only passes sealed data along; by QR code or through a relay in your own bridge, no server on the internet is asked at all.
- **Decentralised backup.** Optional, automatic and incremental: one sealed backup on Aleph Cloud, addressed by its content hash. The same passkey, a second one or 24 recovery words restore it into an empty browser. The storage provider cannot read it.
- **Your own bridge.** A browser cannot talk to a bank or a mailbox, so a small program does: on your own computer (`127.0.0.1`, secrets in the system keychain), or in a confidential VM whose attestation your browser checks before any secret goes in. Banks through Hibiscus (FinTS/HBCI), Enable Banking (PSD2, banks across Europe) or CAMT.053 files; the accounting mailbox over IMAP, read only.
- **Private AI, only on a click.** A local model through Ollama by default, so no receipt text leaves your computer – or a larger model in an attested enclave (TEE), checked before every request. A provider on the internet only by your choice, and then the text goes redacted.

## Where your data is, and who can read it

| What                          | Where                                                                  | Who can read it                                                         |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The books: bookings, receipts | Your devices, in the browser's storage, sealed record by record        | Whoever holds a passkey of the books; members you admitted              |
| What devices send each other  | From device to device; a relay passes it on unless they meet by QR     | The devices. A relay sees sealed bytes and that two peers talk          |
| The backup, if you make one   | Aleph Cloud (IPFS), one sealed file                                    | Only a passkey of the books or the recovery words. Its CID is public    |
| Passwords and API keys        | The bridge's system keychain. For a hosted bridge: sealed in the books | The bridge on your computer; a hosted bridge only after its attestation |
| Bank, mailbox, exchange       | Asked by the bridge directly                                           | Those services, as they always do                                       |
| Receipt text for the AI       | Your computer (Ollama), or an attested enclave, or a provider you pick | Local: nobody else. Enclave: the enclave. Provider: the redacted text   |

The long answer is the [threat model](docs/threat-model.md) ([Deutsch](docs/threat-model.de.md)); how the parts fit is in [architecture](docs/architecture.md).

## What is decentralised, and what is not

- **No server of ours holds or serves your books.** The app is published to IPFS by the release run and reached through DNSLink; the domain and its gateway are a convenience, not a dependency.
- **Relays are servers.** Le Space runs public ones; they forward sealed data and can be replaced by your bridge's relay or left out by QR.
- **Backup and the hosted bridge use Aleph Cloud**, a network of independent operators – by choice, paid in its credits.
- **Banks, mail providers and exchanges are what they are.** Enable Banking is a service in between; Hibiscus is the way without one.
- **Status.** The hosted bridge in a confidential VM is new and still changing. A security audit is planned in the open ([#209](https://github.com/Le-Space/belege/issues/209)); what was hardened is in the changelog. Weaknesses go to [SECURITY.md](SECURITY.md), not into an issue.

## What it does

- **Payments:** Hibiscus, Enable Banking, CAMT.053 statements; Kraken; own wallets on Nym (Nyx), Akash, Ethereum, Base, Arbitrum One, OP Mainnet, Polygon, Bitcoin, Filecoin, NEAR and Monero, in euros at the day's rate with its source.
- **Receipts:** the accounting mailbox, uploads, a folder, customer portals, Paperless-ngx; DKIM/SPF and scam checks; Eigenbelege.
- **Matching:** a score per pair, own transfers across accounts, chains and bridges, fees, refunds, vendor accounts; every link explains itself.
- **Export:** SKR 03 and BU keys, one DATEV ZIP per month with the receipts; crypto movements in the open, MIT-licensed [crypto-ledger format](schema/README.md).
- **Together:** the same books on phone and computer; members who write as themselves; a redacted read-only share with an end date.
- **German and English**, switched in the header; documents for German bookkeeping stay German.

All of it, with links: [docs/features.md](docs/features.md) ([Deutsch](docs/features.de.md)).

## Building blocks

What Belege is built from is usable on its own:

| Package                                                                                                                  | What it is                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [`@belege/device-gate`](packages/device-gate)                                                                            | Only the books' own devices get anything: a device proof as a libp2p service, a quiet identify |
| [`@le-space/bridge-protocol`](packages/bridge-protocol)                                                                  | The bridge's commands with their schemas, over a libp2p stream or HTTP; big answers as blocks  |
| [`@le-space/chains`](packages/chains)                                                                                    | Own wallets on public chains, read only, by address; Aleph and Filecoin Pay usage statements   |
| [`@le-space/ledger`](packages/ledger), [`@le-space/rates`](packages/rates)                                               | One booking format for chain readers, and the euro rate of a day with its source               |
| [`@le-space/eigenbeleg`](packages/eigenbeleg), [`@le-space/pdf`](packages/pdf)                                           | A payer's own receipt as PDF/A                                                                 |
| [`@le-space/ucep`](https://github.com/Le-Space/ucep-js)                                                                  | Extensions between peers: pairing, grants and calls over libp2p                                |
| [`@le-space/orbitdb-storage-bridge`](https://github.com/NiKrause/orbitdb-storage-bridge)                                 | OrbitDB databases backed up to and restored from decentralised storage                         |
| [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did) | A passkey as an OrbitDB identity                                                               |

The packages in this repository are AGPL-3.0-or-later; the crypto-ledger schema is MIT.

## Getting started

The app runs at [belege.le-space.de](https://belege.le-space.de/) or locally. Without the bridge you can already import CAMT.053 statements. Everything else goes through the bridge, which runs on your own computer, from a checkout of this repository:

```bash
pnpm install
pnpm bridge            # prints the pairing code; pair under Integrationen
```

Each source is set up once, in the terminal; secrets go into the macOS keychain, or on Windows the Credential Manager, by hidden prompt ([bridge/README.md](bridge/README.md)):

| Command                    | For                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:hibiscus`      | bank accounts from Hibiscus                                                                                                                                                               |
| `pnpm setup:enablebanking` | optional: banks through Enable Banking, your own application ([docs/banking.md](docs/banking.md))                                                                                         |
| `pnpm setup:mail`          | the accounting mailbox (IMAP)                                                                                                                                                             |
| `pnpm setup:llm`           | your own language model for reading receipts: by default Ollama on this computer ([docs/ollama.md](docs/ollama.md)); a provider on the internet only by choice ([docs/ai.md](docs/ai.md)) |
| `pnpm setup:portal <id>`   | optional: the login of a customer portal, e.g. `vodafone`                                                                                                                                 |
| `pnpm setup:kraken`        | Kraken, read only                                                                                                                                                                         |
| `pnpm setup:alchemy`       | optional: EVM wallets through Alchemy                                                                                                                                                     |
| `pnpm setup:bitcoin`       | a Bitcoin wallet by its extended public key (xpub, ypub, zpub)                                                                                                                            |
| `pnpm setup:coingecko`     | optional: a CoinGecko key for rates                                                                                                                                                       |
| `pnpm setup:relay`         | optional: a relay for your own devices in your own network                                                                                                                                |
| `pnpm setup:aleph`         | optional: the bridge's own key for the backup on Aleph Cloud                                                                                                                              |

Own Cosmos and EVM wallets are added in the app (_Integrationen → Eigene Wallets_) and need no setup.

**To try it, or for a demo, without any real data:** `pnpm demo` starts the bridge with a made-up bank account, a made-up mailbox with invoices as PDFs, and your local Ollama if it runs (else a fake model; `-- --fake-llm` forces it). Stop your own bridge first; the demo takes its port, keeps its configuration in a temporary folder and deletes it on Ctrl+C. Use a fresh browser profile and a new passkey for it.

## As a skill

Belege's integrations are also [Agent Skills](https://agentskills.io) for Claude Code, Codex, Gemini CLI and other agents that read `SKILL.md` ([eigenbeleg-agent#29](https://github.com/Le-Space/eigenbeleg-agent/issues/29)): [`skills/le-space-chains`](skills/le-space-chains/SKILL.md) reads own wallets by address with the shared `@le-space/*` packages, no key; [`skills/belege-bridge-setup`](skills/belege-bridge-setup/SKILL.md) installs, pairs and configures the bridge on the user's own machine, every secret through the bridge's hidden prompts and never through the chat; [`skills/belege-export`](skills/belege-export/SKILL.md) reads the DATEV package and the crypto-ledger files for the bookkeeping. In Claude Code, this repository is a plugin marketplace:

```bash
claude plugin marketplace add Le-Space/belege
```

```bash
claude plugin install belege@le-space-belege
```

Any other agent takes the folders under `skills/` into its skills directory. Each skill names every host it talks to and says what leaves the machine; `pnpm test:skills` holds every skill to the format, to the hosts the code itself asks, and to no key, token, mail address or real data.

## Development

```bash
pnpm dev               # the app on http://localhost:5173
pnpm lint && pnpm check && pnpm test:unit && pnpm test:bridge && pnpm test:e2e
```

Every push and pull request runs them as three workflows (unit, E2E, bridge), the badges above. A pull request runs only what its files can affect ([`scripts/ci-changes.mjs`](scripts/ci-changes.mjs): docs skip the browser specs, the bridge alone runs only the specs that pair a bridge), and the browser specs run in shards side by side; a push to `main` runs everything, and a release runs all three again, in full, before anything is published.

The app is in [`app/`](app/README.md), the bridge in [`bridge/`](bridge/README.md). A release deploys to belege.le-space.de ([docs/deploy.md](docs/deploy.md)).

## Docs

- [Ways to use Belege: only the browser, with the bridge, several devices, the phone](docs/use-cases.md) ([Deutsch](docs/use-cases.de.md))
- [Architecture: how Belege keeps working when the network does not](docs/architecture.md) ([Deutsch](docs/architecture.de.md))
- [Features](docs/features.md) ([Deutsch](docs/features.de.md))
- [Matching: fiscal years, refunds, vendor accounts](docs/matching.md) ([Deutsch](docs/matching.de.md))
- [AI](docs/ai.md) ([Deutsch](docs/ai.de.md))
- [Reading receipts with Ollama, on your own computer](docs/ollama.md) ([Deutsch](docs/ollama.de.md))
- [Bank accounts: statement files, Hibiscus, Enable Banking](docs/banking.md) ([Deutsch](docs/banking.de.md))
- [Accounts and DATEV export](docs/export.md) ([Deutsch](docs/export.de.md))
- [Crypto](docs/crypto.md) ([Deutsch](docs/crypto.de.md))
- [Private outlays](docs/outlays.md) ([Deutsch](docs/outlays.de.md))
- [Travel expenses](docs/travel.md) ([Deutsch](docs/travel.de.md))
- [Keys and recovery: what a lost passkey means](docs/keys.md) ([Deutsch](docs/keys.de.md))
- [Device proof: only own devices get the books](docs/device-proof.md) ([Deutsch](docs/device-proof.de.md))
- [Backup on Aleph Cloud, and what leaves the device](docs/backup.md) ([Deutsch](docs/backup.de.md))
- [What Belege protects against, and what not](docs/threat-model.md) ([Deutsch](docs/threat-model.de.md))
- [The security audit: what was checked, and the result](docs/security-audit.md) ([Deutsch](docs/security-audit.de.md))
- [Performance](docs/performance.md) ([Deutsch](docs/performance.de.md))
- [Resilience, measured](docs/resilience-report.md) ([Deutsch](docs/resilience.de.md))
- [Phase 0: the feasibility spikes](docs/phase-0.md)

## License

Belege (app and bridge) is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE):
use it, change it and run it yourself; whoever offers a changed version as a service to others
must publish their changes too.

The portal recipes in [`bridge/src/portals/recipes/`](bridge/src/portals/recipes/) are
[MIT-licensed](bridge/src/portals/recipes/LICENSE), so they can be reused in any tool, open or not.

**The skill texts** ([`skills/*/SKILL.md`](skills/)) are prose, not software, and are under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) instead: copy them, change them, put them
into your own skills or directories, as long as you name Le Space as the source
([`skills/LICENSE.md`](skills/LICENSE.md)). Each one says so in its `license` line. The tests under
`skills/test` and everything the skills point at stay under the AGPL.
