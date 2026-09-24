// Replaces Le-Space/simple-todo apps/invoice01 (src/lib/database-keys.spec.js) at 56647d5,
// whose subject (a random key in local storage) belege does not have.
import { describe, expect, it } from 'vitest';

import { newKey, sealer } from './db-encryption.js';
import { DB_KEY_INFO, deriveDatabaseKey, deriveDatabaseName } from './database-keys.js';

const prf = () => crypto.getRandomValues(new Uint8Array(32));
const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');

describe('database-keys', () => {
	it('derives the same key from the same PRF output, which is what survives a reload', async () => {
		const output = prf();

		const first = await deriveDatabaseKey(output);
		const second = await deriveDatabaseKey(Uint8Array.from(output));

		expect(first).toHaveLength(32);
		expect(hex(second)).toBe(hex(first));
	});

	it('matches a fixed vector, so a refactor cannot rotate every key unnoticed', async () => {
		// A changed derivation locks every user out of their books. This value was
		// computed independently with Node's crypto.hkdfSync(sha256, 32 × 0x07, empty salt, "belege/db-key/v1").
		const output = new Uint8Array(32).fill(7);

		expect(hex(await deriveDatabaseKey(output))).toBe(
			'a9970873f51baae8442673cb20b01ee4e43255ddafc4f3cdec08deb1c5bb6770'
		);
	});

	it('derives a different key under a different info string', async () => {
		const output = prf();

		const current = await deriveDatabaseKey(output, DB_KEY_INFO);
		const other = await deriveDatabaseKey(output, 'belege/db-key/v2');

		expect(hex(other)).not.toBe(hex(current));
	});

	it('derives a different key from a different passkey', async () => {
		expect(hex(await deriveDatabaseKey(prf()))).not.toBe(hex(await deriveDatabaseKey(prf())));
	});

	it('gives a key the sealer accepts, and only its own ciphertext opens', async () => {
		const key = await deriveDatabaseKey(prf());
		const sealed = await (await sealer(key)).seal(new TextEncoder().encode('Miete'));

		expect(new TextDecoder().decode(await (await sealer(key)).open(sealed))).toBe('Miete');
		await expect((await sealer(newKey())).open(sealed)).rejects.toThrow();
	});

	it('refuses something that is not a PRF output', async () => {
		await expect(deriveDatabaseKey(new Uint8Array(8))).rejects.toThrow(/PRF output/);
	});

	it('names databases per collection, stably, and without the key in them', async () => {
		const output = prf();
		const key = hex(await deriveDatabaseKey(output));

		const transactions = await deriveDatabaseName(output, 'transactions');
		const again = await deriveDatabaseName(Uint8Array.from(output), 'transactions');
		const receipts = await deriveDatabaseName(output, 'receipts');

		expect(transactions).toMatch(/^belege\.transactions\.[0-9a-f]{32}$/);
		expect(again).toBe(transactions);
		expect(receipts).not.toBe(transactions);
		expect(key).not.toContain(transactions.split('.')[2]);
	});
});
