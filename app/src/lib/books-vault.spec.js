// The books' vault (#406): the first unlock puts today's root into a vault
// unchanged; a second passkey's slot opens the same root; a removed passkey is
// refused and gets no new books; a renewal keeps the root and drops the slot;
// a record found elsewhere is kept and opened; an unreadable store is an
// error, never overwritten. Made-up bytes.
import { describe, expect, it } from 'vitest';

import {
	RemovedPasskeyError,
	VAULTS_STORAGE_KEY,
	VaultStorageError,
	addPasskey,
	loadVaultRecords,
	openBooksVault,
	removePasskey,
	renewBooksVault
} from './books-vault.js';

const bytes = (/** @type {number} */ n, /** @type {number} */ fill) => new Uint8Array(n).fill(fill);
const A = {
	prfOutput: bytes(32, 1),
	rawCredentialId: bytes(16, 0xa1),
	credentialId: 'cred-a',
	label: 'Laptop'
};
const B = {
	prfOutput: bytes(32, 2),
	rawCredentialId: bytes(16, 0xb2),
	credentialId: 'cred-b',
	label: 'YubiKey'
};
const C = {
	prfOutput: bytes(32, 3),
	rawCredentialId: bytes(16, 0xc3),
	credentialId: 'cred-c',
	label: 'Telefon'
};

function memoryStorage() {
	/** @type {Map<string, string>} */
	const map = new Map();
	return {
		map,
		getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
		removeItem: (/** @type {string} */ k) => void map.delete(k)
	};
}

describe('the books’ vault', () => {
	it('the first unlock keeps today’s root – the PRF output – in a new vault', async () => {
		const storage = memoryStorage();
		const first = await openBooksVault({ ...A, storage });
		expect(first.created).toBe(true);
		expect(first.root).toEqual(A.prfOutput);
		expect(first.record.slots.map((s) => s.label)).toEqual(['Laptop']);
		// Nothing secret in the clear.
		const stored = /** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY));
		expect(stored).not.toContain(Buffer.from(A.prfOutput).toString('hex'));
		const again = await openBooksVault({ ...A, storage });
		expect(again.created).toBe(false);
		expect(again.root).toEqual(A.prfOutput);
	});

	it('a second passkey’s slot opens the same root', async () => {
		const storage = memoryStorage();
		const opened = await addPasskey(await openBooksVault({ ...A, storage }), B, storage);
		expect(opened.record.slots.map((s) => s.label)).toEqual(['Laptop', 'YubiKey']);
		const withB = await openBooksVault({ ...B, storage });
		expect(withB.created).toBe(false);
		expect(withB.root).toEqual(A.prfOutput);
	});

	it('a passkey that never had a slot gets books of its own, as before', async () => {
		const storage = memoryStorage();
		await openBooksVault({ ...A, storage });
		const other = await openBooksVault({ ...C, storage });
		expect(other.created).toBe(true);
		expect(other.root).toEqual(C.prfOutput);
		expect(loadVaultRecords(storage)).toHaveLength(2);
	});

	it('a removed passkey is refused, and not given new books', async () => {
		const storage = memoryStorage();
		const withB = await addPasskey(await openBooksVault({ ...A, storage }), B, storage);
		const removed = removePasskey(withB, withB.record.slots[1].kid, storage);
		expect(removed.record.vault.slots).toHaveLength(1);
		await expect(openBooksVault({ ...B, storage })).rejects.toBeInstanceOf(RemovedPasskeyError);
		expect(loadVaultRecords(storage)).toHaveLength(1);
		// Added again later: it opens again.
		const back = await addPasskey(await openBooksVault({ ...A, storage }), B, storage);
		expect(back.record.removed).toEqual([]);
		expect((await openBooksVault({ ...B, storage })).root).toEqual(A.prfOutput);
	});

	it('a renewal keeps the root, gives a new vault key and drops the slot', async () => {
		const storage = memoryStorage();
		let opened = await openBooksVault({ ...A, storage });
		opened = await addPasskey(opened, B, storage);
		opened = await addPasskey(opened, C, storage);
		const oldRecord = structuredClone(opened.record);
		const kidC = opened.record.slots[2].kid;
		const renewed = await renewBooksVault(opened, [A, B], [kidC], storage);
		expect(renewed.vaultKey).not.toEqual(opened.vaultKey);
		expect(renewed.record.vault.id).not.toBe(oldRecord.vault.id);
		expect(renewed.record.slots.map((s) => s.label)).toEqual(['Laptop', 'YubiKey']);
		expect(loadVaultRecords(storage)).toHaveLength(1);
		expect((await openBooksVault({ ...B, storage })).root).toEqual(A.prfOutput);
		await expect(openBooksVault({ ...C, storage })).rejects.toBeInstanceOf(RemovedPasskeyError);
	});

	it('a record found elsewhere (the index on an empty device) is kept and opened', async () => {
		const made = memoryStorage();
		const withB = await addPasskey(await openBooksVault({ ...A, storage: made }), B, made);
		const empty = memoryStorage();
		/** @type {string[]} */
		const asked = [];
		const opened = await openBooksVault({
			...B,
			storage: empty,
			find: async (kid) => {
				asked.push(kid);
				return withB.record;
			}
		});
		expect(asked).toHaveLength(1);
		expect(opened.created).toBe(false);
		expect(opened.root).toEqual(A.prfOutput);
		expect(loadVaultRecords(empty)).toHaveLength(1);
	});

	it('a record that names another passkey is not taken from elsewhere', async () => {
		const made = memoryStorage();
		const onlyA = await openBooksVault({ ...A, storage: made });
		const opened = await openBooksVault({
			...C,
			storage: memoryStorage(),
			find: async () => onlyA.record
		});
		expect(opened.created).toBe(true);
		expect(opened.root).toEqual(C.prfOutput);
	});

	it('an unreadable store is an error, and stays as it is', async () => {
		const storage = memoryStorage();
		storage.setItem(VAULTS_STORAGE_KEY, '{not json');
		await expect(openBooksVault({ ...A, storage })).rejects.toBeInstanceOf(VaultStorageError);
		expect(storage.getItem(VAULTS_STORAGE_KEY)).toBe('{not json');
	});

	it('the wrong PRF output for a slot does not open it', async () => {
		const storage = memoryStorage();
		await openBooksVault({ ...A, storage });
		await expect(openBooksVault({ ...A, prfOutput: bytes(32, 9), storage })).rejects.toThrow();
	});
});
