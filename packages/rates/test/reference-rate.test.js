// SPDX-License-Identifier: AGPL-3.0-or-later
// A reference value for an asset nobody quotes: the last line on or before the
// day, a source that says what it is, and never a public feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RATE_SOURCES, referenceRate, withReferenceRates } from '../src/index.js';

const TABLE = [
	{ from: '2026-09-01', eur: '0.05', by: 'Wolkenfabrik Hosting GmbH' },
	{ from: '2026-03-01', eur: '0.02' }
];

test('the value of a day is the last line on or before it; before the first there is none', () => {
	const valueOn = referenceRate(TABLE);
	assert.equal(valueOn('2026-02-28'), null);
	assert.equal(valueOn('2026-03-01')?.rate, '0.02');
	assert.equal(valueOn('2026-08-31')?.rate, '0.02');
	assert.equal(valueOn('2026-09-01')?.rate, '0.05');
	assert.equal(valueOn('2027-01-15')?.rate, '0.05');
	assert.equal(valueOn('2027-01-15')?.date, '2027-01-15');
});

test('the source names it a reference value, who set it and since when', () => {
	const valueOn = referenceRate(TABLE);
	assert.equal(
		valueOn('2026-10-13')?.source,
		'Referenzwert von Wolkenfabrik Hosting GmbH, Stand 2026-09-01 (kein Börsenkurs)'
	);
	assert.equal(
		valueOn('2026-04-01')?.source,
		'Referenzwert des Ausstellers, Stand 2026-03-01 (kein Börsenkurs)'
	);
});

test('a line needs a day and a positive decimal string', () => {
	for (const bad of [
		{ from: '2026-13-01', eur: '0.02' },
		{ from: '01.03.2026', eur: '0.02' },
		{ from: '2026-03-01', eur: '0' },
		{ from: '2026-03-01', eur: '4e-2' },
		{ from: '2026-03-01', eur: /** @type {any} */ (0.02) }
	])
		assert.throws(() => referenceRate([bad]), /reference value/);
	assert.equal(referenceRate([])('2026-10-13'), null);
});

test('an asset with a table never reaches another source, also on a day without a line', async () => {
	/** @type {[string, string][]} */
	const asked = [];
	const inner = {
		async rateFor(/** @type {string} */ asset, /** @type {string} */ date) {
			asked.push([asset, date]);
			return { rate: '99', source: 'a public feed', date };
		}
	};
	const rates = withReferenceRates(inner, { DOI: TABLE });
	assert.equal((await rates.rateFor('DOI', '2026-10-13'))?.rate, '0.05');
	assert.equal(await rates.rateFor('DOI', '2026-01-01'), null);
	assert.deepEqual(asked, []);
	assert.equal((await rates.rateFor('USD', '2026-10-13'))?.source, 'a public feed');
	assert.deepEqual(asked, [['USD', '2026-10-13']]);
});

test('the inner source’s other methods stay: a token by its contract (#93)', async () => {
	const inner = {
		rateFor: async () => null,
		tokenRateFor: async (/** @type {{ contract: string }} */ t, /** @type {string} */ date) => ({
			rate: '0.02',
			source: `by ${t.contract}`,
			date
		})
	};
	const rates = withReferenceRates(inner, { DOI: TABLE });
	const contract = `0x${'5e'.repeat(20)}`;
	assert.equal((await rates.tokenRateFor({ contract }, '2026-10-13'))?.source, `by ${contract}`);
});

test('the rate service itself has no source for DOI', () => {
	assert.equal(Object.hasOwn(RATE_SOURCES, 'DOI'), false);
});
