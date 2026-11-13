// SPDX-License-Identifier: AGPL-3.0-or-later
// The cards and the subtitles run the same in Chromium as in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('cards and subtitles are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.equal(r.escaped, true);
	assert.equal(r.eyebrow, true);
	assert.deepEqual(r.times, ['01:02:03,004', 3723004]);
});
