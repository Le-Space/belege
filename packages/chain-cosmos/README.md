# @belege/chain-cosmos

A Cosmos wallet, read only, by its address – as neutral `WalletEntry` records (`@belege/chain-core`). Two chains are described: Nym's Nyx (`NYX_CHAIN`) and Akash (`AKASH_CHAIN`), with their denoms, default endpoints and explorers (`src/chains.js`).

- `createCosmosClient({ fetch, timeoutMs?, sleep? }).history({ chain, address, endpoints })` – CometBFT RPC (`tx_search`, `header`, `status`) and the REST balance: sends, receipts, staking rewards and delegations, IBC transfers, the fee as an entry of its own; entries, balances, the address's explorer link.
- `createAkashConsoleClient` – Akash's history older than a pruned node's window, from the Akash Console indexer.
- `createAkashDeploymentsClient` – an Akash wallet's deployments and what each paid its providers.
- `isCosmosAddress`, `bech32Encode`, `bech32Decode`, `moduleAddress`; `decodeTx` / `encodeTx` (the protobuf a node returns).
- `@belege/chain-cosmos/testing` – a fake Cosmos node and a fake Akash Console, with made-up addresses, hashes and amounts.

The node operators named in `src/chains.js` (Nym, PublicNode, the Akash Console) see the address and the IP of the machine that asks; Belege's consent screen says so. The bridge reads Cosmos chains through this package (`bridge/src/chains/index.js`).

```bash
pnpm --filter @belege/chain-cosmos test
```
