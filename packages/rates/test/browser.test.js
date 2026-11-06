// SPDX-License-Identifier: AGPL-3.0-or-later
// The day's rate runs the same in Chromium as in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('rates from every kind of source are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.deepEqual(
		[r.akt.rate, r.akt.source, r.btc.rate, r.btc.source, r.usd.rate, r.rub.rate, r.rub.source],
		['3.5', 'coingecko', '51000.1', 'kraken', '0.8', '0.01', 'cbr']
	);
	assert.deepEqual(r.keys, ['demo-key-for-tests']);
	assert.match(r.pool, /^0x[0-9a-f]{64}$/);
});
