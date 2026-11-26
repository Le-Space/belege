# @le-space/ledger

One booking format for Le Space's tools – [Belege](https://github.com/Le-Space/belege), the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI. Runs in a browser and in Node; no dependency.

- **`WalletEntry`** (`@le-space/ledger/wallet-entry`, a JSDoc type) – what a chain reader (`@le-space/chains`) hands out for one wallet: one entry per movement of value, signed from the wallet's side, the fee as an entry of its own.
- **`LedgerEntry`**, schema `le-space.ledger/1` – the same movement with its context (chain, network, own account) and a schema version, so it can stand on its own in a file or another program. `entry(fields)` checks one (type, kind, decimals, sign); `fromWalletEntry(entry, { chain, network, account, priceAs }, overrides?)` makes one from a reader's entry. Eigenbeleg's `eigenbeleg.ledger/1` has the same fields and is read as version 1.
- **Decimals, never floats** – `fromUnits` (alias `unitsToDecimal`), `toUnits`, `normalize`, `sum`, `multiply` (half away from zero), `round`.
- **Periods** – `sortEntries` (oldest first, a fee after its payment), `inPeriod`, `monthPeriod`, `derivedStatement` (balances before and after a period from today's balance less every movement since).
- **Network fees, grouped** (`@le-space/ledger/fee-groups`, new in 0.5.0) – `groupNetworkFees(entries, { by: 'wallet-month', min: 2, rate })`: a wallet's network fees (`type` and `kind` `fee`, no `purpose`) as one group per wallet (chain, network, account), month and asset, from two fees on. Each group has its `count`, the sum in the asset (`amount`), the sum in EUR (`eur`, when `rate(entry)` gives EUR per unit for every fee; each fee is valued at 6 places, only the total is rounded to cents), the member `ids` oldest first and the `first` and `last` time. Computed, never stored; `isNetworkFeeEntry` says what counts.
- **Bytes without Buffer** (`@le-space/ledger/bytes`) – `fromBase64` (as lenient as `Buffer.from`), `toBase64`, `fromHex`, `toHex`, `utf8`, `fromUtf8`.

Kinds: `transfer`, `fee`, `reward`, `stake`, `unstake`, `ibc`, `swap`, `call`, `storage`, `escrow`, `usage` (consumption from a prepaid balance, e.g. Aleph Cloud credits). An entry may carry a `unitPrice` where it has no market rate. A NEAR storage deposit (kind `storage`; in a `WalletEntry` type `fee`) carries `purpose: 'storage'`, whom it registered (`registration: { account, only?, tokens? }`) and what it was for: `partOf` the swap's hash, or `enables: { hash, kind: 'transfer' | 'receipt' }` the transfer or receipt it let happen; with neither it is a storage deposit of its own. Its transaction's gas carries the same `partOf` or `enables`. These fields are optional and new in 0.4.0; the meaning of no field changed. A change to the meaning of a field bumps the schema version.

```bash
pnpm --filter @le-space/ledger test   # Node, and the same scenario in Chromium
```

AGPL-3.0-or-later.
