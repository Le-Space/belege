# @le-space/ledger

One booking format for Le Space's tools – [Belege](https://github.com/Le-Space/belege), the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI. Runs in a browser and in Node; no dependency.

- **`WalletEntry`** (`@le-space/ledger/wallet-entry`, a JSDoc type) – what a chain reader (`@le-space/chains`) hands out for one wallet: one entry per movement of value, signed from the wallet's side, the fee as an entry of its own.
- **`LedgerEntry`**, schema `le-space.ledger/1` – the same movement with its context (chain, network, own account) and a schema version, so it can stand on its own in a file or another program. `entry(fields)` checks one (type, kind, decimals, sign); `fromWalletEntry(entry, { chain, network, account, priceAs }, overrides?)` makes one from a reader's entry. Eigenbeleg's `eigenbeleg.ledger/1` has the same fields and is read as version 1.
- **Decimals, never floats** – `fromUnits` (alias `unitsToDecimal`), `toUnits`, `normalize`, `sum`, `multiply` (half away from zero), `round`.
- **Periods** – `sortEntries` (oldest first, a fee after its payment), `inPeriod`, `monthPeriod`, `derivedStatement` (balances before and after a period from today's balance less every movement since).
- **Bytes without Buffer** (`@le-space/ledger/bytes`) – `fromBase64` (as lenient as `Buffer.from`), `toBase64`, `fromHex`, `toHex`, `utf8`, `fromUtf8`.

Kinds: `transfer`, `fee`, `reward`, `stake`, `unstake`, `ibc`, `swap`, `call`, `storage`, `escrow`. A change to the meaning of a field bumps the schema version.

```bash
pnpm --filter @le-space/ledger test   # Node, and the same scenario in Chromium
```

AGPL-3.0-or-later.
