// SPDX-License-Identifier: AGPL-3.0-or-later
// The fonts and PDF/A run the same in Chromium as in Node: the same file,
// byte for byte (fonts fetched there, read from disk here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('a PDF/A page in any script is the same file in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.match(r.sha256, /^[0-9a-f]{64}$/);
	assert.ok(r.length > 5_000 && r.length < 200_000, `${r.length} bytes`);
	assert.equal(r.text, 'ab c');
	assert.deepEqual(r.structure.pdfaid, { part: '2', conformance: 'B' });
	assert.ok(r.structure.embeddedFonts >= 3);
	assert.deepEqual(r.structure.standardFonts, []);
	assert.equal(r.structure.images.length, 1, "the chain's mark");
});
