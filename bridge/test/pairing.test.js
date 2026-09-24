import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPairing, hashToken } from '../src/pairing.js';

function setup(/** @type {Partial<Parameters<typeof createPairing>[0]>} */ options = {}) {
	/** @type {{ hash: string, createdAt: string }[]} */
	let hashes = [];
	const pairing = createPairing({
		getHashes: () => hashes,
		saveHashes: async (h) => {
			hashes = h;
		},
		...options
	});
	return { pairing, hashes: () => hashes };
}

test('a code pairs once; the token verifies, its hash is what is kept', async () => {
	const { pairing, hashes } = setup();
	const code = pairing.issueCode();
	const token = await pairing.pair(code.replace('-', ' '));
	assert.equal(pairing.verify(token), true);
	assert.equal(pairing.verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), false);
	assert.equal(pairing.verify(''), false);
	assert.equal(pairing.verify(null), false);
	assert.deepEqual(
		hashes().map((h) => h.hash),
		[hashToken(token)]
	);
	await assert.rejects(pairing.pair(code), /No pairing code/);
});

test('five wrong tries kill the code', async () => {
	const { pairing } = setup();
	const code = pairing.issueCode();
	for (let i = 0; i < 5; i++) await assert.rejects(pairing.pair('AAAA-AAAA'), /Wrong pairing code/);
	await assert.rejects(pairing.pair(code), /No pairing code/);
});

test('a code expires', async () => {
	let now = 1_000_000;
	const { pairing } = setup({ now: () => now, ttlMs: 1000 });
	const code = pairing.issueCode();
	assert.equal(pairing.hasPendingCode(), true);
	now += 1001;
	assert.equal(pairing.hasPendingCode(), false);
	await assert.rejects(pairing.pair(code), /No pairing code/);
});
