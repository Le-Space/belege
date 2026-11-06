# @belege/chain-filecoin

A Filecoin wallet, read only, by its address, through Filfox's public API (no key) – as neutral `WalletEntry` records (`@belege/chain-core`). FIL, and the FEVM tokens and contracts listed in `FILECOIN` (`src/chain.js`); a swap is named after its router where the router is listed.

- `FILECOIN` – the chain's description: assets, tokens, contracts, default API, explorer.
- `createFilecoinClient({ fetch, timeoutMs?, sleep? }).history({ chain, address, endpoints })` – entries, balances, the address's explorer link.
- `isFilecoinAddress`, `toFilecoinAddress` – f1/f3/f410f by their blake2b checksum, f0 as it is; `0x…` read as its f410f form.
- `normalizeFilecoin`, `normalizeFilecoinTokens` – Filfox's transfers → entries.
- `@belege/chain-filecoin/testing` – a fake Filfox for tests, with made-up addresses and message CIDs.

Filfox sees the address and the IP of the machine that asks; Belege's consent screen says so. The bridge reads Filecoin through this package (`bridge/src/chains/index.js`).

```bash
pnpm --filter @belege/chain-filecoin test
```
