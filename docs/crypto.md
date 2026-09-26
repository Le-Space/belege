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
- **EVM**: first Blockscout's JSON-RPC proxy (`…/api/eth-rpc`, `eth_chainId`) must name the chain (else `WALLET_WRONG_CHAIN`, or `WALLET_CHAIN_UNVERIFIED` when it cannot say); then its Etherscan-compatible API, no key: `txlist`, `txlistinternal`, `tokentx`, `balance`, `tokenbalance`. Paged by start block past Blockscout's 10 000-entry window, with retries on its rate limit. Blockscout without a key answers only a few requests per half hour and IP address (about ten were seen; a sync needs at least six), then HTTP 429.
- **EVM with Alchemy** (when `pnpm setup:alchemy` has stored a key, and the wallet names no `api` endpoint of its own): see [Alchemy](#alchemy) below.

**Accounts**: one per wallet and asset, with the chain as source: _Wallet NYM ···w6d0y_, _Wallet USDC (Base) ···81efcf_ (an EVM address is the same on every EVM chain, so the chain is named). Balance and its day as for Kraken.

**Bookings**: one per movement, valued at the day's rate (CoinGecko first, Kraken as the fallback; no `prefer`, this is no exchange booking).

| What happened                                    | Booking                                                                                                                                                                     | Receipt                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sent / received                                  | movement `transfer`, sourceId `<hash>:m<msg>:e<event>.<n>:<asset>` (Cosmos), `<hash>:value` / `:erc20:<contract>:<from>:<to>:<value>:<n>` / `:internal:<i>` (EVM; Alchemy: `:internal:trace:<address>`), `counterpartyAddress` = the other address | needed – unless the other address is an own wallet                                                                                                                                       |
| between two own wallets                          | both legs share `txRef` (the hash)                                                                                                                                          | own transfer (1360), paired by the hash                                                                                                                                                  |
| to an own wallet not synced yet                  | as above                                                                                                                                                                    | own transfer (1360), by the address                                                                                                                                                      |
| the fee this address paid (also for a failed tx) | movement `fee`, sourceId `<hash>:fee`                                                                                                                                       | network fee: the transaction is the receipt                                                                                                                                              |
| a staking reward (from `distribution`)           | movement `reward`                                                                                                                                                           | none (as an exchange's reward)                                                                                                                                                           |
| a delegation (to `bonded_tokens_pool`)           | movement `stake`                                                                                                                                                            | none, kind `crypto-stake`: the tokens stay ours; **not 1360** – their return after unbonding is no transaction, a transit account would never balance; the account is the adviser's call |
| an IBC transfer out                              | movement `transfer`, the receiver on the other chain as counterparty                                                                                                        | needed                                                                                                                                                                                   |

`txRef` is the hash exactly as the chain gives it: Cosmos upper-case hex, EVM `0x` + lower-case hex. Kraken's crypto deposits and withdrawals carry the on-chain hash as `chainTxRef` (from DepositStatus/WithdrawStatus), so they pair with the wallet booking of the same hash, whatever the euro amounts. Every booking keeps `explorerUrl`, its transaction in the block explorer; _Zahlungen_ shows _Im Block-Explorer ansehen_ and the _Gegenadresse_.

**Left out, and said so**: denoms and tokens not in the chain's list (IBC vouchers `ibc/…`, factory denoms, any ERC-20 but the listed USDC – a contract can call itself "USDC"); entries without a rate (NYX has none at CoinGecko or Kraken), fetched again next time; a pruned node's older history (the sync shows from which day the node knows the chain – use an archive node then). **Not seen at all**: tokens that return when an unbonding ends (the chain does that without a transaction), vesting, and on rollups (Base, Optimism, Arbitrum) the L1 data fee, which Blockscout's Etherscan-compatible API does not report. The balance shows the truth; a difference is for a person to look at.

**What the node sees**: the address and the Mac's IP address, only on _Synchronisieren_ (consent screen, _Blockchain-Abfrage_); Alchemy also ties the queries to the Alchemy account whose key it is. The bridge's log has counts, never an address or an amount.

### Alchemy

With an Alchemy API key (`pnpm setup:alchemy`: hidden prompt, `eth_chainId` on every network as a check, macOS keychain, service `belege-bridge`, account `alchemy`; Enter keeps it, `-` deletes it) the bridge reads EVM wallets from `https://<network>.g.alchemy.com/v2/<key>` – `eth-mainnet`, `base-mainnet`, `arb-mainnet`, `opt-mainnet`, `polygon-mainnet` – instead of Blockscout. The key is read from the keychain on every sync (no restart), goes only into the URL of the requests to Alchemy and never into a log line, an error, an answer or the app; `GET /chains` says `alchemy: true` or `false`. A wallet with an `api` endpoint of its own is read there, never through Alchemy. _Integrationen → Eigene Wallets_ says which source is used, and without a key how to set one up.

What is asked, JSON-RPC, several calls as one batch (at most 50):

1. `eth_chainId` – the endpoint must serve the chain (`WALLET_WRONG_CHAIN` otherwise; nothing else is asked).
2. `alchemy_getAssetTransfers`, once with `fromAddress`, once with `toAddress` (both in one call would mean "from and to"): categories `external`, `erc20` and `internal` where Alchemy offers it (Ethereum, Base, Polygon), `withMetadata: true` (the block time), `excludeZeroValue: true`, `order: asc`, `maxCount: 0x3e8`, then `pageKey` (valid 10 minutes).
3. For every transaction a transfer names the address as its sender: `eth_getTransactionByHash` (who really sent it – a token can leave by `transferFrom` in someone else's transaction, which costs us no gas) and `eth_getTransactionReceipt` (the gas: `gasUsed × effectiveGasPrice`; `status`).
4. Transactions the address sent that moved nothing – a failed one, an approval, a claim that only brought something in – are in no transfer list. The nonce counts each of them: `eth_blockNumber` and `eth_getTransactionCount` at the head; where the count rises by more than the known transactions explain, the block range is cut into 16 parts and the count asked at every cut (one batch), until single blocks are left; `eth_getBlockByNumber` with transactions finds them, `eth_getTransactionReceipt` gives their gas. At most 300 such blocks per sync (`WALLET_TOO_MANY` beyond).
5. For value received from someone else's transaction: `eth_getTransactionReceipt` (batched), and a reverted one books nothing. Alchemy was not seen to list reverted transactions, but does not say it never does.
6. A receipt without `status` (before Byzantium, Ethereum block 4 370 000, October 2017) does not say whether the transaction went through; Blockscout knows it from its traces. Through Alchemy its gas is booked (paid either way), its value is not, and the result counts it (`unknownStatus`, in the bridge's log as _without a receipt status_). For such old history, sync through Blockscout (an own `api` endpoint).
7. `eth_getBalance` and `alchemy_getTokenBalances` for the listed contracts only.

Symbols and decimals come from the registry, never from Alchemy's `asset` or `rawContract.decimal` (which is what the token says about itself).

**Ids, and changing the source.** Alchemy's answers are turned into Blockscout's lists and then into entries by the same code, so the value (`<hash>:value`), the gas (`<hash>:fee`) and a token transfer (`<hash>:erc20:<contract>:<from>:<to>:<value>:<n>`: Blockscout's `tokentx` gives no log index, so neither side uses Alchemy's) get the same id from both – a wallet synced through Blockscout and then through Alchemy, or the other way round, books nothing twice (tested on one made-up chain read through both fakes). An internal transfer cannot: Blockscout numbers it by its place among all of the transaction's calls (`index`), Alchemy by its trace address among those that moved value (`uniqueId` `<hash>:internal:<trace>`), and neither can be computed from the other. Alchemy's gets an id of its own, `<hash>:internal:trace:<trace>`, which can never equal a Blockscout one; the app then pairs an incoming entry whose id is not stored with a stored booking of the same transaction, kind (gas, value, token, internal), quantity and other address that no incoming entry names, each stored one once, and keeps the stored id (`reconcileSourceIds` in `app/src/lib/wallets/wallet-sync.js`).

**Errors**: 401 → `WALLET_ALCHEMY_AUTH` (run `pnpm setup:alchemy` again); 403 → `WALLET_ALCHEMY_DENIED` (network not enabled for the Alchemy app, capacity used up, app inactive; the message quotes Alchemy's words without links); HTTP 429 or an item with error code 429 inside a batch (a batch always answers 200) → retried three times, then 429 `WALLET_ALCHEMY_RATE_LIMIT`; any other refusal → `WALLET_ALCHEMY` with Alchemy's code.

**Gaps**: Alchemy has no `internal` category on Arbitrum and Optimism; there the bridge still reads `txlistinternal` from Blockscout (with its `eth_chainId` check: two requests per sync instead of six or more). The L1 data fee of rollups is still left out – the receipts of Base and Optimism name it (`l1Fee`), but taking it would change the amount of fees already booked from Blockscout; a later change. A transaction that the nonce shows but whose block has no transaction from the address (a smart-contract wallet, whose nonce counts contract creations) is skipped.

**Checked** (2026-09-26): the five endpoint hosts, the parameters, categories, the `internal` networks, the 1000 page limit, the batch limit and the error shapes (401 `-32600` _Must be authenticated!_, 403, 429 code 429, `-32601` _Unsupported method_, `-32602` _invalid … argument_) against Alchemy's documentation; that every host answers, and that a made-up key gets exactly that 401 body. **By real calls** on Ethereum mainnet (with a real key, for a public burn address only): `alchemy_getAssetTransfers` including a second page by `pageKey`, `rawContract.value` and `blockNum` as hex, `metadata.blockTimestamp` as ISO, `uniqueId` as `<hash>:external`, `<hash>:log:<n>` and `<hash>:internal:<trace>` with underscores (`3_0`, `0_3_0`; 2000 ids, all unique), receipts and transactions in hex, a batch answered as an array, `eth_getTransactionCount` at an old block, `alchemy_getTokenBalances` with 66-character padded balances. The fake (`bridge/test/support/fake-alchemy.js`) answers in these shapes and is as strict as the documented API about method names, parameter count and types (a string `"true"` where a boolean belongs is refused). **Not seen**: a reverted transaction in the transfer lists (about 400 looked at), and a pre-Byzantium receipt through Alchemy – both are handled as above anyway.

### Bitcoin

A Bitcoin wallet is read by its account's **extended public key**, not by one address: a wallet spreads its coins over many addresses and sends change to new ones. Belege takes a **zpub** (native SegWit, `bc1q…`), a **ypub** (`3…`) or an **xpub**. Wallets hand out an xpub for more than one kind of address, so `pnpm setup:bitcoin` asks for the xpub's kind: `bc1q…` or `1…`.

- **The key stays in the bridge.** `pnpm setup:bitcoin` puts it into the macOS keychain (account `bitcoin`, JSON `{ key, type }`); `BITCOIN_XPUB` from `.env` is offered once. The app knows the wallet only by a fingerprint of the key (`btc-` + 8 hex): _Integrationen → Eigene Wallets → Bitcoin → Schlüssel aus der Bridge übernehmen_. On every sync the bridge checks the fingerprint, so a replaced key does not book onto the old account (`WALLET_KEY_CHANGED`).
- **Addresses** are derived in the bridge (`/0/i` receive, `/1/i` change) until 20 in a row are unused. Each is asked of an Esplora API: `mempool.space/api` by default, `blockstream.info/api` as an alternative, or your own. That API sees all these addresses from one IP and can tell they belong together (consent screen, _Blockchain-Abfrage_); an own Esplora avoids it.
- **Bookings**, from the wallet's point of view (all its addresses together), confirmed transactions only:
  - all inputs ours: sent. The fee is a booking of its own (`<txid>:fee`), the rest went to others (`<txid>:value`). Change to our own addresses is no booking; a transaction only between our addresses is just its fee.
  - no input ours: received what went to our addresses.
  - some inputs ours (payjoin, coinjoin): one booking with the net change, fee included, and a note.
- `txRef` is the txid. A Kraken BTC deposit or withdrawal carries the same txid as `chainTxRef`, so the two pair as an own transfer.
- One account, _Wallet BTC ···<fingerprint>_, with its balance (confirmed, from the Esplora API).

### Where the defaults come from (checked 2026-09-26)

| Chain     | Chain id     | Address                            | Assets (decimals)                | Default endpoints                                                                                        | Explorer (tx / address)                                      |
| --------- | ------------ | ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Nym (Nyx) | `nyx`        | bech32 `n1…`                       | NYM `unym` (6), NYX `unyx` (6)   | RPC `rpc.nymtech.net`, REST `api.nymtech.net` (Nym); archive: `rpc.nyx.nodes.guru`, `api.nyx.nodes.guru` | `nym.explorers.guru/transaction/{tx}`, `/account/{address}`  |
| Akash     | `akashnet-2` | bech32 `akash1…`                   | AKT `uakt` (6)                   | RPC `akash-rpc.polkachu.com`, REST `akash-api.polkachu.com`; `rpc-akash.ecostake.com`                    | `mintscan.io/akash/transactions/{tx}`, `/accounts/{address}` |
| Ethereum  | 1            | `0x` + 40 hex, EIP-55 when mixed   | ETH (18), USDC `0xA0b8…eB48` (6) | `eth.blockscout.com/api`                                                                                 | `etherscan.io/tx/{tx}`, `/address/{address}`                 |
| Base      | 8453         | as Ethereum                        | ETH (18), USDC `0x8335…2913` (6) | `base.blockscout.com/api`                                                                                | `basescan.org/tx/…`, `/address/…`                            |
| Arbitrum  | 42161        | as Ethereum                        | ETH (18), USDC `0xaf88…5831` (6) | `arbitrum.blockscout.com/api`                                                                            | `arbiscan.io/tx/…`, `/address/…`                             |
| Optimism  | 10           | as Ethereum                        | ETH (18), USDC `0x0b2C…Ff85` (6) | `explorer.optimism.io/api` (Blockscout)                                                                  | `optimistic.etherscan.io/tx/…`, `/address/…`                 |
| Bitcoin   | mainnet      | derived from an xpub, ypub or zpub | BTC (8)                          | `mempool.space/api` (Esplora); `blockstream.info/api`                                                    | `mempool.space/tx/{tx}`, `/address/{address}`                |
| Polygon   | 137          | as Ethereum                        | POL (18), USDC `0x3c49…3359` (6) | `polygon.blockscout.com/api`                                                                             | `polygonscan.com/tx/…`, `/address/…`                         |

- **Checked against the source**: Nyx and Akash chain id, bech32 prefix, denoms, exponents, RPC/REST and explorer URL patterns against the Cosmos chain registry (`nyx/`, `akash/` `chain.json` and `assetlist.json`); Nyx's node reports chain `nyx`, CometBFT 0.38 and cosmos-sdk 0.53 (so events are plain text, the fee is in the `tx` event). The USDC contracts against Circle's list of USDC contract addresses, their 6 decimals against each chain's Blockscout. The Blockscout API answers on each host (Optimism's Blockscout moved to `explorer.optimism.io`) and reports chain ids 1, 42161, 10 and 137.
- **Checked by trying**: Nym's RPC answers `tx_search` for `transfer.sender` and `transfer.recipient` in well under a second (an earlier project found sender queries hanging; not reproduced). It is **pruned** (its oldest block is from 2025); Nodes Guru's RPC goes back to the first block. Blockscout refuses page × offset above 10 000. Blockscout's `tokentx` gives no log index, so a token transfer's id is built from contract, sender, receiver and value (stable, but not a log index).
- **Not checked**: Base's chain id through its API (rate-limited at the time; 8453 is the well-known id); that the explorers' pages render (they are single-page apps and answer 200 for anything); Akash's history depth on Polkachu's node.

## In the export

The Buchungstext of a crypto booking ends with what moved, e.g. `Konto B -0,015 BTC`. The name is shortened when the 60 characters DATEV allows are not enough; the quantity never is. The amount (Umsatz) is in EUR, like every other line.

## In the app

The detail of a payment shows **Menge** (`-0,015 BTC`) and **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
