# crypto-ledger

An open format for what moved on crypto wallets and exchange accounts, valued in a fiat currency – so a tool that reads chains and exchanges and a tool that keeps books can exchange their data.

This folder is **MIT licensed** ([LICENSE](LICENSE)), unlike the rest of Belege (AGPL-3.0). Use it, copy it, build importers and exporters for it.

- Schema: [`crypto-ledger.v1.schema.json`](crypto-ledger.v1.schema.json) (JSON Schema 2020-12)
- Examples, all made up: [EVM](examples/evm.json), [Cosmos](examples/cosmos.json), [Bitcoin](examples/bitcoin.json), [Filecoin](examples/filecoin.json), [Monero](examples/monero.json), [exchange](examples/exchange.json)

## The file

```json
{
  "format": "crypto-ledger",
  "version": 1,
  "createdAt": "2025-06-30T12:00:00Z",
  "currency": "EUR",
  "accounts": [
    {
      "id": "eip155:8453:0x1111…",
      "type": "wallet",
      "chain": "eip155:8453",
      "address": "0x1111…",
      "name": "Project wallet"
    }
  ],
  "movements": [
    {
      "id": "0xaaaa…:fee",
      "account": "eip155:8453:0x1111…",
      "time": "…",
      "date": "2025-05-03",
      "kind": "fee",
      "asset": { "symbol": "ETH", "decimals": 18 },
      "amount": "-0.000021",
      "value": {
        "amount": "-0.03",
        "rate": "1600",
        "source": "coingecko",
        "at": "…"
      },
      "txHash": "0xaaaa…"
    }
  ]
}
```

## Rules

- **Accounts.** A wallet is identified by its CAIP-10 id (`<chain>:<address>`), its chain by CAIP-2 (`eip155:1`, `cosmos:akashnet-2`, `bip122:000000000019d6689c085ae165831e93`, `fil:f`). An exchange account by the exchange's [ccxt](https://github.com/ccxt/ccxt) id (`kraken`), a sub-account after a slash (`kraken/earn`).
- **Movements.** One booked change of one asset on one account. The amount is signed (in positive, out negative) and written as decimal text, never a float; `asset.decimals` says how far it may go.
- **Fees are movements of their own** (`kind: fee`, by convention `<hash>:fee`), never netted into the amount.
- **Ids are stable.** The same movement read again gets the same id, so an importer can skip what it already has. They are unique per account.
- **Pairing.** `txHash` is the chain's transaction as the chain writes it. An exchange names it for a deposit or withdrawal where it can; the same hash on a wallet's movement is the other side of that transfer. The legs of an exchange trade share `ref`, the legs of a swap on a chain share `txHash`.
- **Assets.** `symbol` is for people. Where it is unambiguous, `caip19` says which asset it is (`eip155:1/slip44:60`, `eip155:8453/erc20:0x8335…`); a token is only ever identified by its contract – a contract can call itself anything.
- **Value.** What the movement was worth on its day in the file's `currency`, the rate per whole unit, where the rate came from and for which moment. `null` while no rate is known.
- **Kinds.** `transfer`, `trade`, `swap`, `fee`, `reward`, `stake`, `mining` – how the source named the entry itself goes to `sourceType`.

## Versions

Any change to the fields is a new `version`, with its own schema file. The schema forbids unknown fields, so a file of a newer version fails validation instead of losing data unnoticed.

## Who writes it

[Belege](../README.md) exports its crypto bookings in this format and reads such files in (Export → "Kryptobewegungen").
