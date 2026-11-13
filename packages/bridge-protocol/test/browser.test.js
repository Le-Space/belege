// SPDX-License-Identifier: AGPL-3.0-or-later
// The bridge's catalogue runs the same in Chromium as in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('checks and the HTTP mapping are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.deepEqual(r.good, []);
	assert.deepEqual(r.bad, ['since: not in the expected form', 'extra: not expected']);
	assert.equal(r.path, '/mail/search?text=Rechnung&term=Abo&term=%C3%9Cbung&days=14');
	assert.equal(r.query, 'Übung');
	assert.ok(r.commands > 40);
});
