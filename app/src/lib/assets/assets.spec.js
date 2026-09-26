import { describe, expect, it } from 'vitest';

import { ASSETS, assetOf, isCrypto } from './registry.js';
import { formatQuantity, fromUnits, toUnits, valueCents } from './quantity.js';
import {
	formatRate,
	quantityText,
	valuationText,
	valuedFields,
	valueMovement
} from './valuation.js';

const nb = (/** @type {string} */ s) => s.replace(/\u00a0/g, ' ');

describe('registry', () => {
	it('knows the assets by symbol, case-insensitively, and nothing else', () => {
		expect(assetOf('btc')?.decimals).toBe(8);
		expect(assetOf('USDC')?.decimals).toBe(6);
		expect(assetOf('NYM')?.denom).toBe('unym');
		expect(assetOf('DOGE')).toBeNull();
		expect(assetOf('toString')).toBeNull();
		expect(assetOf(null)).toBeNull();
		expect(isCrypto('ETH')).toBe(true);
		expect(isCrypto('EUR')).toBe(false);
	});

	it('every entry is keyed by its own symbol', () => {
		for (const [key, asset] of Object.entries(ASSETS)) expect(asset.symbol).toBe(key);
	});
});

describe('quantities', () => {
	it('turn decimals into smallest units and back, exactly', () => {
		expect(toUnits('0.015', 8)).toBe('1500000');
		expect(toUnits('-1', 6)).toBe('-1000000');
		expect(toUnits('1.500', 2)).toBe('150');
		expect(toUnits('-0', 6)).toBe('0');
		expect(toUnits('123456789.123456789012345678', 18)).toBe('123456789123456789012345678');
		expect(fromUnits('1500000', 8)).toBe('0.015');
		expect(fromUnits('-1000000', 6)).toBe('-1');
		expect(fromUnits('5', 18)).toBe('0.000000000000000005');
	});

	it('refuse what they would have to round or cannot read', () => {
		expect(() => toUnits('0.123', 2)).toThrow(/more than 2 decimals/);
		expect(() => toUnits('1e-8', 8)).toThrow(/Not a decimal/);
		expect(() => toUnits('1,5', 8)).toThrow(/Not a decimal/);
		expect(() => fromUnits('1.5', 8)).toThrow(/Not an integer/);
	});

	it('are written the German way, with every significant digit', () => {
		expect(nb(formatQuantity('1500000', 8, 'BTC'))).toBe('0,015 BTC');
		expect(nb(formatQuantity('-1234500000', 6, 'NYM'))).toBe('-1.234,5 NYM');
		expect(nb(formatQuantity('1200', 2, 'EUR', { minFraction: 2 }))).toBe('12,00 EUR');
		expect(formatQuantity('1', 18)).toBe('0,000000000000000001');
	});

	it('are valued in cents, rounded once, half away from zero', () => {
		expect(valueCents('1500000', 8, '60000')).toBe(90000); // 0.015 BTC × 60 000 = 900,00
		expect(valueCents('-1000000', 6, '0.123456')).toBe(-12); // −0,123456 → −0,12
		expect(valueCents('5', 2, '0.1')).toBe(1); // 0,005 → 0,01
		expect(valueCents('-5', 2, '0.1')).toBe(-1);
		expect(valueCents('1000000000000000000', 18, '2500.5')).toBe(250050); // 1 ETH
		expect(valueCents('1', 18, '2500.5')).toBe(0);
		expect(() => valueCents('1', 8, '-3')).toThrow(/Not a rate/);
	});
});

describe('valuation', () => {
	const rate = {
		rate: '60000',
		source: /** @type {const} */ ('coingecko'),
		at: '2026-09-01T00:00:00Z'
	};

	it('gives a booking in euros that keeps what moved and how it was valued', () => {
		expect(valuedFields({ asset: 'btc', units: '-1500000', rate })).toEqual({
			amountCents: -90000,
			currency: 'EUR',
			asset: 'BTC',
			quantity: '-1500000',
			decimals: 8,
			valuation: { rate: '60000', currency: 'EUR', source: 'coingecko', at: '2026-09-01T00:00:00Z' }
		});
		expect(() => valuedFields({ asset: 'DOGE', units: '1', rate })).toThrow(/Unknown asset/);
	});

	it('asks for the rate of the movement’s day', async () => {
		/** @type {string[]} */ const asked = [];
		const fields = await valueMovement(
			{ asset: 'AKT', units: '4200000', date: '2026-09-01' },
			async (a, d) => {
				asked.push(`${a}@${d}`);
				return {
					asset: a,
					date: d,
					currency: 'EUR',
					rate: '2.5',
					usdRate: null,
					source: 'kraken',
					at: `${d}T00:00:00Z`
				};
			}
		);
		expect(asked).toEqual(['AKT@2026-09-01']);
		expect(fields.amountCents).toBe(1050);
		expect(fields.valuation.source).toBe('kraken');
	});

	it('is described for people', () => {
		const tx = valuedFields({ asset: 'BTC', units: '1500000', rate: { ...rate, rate: '60123.4' } });
		expect(nb(quantityText(tx))).toBe('0,015 BTC');
		expect(valuationText(tx)).toBe('60.123,40 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC');
		expect(quantityText({ amountCents: 100 })).toBe('');
		expect(valuationText({ amountCents: 100 })).toBe('');
		expect(formatRate('0.000012')).toBe('0,000012');
		expect(formatRate('3')).toBe('3,00');
	});
});
