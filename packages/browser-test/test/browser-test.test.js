// SPDX-License-Identifier: AGPL-3.0-or-later
// The helper itself: a scenario that runs anywhere passes; one that imports
// a Node built-in or uses Buffer fails in Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';

import { bundleForBrowser, runInChromium, sameInChromium } from '../src/index.js';

const fixture = (/** @type {string} */ name) => new URL(`./fixtures/${name}`, import.meta.url);

test('the same result in Node and in Chromium passes', async (t) => {
	const r = await sameInChromium(t, fixture('plain.js'));
	if (r) assert.deepEqual(r, { hex: ['78'] });
});

/** The error a scenario fails with in Chromium; null when there is no Chromium here. */
async function failure(/** @type {string} */ name) {
	try {
		const r = await runInChromium(fixture(name));
		if ('skipped' in r) return null;
	} catch (e) {
		return String(/** @type {Error} */ (e).message);
	}
	assert.fail(`${name} ran in Chromium`);
}

test('a node: import fails the browser build', async (t) => {
	const message = await failure('node-import.js');
	if (message === null) return t.skip('no Chromium');
	assert.match(message, /Node-only import.*node:crypto/s);
});

test('Buffer fails in the page', async (t) => {
	const message = await failure('buffer.js');
	if (message === null) return t.skip('no Chromium');
	assert.match(message, /Buffer is not defined/);
});

test('bundleForBrowser gives the code a browser app would ship', async () => {
	const code = await bundleForBrowser([fileURLToPath(fixture('plain.js'))]);
	assert.match(code, /export/);
	await assert.rejects(
		bundleForBrowser([fileURLToPath(fixture('node-import.js'))]),
		/Node-only import/
	);
});
