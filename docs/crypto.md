# Crypto assets: quantities, rates, bookings

_Deutsch: [crypto.de.md](crypto.de.md)_

Belege keeps accounts on exchanges (Kraken) and, next, wallets on blockchains (Cosmos, EVM, Bitcoin). This page describes what they share and the Kraken connector.

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

## In the export

The Buchungstext of a crypto booking ends with what moved, e.g. `Konto B -0,015 BTC`. The name is shortened when the 60 characters DATEV allows are not enough; the quantity never is. The amount (Umsatz) is in EUR, like every other line.

## In the app

The detail of a payment shows **Menge** (`-0,015 BTC`) and **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
