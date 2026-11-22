// SPDX-License-Identifier: AGPL-3.0-or-later
// A token not in the chain's list is valued by its contract (#93): only through
// the caller's `tokenRateFor`, asked by contract, chain, block and decimals,
// never by the symbol it calls itself. Made-up addresses and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixedRates, valueEntries } from '../src/index.js';
import { XYZ, tokenEntries } from './support/token-entries.js';

test('a token by its contract: valued with the rate of its day, the contract named in the source', async () => {
	const valued = await valueEntries(
		tokenEntries(),
		fixedRates({ ETH: '3000', [`${XYZ}:2026-10-05`]: '0.02', [`${XYZ}:2026-10-06`]: '0.025' })
	);
	assert.deepEqual(
		valued.map((v) => v.eur?.value ?? null),
		['-1500', '-2', '1', null, null],
		'ETH by its symbol, XYZ by its contract and day; a failed send and a denom without a contract unvalued'
	);
	assert.equal(valued[1].eur?.source, `fester Testkurs (Token-Vertrag ${XYZ})`);
});

test('what the caller is asked: contract, chain, block and decimals – never the symbol as a market asset', async () => {
	/** @type {any[]} */
	const asked = [];
	/** @type {string[]} */
	const assets = [];
	await valueEntries(tokenEntries(), {
		rateFor: async (asset) => {
			assets.push(asset);
			return null;
		},
		tokenRateFor: async (token, date) => {
			asked.push({ ...token, date });
			return null;
		}
	});
	assert.deepEqual(assets, ['ETH']);
	assert.deepEqual(asked, [
		{
			asset: 'XYZ',
			contract: XYZ,
			chain: 'ethereum',
			block: 1200,
			decimals: 18,
			date: '2026-10-05'
		},
		{
			asset: 'XYZ',
			contract: XYZ,
			chain: 'ethereum',
			block: 1000,
			decimals: 18,
			date: '2026-10-06'
		}
	]);
});

test('without tokenRateFor a token stays unvalued, as before', async () => {
	const valued = await valueEntries(tokenEntries(), { rateFor: async () => null });
	assert.ok(valued.every((v) => v.eur === null));
});

test('a token rate in another currency than the document’s is refused', async () => {
	await assert.rejects(
		valueEntries(tokenEntries().slice(1, 2), {
			rateFor: async () => null,
			tokenRateFor: async (_t, date) => ({ rate: '1', source: 'x', date, currency: 'CHF' })
		}),
		/a rate in CHF for a document in EUR/
	);
});
