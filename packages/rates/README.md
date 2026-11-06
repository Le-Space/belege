# @le-space/rates

The euro rate of a day, one definition for Le Space's tools – [Belege](https://github.com/Le-Space/belege) and the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI (decided 2026-11-06, [eigenbeleg-agent#6](https://github.com/Le-Space/eigenbeleg-agent/issues/6)):

- **a crypto asset: its price at 00:00 UTC of the day** – CoinGecko's daily snapshot; failing that, Kraken's daily candle, its open; before Kraken's candles, Kraken's first trade at or after midnight. With `prefer: 'kraken'` the order turns.
- **a currency:** the ECB reference rate of the day or the last before it, inverted; RUB after 2022-03-01 from the Bank of Russia, KZT from the National Bank of Kazakhstan, other currencies the Bank of Russia lists as a cross rate through the ruble (marked `cbr-cross`).
- **Aleph Cloud credits:** priced in USD by Aleph, so no rate of the day: the per-credit price of the last purchase on or before the day, else Aleph's list price (1 USD per 1,000,000 credits), at that day's ECB rate (`aleph-credits`: `alephCreditPrice`, `alephCreditsInEur`).
- **a token nobody prices:** its deepest Uniswap pool (V2, V3, V4) at the booking's block, against ETH or USDC, through an Alchemy key (`dex-rate`).

Every answer says its source and moment (`{ rate, usdRate, source, at }`), so a document can name them. Rates are decimal strings, never floats.

```js
import { createRateService, createDexRates } from '@le-space/rates';

const rates = createRateService({
	fetch, // the caller's; a browser needs a proxy for CORS
	coingeckoKey: async () => key ?? null, // optional demo key
	dex: createDexRates({ fetch, alchemyKey: async () => alchemy ?? null }) // optional
});
await rates.rate('AKT', '2026-09-01'); // { rate: '3.5', source: 'coingecko', at: '2026-09-01T00:00:00Z', … }
```

```bash
pnpm --filter @le-space/rates test   # Node, and a scenario in Chromium
```

Moved with its history from Belege's `bridge/src/rates.js` and `dex-rate.js`. AGPL-3.0-or-later.
