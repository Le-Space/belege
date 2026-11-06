// SPDX-License-Identifier: AGPL-3.0-or-later
// The euro value of Aleph credits: the last purchase's USD price, else the
// list price; credits × USD × EUR/USD to the cent, without floats.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ALEPH_LIST_PRICE_USD,
	alephCreditPrice,
	alephCreditsInEur,
	plain
} from '../src/aleph-credits.js';

test('the price of a day: the last purchase on or before it, else the list price', () => {
	const priceOn = alephCreditPrice([
		{ time: '2026-08-10T12:00:00Z', price: '0.0000015' },
		{ time: '2026-07-20T08:00:00Z', price: '0.000002' },
		{ time: '2026-08-01T00:00:00Z', price: null }
	]);
	assert.deepEqual(priceOn('2026-07-19'), { usdPerCredit: ALEPH_LIST_PRICE_USD, source: 'list' });
	assert.deepEqual(priceOn('2026-07-20'), { usdPerCredit: '0.000002', source: 'purchase' });
	assert.deepEqual(priceOn('2026-08-10'), { usdPerCredit: '0.0000015', source: 'purchase' });
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
