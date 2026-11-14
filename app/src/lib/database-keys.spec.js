// Replaces Le-Space/simple-todo apps/invoice01 (src/lib/database-keys.spec.js) at 56647d5,
// whose subject (a random key in local storage) belege does not have.
import { describe, expect, it } from 'vitest';

import { newKey, sealer } from './db-encryption.js';
import {
	DB_KEY_INFO,
	bridgeAuthKeyOf,
	deriveBlobKey,
	deriveBridgeAuthBase,
	deriveDatabaseKey,
	deriveDatabaseName,
	deriveDeviceAuthKey,
	deriveImagePassphrase
} from './database-keys.js';

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

	it('gives the bridge a key of its own: not the device key, new with each generation', async () => {
		const output = prf();
		const base = await deriveBridgeAuthBase(output);
		const one = await bridgeAuthKeyOf(base, 1);
		const again = await bridgeAuthKeyOf(await deriveBridgeAuthBase(Uint8Array.from(output)), 1);
		const two = await bridgeAuthKeyOf(base, 2);
		expect(hex(again)).toBe(hex(one));
		expect(hex(two)).not.toBe(hex(one));
		expect(hex(one)).not.toBe(hex(await deriveDeviceAuthKey(output)));
		expect(hex(base)).not.toBe(hex(one));
		await expect(bridgeAuthKeyOf(base, 0)).rejects.toThrow(/generation/);
		await expect(bridgeAuthKeyOf(new Uint8Array(3), 1)).rejects.toThrow(/32 bytes/);
	});

	it('derives the receipt-file key under its own info string: fixed, and not the database key', async () => {
		// Node: crypto.hkdfSync(sha256, 32 × 0x07, empty salt, "belege/blob-key/v1", 32).
		const output = new Uint8Array(32).fill(7);
		const blob = hex(await deriveBlobKey(output));
		expect(blob).toBe('cff696c08bd035566a96fc18e80679a6bb0875a7fbef13840e7665c2a816f360');
		expect(blob).not.toBe(hex(await deriveDatabaseKey(output)));
		await expect(deriveBlobKey(new Uint8Array(8))).rejects.toThrow(/PRF output/);
	});

	it('derives the image passphrase per books and per plain image, the same at every unlock (#777)', async () => {
		const image = 'ab'.repeat(32);
		// Node: crypto.hkdfSync(sha256, 32 × 0x07, empty salt,
		// "belege/image-passphrase/v1/" + image, 32), base64url.
		const root = new Uint8Array(32).fill(7);
		const passphrase = await deriveImagePassphrase(root, image);
		expect(passphrase).toBe('ffsaLLCeg6t2oUtzh4nnFL1dS9Ah1iLTluCS9vxAulU');
		// What goes to cryptsetup and into a signed injection: one line, URL-safe.
		expect(passphrase).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await deriveImagePassphrase(Uint8Array.from(root), image)).toBe(passphrase);

		// Other books, and the same books after new keys, have another root.
		const others = new Set([passphrase]);
		for (let i = 0; i < 8; i++) others.add(await deriveImagePassphrase(prf(), image));
		expect(others.size).toBe(9);
		// Another plain image is sealed with another passphrase.
		expect(await deriveImagePassphrase(root, 'cd'.repeat(32))).not.toBe(passphrase);
	});

	it('gives the image passphrase a label of its own: no other key of the books is it', async () => {
		const root = prf();
		const image = 'ab'.repeat(32);
		const bytes = Buffer.from(await deriveImagePassphrase(root, image), 'base64url');
		expect(bytes).toHaveLength(32);
		const base = await deriveBridgeAuthBase(root);
		for (const other of [
			await deriveDatabaseKey(root),
			await deriveBlobKey(root),
			await deriveDeviceAuthKey(root),
			base,
			await bridgeAuthKeyOf(base, 1)
		]) {
			expect(hex(bytes)).not.toBe(hex(other));
		}
	});

	it('refuses an image passphrase without the books’ root or the plain image’s SHA-256', async () => {
		const root = prf();
		await expect(deriveImagePassphrase(new Uint8Array(8), 'ab'.repeat(32))).rejects.toThrow(
			/PRF output/
		);
		for (const not of ['', 'latest', 'AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(32)}/x`]) {
			await expect(deriveImagePassphrase(root, not)).rejects.toThrow(/SHA-256/);
		}
		await expect(deriveImagePassphrase(root, /** @type {any} */ (undefined))).rejects.toThrow(
			/SHA-256/
		);
	});
});
