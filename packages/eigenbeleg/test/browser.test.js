// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbelege, the Kontoauszug, the Verbrauchsauszug, the Eigenbeleg of a
// booking and a statement are the same files in Chromium as in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('every document is the same file in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.deepEqual(Object.keys(r.pdfs), [
		'eigenbeleg-collective.pdf',
		'eigenbeleg-single.pdf',
		'kontoauszug.pdf',
		'verbrauchsauszug.pdf',
		'booking-wallet.pdf',
		'booking-bank.pdf',
		'statement-sheet.pdf'
	]);
	assert.match(r.csv, /^[0-9a-f]{64}$/);
});
