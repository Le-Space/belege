# @le-space/chains

Own wallets on public chains, read only, by their address – for [Belege](https://github.com/Le-Space/belege) (its bridge) and the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI. Every reader hands out [`@le-space/ledger`](../ledger) entries: one per movement of value, signed from the wallet's side, the fee as an entry of its own.

Runs in a browser and in Node. The caller hands in `fetch`, the endpoints (a node, an indexer, a proxy) and the keys (an Alchemy key, a NearBlocks key, a Bitcoin zpub/xpub); nothing is read from disk, a keychain or the environment. A browser can read the keyless chains itself where the source allows CORS (or behind a proxy).

| Chain | Source | Module |
| --- | --- | --- |
| Nym (Nyx), Akash (Cosmos SDK) | CometBFT RPC + REST; Akash's older history from the Akash Console indexer; Akash deployments | `cosmos`, `akash-console`, `akash-deployments`, `bech32`, `protobuf` |
| Akash as `LedgerEntry` (`readAkash`, `statementAkash`: the fee to the network, escrow its own kind) | the Cosmos reader and the Akash Console indexer | `akash` |
| Ethereum, Base, Arbitrum One, OP Mainnet, Polygon PoS (USDC listed; ALEPH on Ethereum and Base) | Blockscout, or Alchemy with a key; `evmReader(chain)` gives `LedgerEntry` through Alchemy (the key handed to each read) | `evm`, `alchemy` |
| Bitcoin | Esplora; addresses derived from a zpub/ypub/xpub | `bitcoin` |
| Filecoin | Filfox; `readFilecoin`/`statementFilecoin` give `LedgerEntry` | `filecoin` |
| NEAR | NearBlocks + an archival RPC (from Eigenbeleg); gives `LedgerEntry` | `near` |
| Aleph Cloud credits (no chain: Aleph's own network, by the Ethereum address) | Aleph's API, CORS open; a month's statement, `alephEntries` gives `LedgerEntry` (`usage` for consumption, with its USD price per credit) | `aleph` |

- `createWalletService({ fetch, getZpub, alchemyKey, … })` – every chain behind one `history({ chain, address, endpoints })`, as Belege's bridge serves it.
- `CHAINS`, `chainOf`, `publicChains` – the chains, their assets, default endpoints and explorers (`registry`). One chain's data without the others: `FILECOIN` (`filecoin-chain`), `NYX_CHAIN`, `AKASH_CHAIN` (`cosmos-chains`), `KNOWN_EVM_CONTRACTS` (`evm-contracts`). The readers take their chain as an argument and do not import the registry.
- The `LedgerEntry` readers (`near`, `akash`, `filecoin`, `evmReader`, `aleph`) each give `read…`/`statement…` for a period (`statement`: the entries and the balances before and after, `method: 'archive'` on NEAR, `'derived'` from today's balance elsewhere), `probe` as a live check against public data, `isAddress`, and for Aleph `purchaseEntries`: the payment behind each credit purchase. From the Eigenbeleg agent's pipeline readers; its blocks are built on them.
- `toChecksumAddress`, `isEvmAddress` – an EVM address's EIP-55 checksum and form (`evm-address`: keccak and bytes only, so `aleph` and a browser form do not bundle the EVM reader or Alchemy; `evm` re-exports them).
- `createJsonFetcher`, `WalletError`, `checkEndpoint`, `txUrl`, `addressUrl`, `markSwaps` – what every reader shares (`core`). Error messages name a host at most, never a path or a query (they carry addresses).
- Fakes for tests, with made-up addresses, hashes, keys and amounts:
  - `@le-space/chains/testing/cosmos`, `testing/filfox`, `testing/blockscout`, `testing/alchemy` – fake nodes on 127.0.0.1 (Node). The fake Alchemy is as strict as the real one about what it is asked; `blockscoutView` turns its made-up chain into what the fake Blockscout serves, so one history reads through both.
  - `@le-space/chains/testing/aleph` – a fake Aleph API as a `fetch` function (Node and browser), and a made-up account and month (`ACCOUNT`, `sampleRows`, `sampleBalance`, `flatUsd`).

Each source sees the address and the IP address of the machine that asks; Belege's consent screen says so.

```bash
pnpm --filter @le-space/chains test   # Node, and a scenario in Chromium (no Buffer, no node:)
```

The files came from Belege's `bridge/src/chains/` and `packages/chain-{core,cosmos,filecoin}` (moved with their history) and from Eigenbeleg's `packages/chain-near` at e56769a. AGPL-3.0-or-later.
