# @le-space/rates

The euro rate of a day, one definition for Le Space's tools – [Belege](https://github.com/Le-Space/belege) and the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI (decided 2026-11-06, [eigenbeleg-agent#6](https://github.com/Le-Space/eigenbeleg-agent/issues/6)):

- **a crypto asset: its price at 00:00 UTC of the day** – CoinGecko's daily snapshot; failing that, Kraken's daily candle, its open; before Kraken's candles, Kraken's first trade at or after midnight. With `prefer: 'kraken'` the order turns. Listed (`RATE_SOURCES`): BTC, ETH, USDC, USDT, ALEPH, NYM, AKT, FIL, XMR, POL, NEAR, USDFC; another symbol only with `prefer: 'kraken'`, by its EUR pair.
- **a currency:** the ECB reference rate of the day or the last before it, inverted; RUB from the Bank of Russia (for every day, also before 2022-03-01, when the ECB still quoted it), KZT from the National Bank of Kazakhstan, other currencies the Bank of Russia lists as a cross rate through the ruble (marked `cbr-cross`).
- **Aleph Cloud credits:** priced in USD by Aleph, so no rate of the day: what a credit cost in the last purchase on or before the day (dollars paid / credits that came in; a purchase row's `price` is in the payment token, so a purchase in ALEPH is valued at Aleph's list price for the credits paid for, `alephPurchase`), else Aleph's list price (1 USD per 1,000,000 credits), at that day's ECB rate (`aleph-credits`: `alephCreditPrice`, `alephCreditsInEur`).
- **an asset nobody quotes (DOI):** a reference value from a dated table the caller hands in, the last line on or before the day; the source says it is a reference value, who set it and since when, and that it is no exchange rate. An asset with a table never reaches a price feed; no table ships with the package (`reference-rate`: `referenceRate`, `withReferenceRates`).
- **a token nobody prices:** its deepest Uniswap pool (V2, V3, V4) at the booking's block, against ETH or USDC, through an Alchemy key (`dex-rate`).

- **in another currency than the euro** (`rate(asset, date, { currency })`, for a document kept in CHF, USD, RUB …; [eigenbeleg-agent#72](https://github.com/Le-Space/eigenbeleg-agent/issues/72)): the euro rate times the currency's units per euro of the day – the ECB reference rate or the last before it (one request per currency reads the weeks around the day, as for a currency's own rate), for RUB the Bank of Russia's official rate valid on the day. The answer carries both legs: `eurRate`, and `fx: { currency, perEur, source, at }`. USD too: also where CoinGecko has a USD price of its own, the euro is converted with the ECB's reference rate – the ruble is the only currency with another source. `TARGET_CURRENCIES` lists what can be asked for: the euro and every currency with an official rate against it; a cross rate through the ruble is refused.
- **the second leg alone** (`perEuro(currency, date)`, for a value already in euros, such as a reference value set by hand, that goes into a document in another currency): `{ currency, perEur, source, at }` – the same rate, window and cache as `fx` in `rate(…, { currency })`; the euro itself is `perEur: '1'`, `source: 'same'`. A code outside `TARGET_CURRENCIES`, a malformed or future day are refused (400) before anything is fetched; a day without a rate is a 502.

- **a period of days** (`rates(asset, from, to)`, for a chart; at most `MAX_RANGE_DAYS` = 100 days, listed assets, in euros): what `rate` answers for each day, asked for together – CoinGecko's daily points of the period (`/market_chart/range` with `interval=daily`: one point per day at 00:00 UTC, the same figure as the daily snapshot) in two calls, EUR and USD; a day without a point from Kraken's daily candles. The answer is `{ asset, from, to, currency, rates }` with the days that have a rate, oldest first; a day without one is left out, nothing is carried. Past days are kept under the keys `rate` uses.

Every answer says its source and moment (`{ rate, usdRate, source, at }`), so a document can name them. Rates are decimal strings, never floats.

```js
import { createRateService, createDexRates } from '@le-space/rates';

const rates = createRateService({
	fetch, // the caller's; a browser needs a proxy for CORS
	coingeckoKey: async () => key ?? null, // optional demo key
	dex: createDexRates({ fetch, alchemyKey: async () => alchemy ?? null }) // optional
});
await rates.rate('AKT', '2026-09-01'); // { rate: '3.5', source: 'coingecko', at: '2026-09-01T00:00:00Z', … }
await rates.rate('AKT', '2026-09-01', { currency: 'CHF' });
// { currency: 'CHF', rate: '3.325', eurRate: '3.5', source: 'coingecko', at: …,
//   fx: { currency: 'CHF', perEur: '0.95', source: 'ecb', at: '2026-09-01T00:00:00Z' } }
```

```bash
pnpm --filter @le-space/rates test   # Node, and a scenario in Chromium
```

Moved with its history from Belege's `bridge/src/rates.js` and `dex-rate.js`. AGPL-3.0-or-later.
