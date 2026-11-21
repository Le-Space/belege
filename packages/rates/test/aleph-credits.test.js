// SPDX-License-Identifier: AGPL-3.0-or-later
// The euro value of Aleph credits: the last purchase's USD price, else the
// list price; credits × USD × EUR/USD to the cent, without floats.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ALEPH_LIST_PRICE_USD,
	alephCreditPrice,
	alephCreditsInEur,
	alephPurchase,
	plain
} from '../src/aleph-credits.js';

test('the price of a day: the last purchase on or before it, else the list price', () => {
	const priceOn = alephCreditPrice([
		{ time: '2026-08-10T12:00:00Z', usdPerCredit: '0.0000015' },
		{ time: '2026-07-20T08:00:00Z', usdPerCredit: '0.000002' },
		{ time: '2026-08-01T00:00:00Z', usdPerCredit: null }
	]);
	assert.deepEqual(priceOn('2026-07-19'), { usdPerCredit: ALEPH_LIST_PRICE_USD, source: 'list' });
	assert.deepEqual(priceOn('2026-07-20'), { usdPerCredit: '0.000002', source: 'purchase' });
	assert.deepEqual(priceOn('2026-08-10'), { usdPerCredit: '0.0000015', source: 'purchase' });
	// From the rows themselves: a purchase in ALEPH never prices a credit at its token price.
	const fromRows = alephCreditPrice([
		{
			time: '2026-07-20T08:00:00Z',
			credits: 1_200_000,
			bonus: 200_000,
			price: '0.00008',
			token: 'ALEPH'
		},
		{ time: '2026-07-01T08:00:00Z', price: '0.00008' }
	]);
	assert.deepEqual(fromRows('2026-07-10'), { usdPerCredit: ALEPH_LIST_PRICE_USD, source: 'list' });
	assert.deepEqual(fromRows('2026-07-20'), { usdPerCredit: '0.000000833333', source: 'purchase' });
});

test('a purchase row in dollars: the price is in the payment token, not in dollars', () => {
	// Paid in ALEPH: 1,200,000 credits came in, 200,000 of them the bonus, at 0.00008 ALEPH
	// per credit paid for. 80 ALEPH were paid; the credits paid for cost 1 USD at the list price.
	assert.deepEqual(
		alephPurchase({ credits: 1_200_000, bonus: 200_000, price: '0.00008', token: 'ALEPH' }),
		{
			paidCredits: '1000000',
			tokenAmount: '80',
			token: 'ALEPH',
			usd: '1',
			usdPerCredit: '0.000000833333',
			basis: 'list'
		}
	);
	// The old reading, credits × price as dollars, would have said 96 USD.
	// Paid in a dollar token: the price is the dollar price, a discount included.
	assert.deepEqual(alephPurchase({ credits: 2_000_000, price: '0.0000009', token: 'USDC' }), {
		paidCredits: '2000000',
		tokenAmount: '1.8',
		token: 'USDC',
		usd: '1.8',
		usdPerCredit: '0.0000009',
		basis: 'price'
	});
	// A "dollar" price far from the list price is not believed, whatever the token says.
	assert.equal(alephPurchase({ credits: 1_000_000, price: '0.00009', token: 'USDC' })?.usd, '1');
	assert.equal(alephPurchase({ credits: 1_000_000, price: '0.00009' })?.basis, 'list');
	// Without a price, or a bonus that cannot be: the list price on all credits.
	assert.equal(alephPurchase({ credits: 500_000 })?.usd, '0.5');
	assert.equal(alephPurchase({ credits: 500_000, bonus: 500_000 })?.paidCredits, '500000');
	assert.equal(alephPurchase({ credits: 0, price: '0.000001' }), null);
});

test('credits in euros, rounded half away from zero to the cent', () => {
	assert.equal(alephCreditsInEur(1_000_000_000, '0.000002', '0.9'), '1800');
	assert.equal(alephCreditsInEur(2000, '0.000002', '0.9'), '0');
	assert.equal(alephCreditsInEur(2778, '0.000002', '0.9'), '0.01');
	assert.equal(alephCreditsInEur('2777', '0.000002', '0.9'), '0');
});

test('plain decimals, never an exponent', () => {
	assert.equal(plain(1e-7), '0.0000001');
	assert.equal(plain(12.5), '12.5');
	assert.equal(plain('0.000002'), '0.000002');
	assert.throws(() => plain('x'));
});
