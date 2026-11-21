// SPDX-License-Identifier: AGPL-3.0-or-later
// A call sealed above the connection (seal.js): in Node, and the same bytes
// in Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

import scenario from './browser/seal-scenario.js';

const REFUSED = {
	otherKey: 'SealError',
	otherCommand: 'SealError',
	otherPeer: 'SealError',
	changed: 'SealError',
	unsealed: 'SealError',
	short: 'SealError',
	otherCall: 'SealError',
	callAsAnswer: 'SealError',
	shortKey: 'SealError',
	noContext: 'SealError'
};

/** @param {Awaited<ReturnType<typeof scenario>>} r */
function check(r) {
	assert.deepEqual(r.args, { text: 'Rechnung Übung', days: 14 });
	assert.deepEqual(r.back, {
		status: 200,
		contentType: 'application/json',
		json: { found: 2 }
	});
	assert.ok(r.sealed);
	assert.ok(r.fresh, 'a nonce of its own per call');
	assert.ok(r.fits, 'sealedSize covers what travels');
	assert.equal(r.plaintext, false);
	assert.deepEqual(r.refused, REFUSED);
	// A fixed vector: a change of the layout shows here.
	assert.equal(r.sent.length, 128);
	assert.equal(r.handover.length, 44);
}

test('a call and its answer are sealed for these peers, this command and this call', async () => {
	check(await scenario());
});

test('the seal is the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/seal-scenario.js', import.meta.url));
	if (!r) return;
	check(r);
	const here = await scenario();
	assert.equal(r.sent, here.sent);
	assert.equal(r.answer, here.answer);
	assert.equal(r.handover, here.handover);
});
