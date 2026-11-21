// SPDX-License-Identifier: AGPL-3.0-or-later
// The charts run the same in Chromium as in Node: the same series, the same SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('series, shapes and SVG are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.equal(r.balance.points.at(-1).value, '28.249553634874999999999999');
	assert.equal(r.usage.series.length, 2);
	assert.match(r.line, /^<svg /);
	assert.match(r.bars, /<rect class="f-s2"/);
});
