# @belege/chain-core

What every chain reader in Belege shares (#264):

- `createJsonFetcher`, `WalletError`, `checkEndpoint`, `hostOf` – JSON over HTTPS with a timeout, a few retries and errors that carry a code; error messages name the host at most, never a path or a query (they carry addresses).
- `unitsToDecimal` – a chain's smallest units as a signed decimal string.
- `txUrl`, `addressUrl` – links into a block explorer from its URL templates.
- `markSwaps` – a transaction that gives one asset and gets another becomes a swap.
- `WalletEntry` (`@belege/chain-core/entry`) – the neutral record a reader hands out: one per value movement, signed from the wallet's side, the fee as an entry of its own.

The bridge's readers (`bridge/src/chains/`), `@belege/chain-cosmos` and `@belege/chain-filecoin` use it. It has no dependency.

```bash
pnpm --filter @belege/chain-core test
```
