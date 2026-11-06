// SPDX-License-Identifier: AGPL-3.0-or-later
// The ledger runs the same in Chromium as in Node (no Buffer, no node:).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('bytes, decimals and entries are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.equal(r.back, 'Wolkenfabrik Hosting GmbH – Überweisung €');
	assert.deepEqual(r.lenient, [97, 98, 99]);
	assert.equal(r.eur, '-0.48');
	assert.deepEqual(r.order, ['filecoin:f1own:H1:m0:e0.0:FIL', 'filecoin:f1own:H1:fee']);
});
