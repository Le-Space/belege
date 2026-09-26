# Crypto assets: quantities, rates, bookings

_Deutsch: [crypto.de.md](crypto.de.md)_

Belege is getting accounts on exchanges (Kraken first) and wallets on blockchains (Cosmos, EVM, Bitcoin). This page describes the foundation they share. The connectors themselves come in later steps.

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
3. for **USD**: the **ECB reference rate** of the day, or the last one before it (weekends, holidays), inverted to EUR per USD.

The request names an asset and a day, nothing about the bookings. Past days are cached in memory. With a CoinGecko demo key in the keychain (account `coingecko`), it is sent as a header.

**Which rate and which valuation method apply is the tax adviser's call.** This includes the accounts for crypto holdings, gains and losses on exchange rates, FIFO or average cost, and valuation at the end of the year. Belege records the rate and its source on every booking, so a different decision can be applied later.

## In the export

The Buchungstext of a crypto booking ends with what moved, e.g. `Konto B -0,015 BTC`. The name is shortened when the 60 characters DATEV allows are not enough; the quantity never is. The amount (Umsatz) is in EUR, like every other line.

## In the app

The detail of a payment shows **Menge** (`-0,015 BTC`) and **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
