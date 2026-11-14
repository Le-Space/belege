// SPDX-License-Identifier: AGPL-3.0-or-later
// A block answer (#578) runs the same in Chromium as in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

import scenario from './browser/blocks-scenario.js';

/** @param {any} r */
function expected(r) {
	assert.equal(r.ownProtocol, true);
	assert.equal(r.booksBitswap, false);
	assert.equal(r.blocks, 4);
	assert.equal(r.same, true);
	assert.equal(r.plaintextInBlocks, false);
	assert.equal(r.wrongKey, 'OperationError');
	assert.equal(r.badBlock, 'Error');
	assert.equal(r.fetched, true);
	assert.equal(r.size, 2_500_000);
	assert.equal(r.dropped, true);
	assert.equal(r.bridgeEmpty, true);
}

test('sealed, fetched over Bitswap on the bridge’s protocol, opened, dropped – in Node', async () => {
	expected(await scenario());
});

test('… and the same in Chromium', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/blocks-scenario.js', import.meta.url));
	if (r) expected(r);
});
