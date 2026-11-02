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
	addRecoveryWords,
	adoptNewerVault,
	hasRecoveryWords,
	newerWithWords,
	openWithWords,
	removeRecoveryWords,
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

	it('takes a newer record of the same books, and refuses when it removed this passkey', async () => {
		const here = memoryStorage();
		const elsewhere = memoryStorage();
		// The same books on two browsers: A here; elsewhere A added B, then C.
		const openedHere = await openBooksVault({ ...A, storage: here });
		elsewhere.setItem(VAULTS_STORAGE_KEY, here.getItem(VAULTS_STORAGE_KEY) ?? '');
		let there = await openBooksVault({ ...A, storage: elsewhere });
		there = await addPasskey(there, B, elsewhere);
		const adopted = await adoptNewerVault(openedHere, there.record.vault, A, here, [
			{ kid: there.record.slots[1].kid, label: '', credentialId: 'cred-b', addedAt: '' }
		]);
		expect(adopted.record.vault.slots).toHaveLength(2);
		expect(adopted.record.slots.map((s) => s.credentialId)).toEqual(['cred-a', 'cred-b']);
		expect(adopted.root).toEqual(A.prfOutput);
		// Elsewhere A was taken out: the newer record says so, and A is refused here too.
		const withoutA = removePasskey(
			{ ...there, kid: there.record.slots[1].kid },
			there.record.slots[0].kid,
			elsewhere
		);
		await expect(adoptNewerVault(adopted, withoutA.record.vault, A, here)).rejects.toBeInstanceOf(
			RemovedPasskeyError
		);
		await expect(openBooksVault({ ...A, storage: here })).rejects.toBeInstanceOf(
			RemovedPasskeyError
		);
	});
});

describe('recovery words in the vault (stage 2)', () => {
	const SEED = bytes(64, 0x5e);
	const OTHER = bytes(64, 0x6f);

	it('a words slot opens the same root without any passkey, and a new passkey gets its slot', async () => {
		const storage = memoryStorage();
		const opened = await addRecoveryWords(await openBooksVault({ ...A, storage }), SEED, storage);
		expect(await hasRecoveryWords(opened.record)).toBe(true);
		expect(opened.record.slots.find((s) => s.kind === 'words')?.label).toBe('');
		// Nothing of the seed in what is kept.
		expect(storage.getItem(VAULTS_STORAGE_KEY)).not.toContain(Buffer.from(SEED).toString('hex'));

		// An empty device: the record comes from elsewhere (the index), the words open it.
		const empty = memoryStorage();
		const withWords = await openWithWords({
			seed: SEED,
			storage: empty,
			find: async () => opened.record
		});
		expect(withWords?.found).toBe(true);
		expect(withWords?.root).toEqual(A.prfOutput);
		// Kept nowhere until a passkey has its slot; then C opens the same books.
		expect(empty.getItem(VAULTS_STORAGE_KEY)).toBeNull();
		await addPasskey(/** @type {any} */ (withWords), C, empty);
		const withC = await openBooksVault({ ...C, storage: empty });
		expect(withC.root).toEqual(A.prfOutput);
		expect(withC.created).toBe(false);
	});

	it('wrong words do not open it; without a words slot there is nothing to open', async () => {
		const storage = memoryStorage();
		const opened = await openBooksVault({ ...A, storage });
		expect(await openWithWords({ seed: SEED, storage })).toBeNull();
		await addRecoveryWords(opened, SEED, storage);
		await expect(openWithWords({ seed: OTHER, storage })).rejects.toThrow();
	});

	it('new words replace the old; taken out, they open nothing', async () => {
		const storage = memoryStorage();
		let opened = await addRecoveryWords(await openBooksVault({ ...A, storage }), SEED, storage);
		opened = await addRecoveryWords(opened, OTHER, storage);
		expect(opened.record.vault.slots).toHaveLength(2);
		await expect(openWithWords({ seed: SEED, storage })).rejects.toThrow();
		expect((await openWithWords({ seed: OTHER, storage }))?.root).toEqual(A.prfOutput);
		opened = await removeRecoveryWords(opened, storage);
		expect(await hasRecoveryWords(opened.record)).toBe(false);
		expect(await openWithWords({ seed: OTHER, storage })).toBeNull();
	});

	it('a newer record of the same books is taken when the words are still in it', async () => {
		const storage = memoryStorage();
		const opened = await addRecoveryWords(await openBooksVault({ ...A, storage }), SEED, storage);
		const older = /** @type {any} */ (await openWithWords({ seed: SEED, storage }));
		const newer = await addPasskey(opened, B, storage);
		const taken = await newerWithWords(older, newer.record.vault, SEED, [
			{ kid: newer.record.slots[1].kid, label: '', credentialId: 'cred-b', addedAt: '' }
		]);
		expect(taken.record.vault.slots).toHaveLength(3);
		expect(taken.record.slots.map((s) => s.credentialId)).toEqual(['cred-b']);
		// Without the words in it, the one opened stays.
		const withoutWords = await removeRecoveryWords(newer, storage);
		expect((await newerWithWords(older, withoutWords.record.vault, SEED)).record).toBe(
			older.record
		);
	});
});
