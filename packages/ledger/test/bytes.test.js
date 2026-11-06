// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromBase64, fromHex, fromUtf8, toBase64, toHex, utf8 } from '../src/bytes.js';

test('base64, hex and UTF-8 match what Node Buffer gives, without Buffer', () => {
	const samples = [
		'',
		'a',
		'ab',
		'abc',
		'Überweisung €',
		JSON.stringify({ account_id: 'wolkenfabrik.near' })
	];
	for (const s of samples) {
		const b64 = Buffer.from(s).toString('base64');
		assert.equal(toBase64(utf8(s)), b64);
		assert.equal(fromUtf8(fromBase64(b64)), s);
		assert.equal(toHex(utf8(s)), Buffer.from(s).toString('hex'));
	}
	// As lenient as Buffer: no padding, URL-safe alphabet, stray whitespace.
	for (const odd of ['YWJj', 'YWI', 'YQ', 'Pz8_', 'Pz8-', 'YW Jj\n', 'YWJj==='])
		assert.deepEqual(fromBase64(odd), new Uint8Array(Buffer.from(odd, 'base64')), odd);
	assert.deepEqual(fromHex('00FFa0'), new Uint8Array([0, 255, 160]));
	assert.throws(() => fromHex('abc'));
	const big = new Uint8Array(100_000).map((_, i) => i % 256);
	assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});
