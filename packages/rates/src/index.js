// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/rates: the euro rate of a day – the price at 00:00 UTC
// (CoinGecko's daily snapshot, else Kraken's daily open, else Kraken's first
// trade at or after midnight), the ECB reference rate for currencies (Bank of
// Russia, National Bank of Kazakhstan where the ECB has none), and a token's
// DEX pool at the booking's block where nobody prices it. Every answer names
// its source and moment. `fetch` and the keys are handed in.
export {
	CBR_CROSS_CURRENCIES,
	COINGECKO_PLATFORMS,
	ECB_CURRENCIES,
	RATE_SOURCES,
	RateError,
	createRateService,
	invert,
	toDecimal
} from './rates.js';
export {
	DEX_CHAINS,
	MIN_POOL_EUR,
	createDexRates,
	decimalOf,
	ethPerToken,
	multiplyRates,
	quotePerToken,
	v4PoolId,
	virtualReserve
} from './dex-rate.js';
