# Crypto assets: quantities, rates, bookings

_Deutsch: [crypto.de.md](crypto.de.md)_

Belege keeps accounts on exchanges (Kraken) and own wallets on blockchains (Cosmos, EVM; Bitcoin later). This page describes what they share, the Kraken connector and the wallets.

## One account per asset

A crypto account holds exactly one asset: _Kraken BTC_, _Kraken EUR_ and _Wallet NYM_ are three accounts, each with its own ledger account in MonkeyOffice. The assets Belege knows are listed in `app/src/lib/assets/registry.js`: symbol, name, decimals and, where it is certain, the chain-agnostic CAIP-19 id.

## A crypto transaction is booked in euros and keeps what moved

Belege books in EUR cents, as it does for the bank accounts: `amountCents` is what the movement was worth on its day. Next to it, the transaction keeps:

| Field       | Example                                                                               | Meaning                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `asset`     | `BTC`                                                                                 | the symbol                                                                                                                         |
| `quantity`  | `"-1500000"`                                                                          | the signed amount in the smallest unit (here satoshi: −0.015 BTC), as a string, because 18-decimal tokens do not fit into a double |
| `decimals`  | `8`                                                                                   | the asset's decimals, so the record explains itself                                                                                |
| `movement`  | `transfer`                                                                            | `transfer`, `trade`, `fee`, `reward` or `stake`                                                                                    |
| `txRef`     | `…`                                                                                   | the transaction hash or the exchange's reference                                                                                   |
| `valuation` | `{ rate: "60000", currency: "EUR", source: "coingecko", at: "2026-09-01T00:00:00Z" }` | EUR per whole unit, where the rate came from and for which moment                                                                  |

`quantity` × `rate` gives `amountCents`, computed in integers and rounded once, half away from zero (`app/src/lib/assets/quantity.js`). Nothing about a crypto amount goes through a floating-point number.

## The rate of a day

The bridge answers `GET /rates?asset=BTC&date=2026-09-01` (`bridge/src/rates.js`). The browser cannot ask the sources itself (CORS), and an optional CoinGecko key stays in the keychain. The rate is always the value of one unit **at 00:00 UTC of that day**:

1. **CoinGecko**, its daily snapshot (`/coins/{id}/history`);
2. failing that, **Kraken**, the open price of the day's daily candle;

   for a booking **on Kraken** (`prefer=kraken`) the order turns: Kraken's own EUR price first, CoinGecko as the fallback. Kraken then also prices assets Belege does not list yet, by their `<SYMBOL>EUR` pair;

3. for **USD**: the **ECB reference rate** of the day, or the last one before it (weekends, holidays), inverted to EUR per USD.

The request names an asset and a day, nothing about the bookings. Past days are cached in memory. With a CoinGecko demo key in the keychain (account `coingecko`), it is sent as a header.

**Which rate and which valuation method apply is the tax adviser's call.** This includes the accounts for crypto holdings, gains and losses on exchange rates, FIFO or average cost, and valuation at the end of the year. Belege records the rate and its source on every booking, so a different decision can be applied later.

## Kraken

**Set up** (once): on kraken.com create an API key with only **Query Funds** and **Query Ledger Entries**. Then run `pnpm setup:kraken` and paste the API key and the private key into the hidden prompts. If `KRAKEN_API_KEY` and `KRAKEN_PRIVATE_KEY` are in `.env`, the setup offers to take them from there. The key goes into the macOS keychain (account `kraken`), and a test call prints how many assets have a balance, never an amount. Restart the bridge. An optional CoinGecko demo key is set up the same way with `pnpm setup:coingecko` (`COINGECKO_API_KEY`).

**Sync**: _Integrationen → Kraken (Börse) → Kraken synchronisieren_. The bridge reads the ledger (`GET /kraken/ledgers`, paged by `ofs`, 50 entries a page, with a pause and retries on Kraken's rate limit) and the balances (`GET /kraken/balances`). The first sync starts on 1 January; later ones start a week before the last.

**Accounts**: one per asset and wallet: _Kraken EUR_, _Kraken BTC_, _Kraken BTC (Earn)_ for staked or earning balances (Kraken's `.S`, `.M`, … assets). Each needs its ledger account in MonkeyOffice like a bank account (_Eigene Anweisungen_).

**Bookings**: one per ledger entry, plus one for each fee Kraken charged on it (so the fee is visible and booked on 4970).

| Entry                                                | Euro amount                                                                     | Recognised as                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EUR deposit / withdrawal                             | the amount                                                                      | own transfer with the bank booking of the same amount within 4 days (sign: _Kraken_)                                                                     |
| buy or sell against EUR (`trade`, `spend`/`receive`) | the crypto leg is worth exactly what was paid or received (rate source `trade`) | own transfer between the two Kraken accounts (same reference)                                                                                            |
| crypto against crypto                                | the outgoing leg at the day's rate, the incoming leg mirrors it                 | own transfer (same reference)                                                                                                                            |
| spot ↔ earn                                         | the day's rate, both legs                                                       | own transfer (same reference)                                                                                                                            |
| staking / earn reward                                | the day's rate                                                                  | _Ertrag der Börse_: no receipt needed; the account is for the tax adviser to decide                                                                      |
| fee                                                  | at the rate of its entry                                                        | exchange fee, 4970                                                                                                                                       |
| crypto deposit / withdrawal                          | the day's rate                                                                  | own transfer with the wallet booking that has the same transaction hash (Kraken's `txid` from DepositStatus / WithdrawStatus), whatever the euro amounts |

**Labels** follow Kraken's type and subtype: only `spottostaking`, `stakingfromspot` and their like are _Umbuchung Spot/Earn_, `spottofutures`/`spotfromfutures` _Umbuchung Spot/Futures_. A subtype Belege does not know is shown as Kraken writes it (`Kraken: transfer/…`), never guessed. The payment detail shows Kraken's type, the reference and the transaction hash, and lists the other bookings with the same reference (_Gehört zusammen mit_).

Two sides paired by reference but valued apart (a Kraken withdrawal and the wallet that received it, on different days) are exported each against 1360, so the difference in value stays visible there.

An entry whose rate cannot be found is left out with the rest of its trade, listed after the sync, and fetched again next time.

**Not decided here**: gains and losses when crypto is sold (acquisition cost by FIFO or average) and the year-end valuation. Every booking keeps quantity, rate and source, so the tax adviser's method can be applied to it.

## Own wallets

Tokens withdrawn from an exchange to a wallet of our own stay the company's. _Integrationen → Eigene Wallets_ adds such a wallet by **chain and address**: read only, never a key or a seed phrase. The list of wallets is kept sealed in the books (settings key `wallets`); the bridge keeps nothing about them.

**Chains**: Nym (Nyx) and Akash (Cosmos SDK), Ethereum, Base, Arbitrum One, OP Mainnet and Polygon PoS (EVM). The table is `bridge/src/chains/registry.js`; the app's names for them are in `app/src/lib/wallets/chains.js`.

**Sync** (_Synchronisieren_, per wallet): the app sends the address in the body of `POST /<chain>/wallet` to the bridge, and the bridge asks a public node (see below; a wallet may name its own https endpoint instead). It reads the whole history each time; what is known is skipped.

- **Cosmos**: CometBFT RPC `tx_search` for `transfer.sender='<address>'` and `transfer.recipient='<address>'` (every balance change of the bank module is a `transfer` event, the fee included), 100 a page, oldest first, merged by hash; `header` for each block's time; `status` for the oldest block the node still has; REST `/cosmos/bank/v1beta1/balances/<address>` for the balance; the memo from the transaction's bytes.
- **EVM**: Blockscout's Etherscan-compatible API, no key: `txlist`, `txlistinternal`, `tokentx`, `balance`, `tokenbalance`. Paged by start block past Blockscout's 10 000-entry window, with retries on its rate limit.

**Accounts**: one per wallet and asset, with the chain as source: _Wallet NYM ···w6d0y_, _Wallet USDC (Base) ···81efcf_ (an EVM address is the same on every EVM chain, so the chain is named). Balance and its day as for Kraken.

**Bookings**: one per movement, valued at the day's rate (CoinGecko first, Kraken as the fallback; no `prefer`, this is no exchange booking).

| What happened                                    | Booking                                                                               | Receipt                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| sent / received                                  | movement `transfer`, sourceId `<hash>:<n>`, `counterpartyAddress` = the other address | needed – unless the other address is an own wallet  |
| between two own wallets                          | both legs share `txRef` (the hash)                                                    | own transfer (1360), paired by the hash             |
| to an own wallet not synced yet                  | as above                                                                              | own transfer (1360), by the address                 |
| the fee this address paid (also for a failed tx) | movement `fee`, sourceId `<hash>:fee`                                                 | network fee: the transaction is the receipt         |
| a staking reward (from `distribution`)           | movement `reward`                                                                     | none (as an exchange's reward)                      |
| a delegation (to `bonded_tokens_pool`)           | movement `stake`                                                                      | none: the tokens stay ours; account for the adviser |
| an IBC transfer out                              | movement `transfer`, the receiver on the other chain as counterparty                  | needed                                              |

`txRef` is the hash exactly as the chain gives it: Cosmos upper-case hex, EVM `0x` + lower-case hex. An exchange that names the on-chain hash of a withdrawal or deposit can be paired with it by that hash (Kraken's side: #52). Every booking keeps `explorerUrl`, its transaction in the block explorer; _Zahlungen_ shows _Im Block-Explorer ansehen_ and the _Gegenadresse_.

**Left out, and said so**: denoms and tokens not in the chain's list (IBC vouchers `ibc/…`, factory denoms, any ERC-20 but the listed USDC – a contract can call itself "USDC"); entries without a rate (NYX has none at CoinGecko or Kraken), fetched again next time; a pruned node's older history (the sync shows from which day the node knows the chain – use an archive node then). **Not seen at all**: tokens that return when an unbonding ends (the chain does that without a transaction), vesting, and on rollups (Base, Optimism, Arbitrum) the L1 data fee, which Blockscout's Etherscan-compatible API does not report. The balance shows the truth; a difference is for a person to look at.

**What the node sees**: the address and the Mac's IP address, only on _Synchronisieren_ (consent screen, _Blockchain-Abfrage_). The bridge's log has counts, never an address or an amount.

### Where the defaults come from (checked 2026-09-26)

| Chain     | Chain id     | Address                          | Assets (decimals)                | Default endpoints                                                                                        | Explorer (tx / address)                                      |
| --------- | ------------ | -------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Nym (Nyx) | `nyx`        | bech32 `n1…`                     | NYM `unym` (6), NYX `unyx` (6)   | RPC `rpc.nymtech.net`, REST `api.nymtech.net` (Nym); archive: `rpc.nyx.nodes.guru`, `api.nyx.nodes.guru` | `nym.explorers.guru/transaction/{tx}`, `/account/{address}`  |
| Akash     | `akashnet-2` | bech32 `akash1…`                 | AKT `uakt` (6)                   | RPC `akash-rpc.polkachu.com`, REST `akash-api.polkachu.com`; `rpc-akash.ecostake.com`                    | `mintscan.io/akash/transactions/{tx}`, `/accounts/{address}` |
| Ethereum  | 1            | `0x` + 40 hex, EIP-55 when mixed | ETH (18), USDC `0xA0b8…eB48` (6) | `eth.blockscout.com/api`                                                                                 | `etherscan.io/tx/{tx}`, `/address/{address}`                 |
| Base      | 8453         | as Ethereum                      | ETH (18), USDC `0x8335…2913` (6) | `base.blockscout.com/api`                                                                                | `basescan.org/tx/…`, `/address/…`                            |
| Arbitrum  | 42161        | as Ethereum                      | ETH (18), USDC `0xaf88…5831` (6) | `arbitrum.blockscout.com/api`                                                                            | `arbiscan.io/tx/…`, `/address/…`                             |
| Optimism  | 10           | as Ethereum                      | ETH (18), USDC `0x0b2C…Ff85` (6) | `explorer.optimism.io/api` (Blockscout)                                                                  | `optimistic.etherscan.io/tx/…`, `/address/…`                 |
| Polygon   | 137          | as Ethereum                      | POL (18), USDC `0x3c49…3359` (6) | `polygon.blockscout.com/api`                                                                             | `polygonscan.com/tx/…`, `/address/…`                         |

- **Checked against the source**: Nyx and Akash chain id, bech32 prefix, denoms, exponents, RPC/REST and explorer URL patterns against the Cosmos chain registry (`nyx/`, `akash/` `chain.json` and `assetlist.json`); Nyx's node reports chain `nyx`, CometBFT 0.38 and cosmos-sdk 0.53 (so events are plain text, the fee is in the `tx` event). The USDC contracts against Circle's list of USDC contract addresses, their 6 decimals against each chain's Blockscout. The Blockscout API answers on each host (Optimism's Blockscout moved to `explorer.optimism.io`) and reports chain ids 1, 42161, 10 and 137.
- **Checked by trying**: Nym's RPC answers `tx_search` for `transfer.sender` and `transfer.recipient` in well under a second (an earlier project found sender queries hanging; not reproduced). It is **pruned** (its oldest block is from 2025); Nodes Guru's RPC goes back to the first block. Blockscout refuses page × offset above 10 000.
- **Not checked**: Base's chain id through its API (rate-limited at the time; 8453 is the well-known id); that the explorers' pages render (they are single-page apps and answer 200 for anything); Akash's history depth on Polkachu's node.

## In the export

The Buchungstext of a crypto booking ends with what moved, e.g. `Konto B -0,015 BTC`. The name is shortened when the 60 characters DATEV allows are not enough; the quantity never is. The amount (Umsatz) is in EUR, like every other line.

## In the app

The detail of a payment shows **Menge** (`-0,015 BTC`) and **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
