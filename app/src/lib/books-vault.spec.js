// The books' vault (#406): the first unlock puts today's root into a vault
// unchanged; a second passkey's slot opens the same root; a removed passkey is
// refused and gets no new books; a renewal keeps the root and drops the slot;
// a record found elsewhere is kept and opened; an unreadable store is an
// error, never overwritten. Made-up bytes.
import { describe, expect, it } from 'vitest';

import {
	NotInPublishedVaultError,
	PublishedVaultLacksPasskeyError,
	RemovedPasskeyError,
	RemovedWordsError,
	VAULTS_STORAGE_KEY,
	VaultStorageError,
	addPasskey,
	addRecoveryWords,
	adoptNewerVault,
	adoptSuccessorVault,
	convergeOnPublished,
	hasRecoveryWords,
	newerWithWords,
	openWithWords,
	removeRecoveryWords,
	loadVaultRecords,
	openBooksVault,
	otherBooks,
	removePasskey,
	rekeyBooksVault,
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
			{ kid: newer.record.slots[2].kid, label: '', credentialId: 'cred-b', addedAt: '' }
		]);
		expect(taken.record.vault.slots).toHaveLength(3);
		// What this browser knew stays; only B, new there, comes from what was published.
		expect(taken.record.slots.map((s) => s.credentialId)).toEqual(['cred-a', '', 'cred-b']);
		// Without the words in it they were taken out there: refused, like a removed passkey.
		const withoutWords = await removeRecoveryWords(newer, storage);
		await expect(newerWithWords(older, withoutWords.record.vault, SEED)).rejects.toBeInstanceOf(
			RemovedWordsError
		);
		// Replaced by new words: the old ones are refused as well.
		const renewed = await addRecoveryWords(newer, new Uint8Array(32).fill(7), storage);
		await expect(newerWithWords(older, renewed.record.vault, SEED)).rejects.toBeInstanceOf(
			RemovedWordsError
		);
	});
});

describe('recovery words with more than one set of books (#555)', () => {
	const SEED = bytes(64, 0x5e);
	const OTHER = bytes(64, 0x6f);

	it('a words unlock keeps what this browser knows: its removed passkeys and the slot names', async () => {
		const storage = memoryStorage();
		let opened = await addRecoveryWords(await openBooksVault({ ...A, storage }), SEED, storage);
		opened = await addPasskey(opened, B, storage);
		opened = removePasskey(
			opened,
			opened.record.slots.find((s) => s.label === 'YubiKey')?.kid ?? '',
			storage
		);
		const older = /** @type {any} */ (await openWithWords({ seed: SEED, storage }));
		// Elsewhere, C was added and the record published without names.
		const newer = await addPasskey(opened, C, memoryStorage());
		const published = newer.record.slots.map((s) => ({ ...s, label: '' }));
		const taken = await newerWithWords(older, newer.record.vault, SEED, published);
		expect(taken.record.removed).toEqual(opened.record.removed);
		expect(taken.record.removed).toHaveLength(1);
		expect(taken.record.slots.map((s) => s.label)).toEqual(['Laptop', '', '']);
		expect(taken.record.slots.map((s) => s.credentialId)).toEqual(['cred-a', '', 'cred-c']);
		// Kept as the new passkey's slot is added: B stays refused here.
		const D = {
			prfOutput: bytes(32, 4),
			rawCredentialId: bytes(16, 0xd4),
			credentialId: 'cred-d',
			label: 'Neu'
		};
		await addPasskey(taken, D, storage);
		await expect(openBooksVault({ ...B, storage })).rejects.toBeInstanceOf(RemovedPasskeyError);
	});

	it('the words of the second books in this browser are tried on each record, then elsewhere', async () => {
		const storage = memoryStorage();
		await addRecoveryWords(await openBooksVault({ ...A, storage }), SEED, storage);
		await addRecoveryWords(await openBooksVault({ ...C, storage }), OTHER, storage);
		expect((await openWithWords({ seed: SEED, storage }))?.root).toEqual(A.prfOutput);
		expect((await openWithWords({ seed: OTHER, storage }))?.root).toEqual(C.prfOutput);

		// Words of books this browser does not keep: past both records, to the index.
		const elsewhere = memoryStorage();
		const third = await addRecoveryWords(
			await openBooksVault({ ...B, storage: elsewhere }),
			bytes(64, 0x7a),
			elsewhere
		);
		const found = await openWithWords({
			seed: bytes(64, 0x7a),
			storage,
			find: async () => third.record
		});
		expect(found?.found).toBe(true);
		expect(found?.root).toEqual(B.prfOutput);
		// Words that open nothing anywhere are wrong words, as before.
		await expect(
			openWithWords({ seed: bytes(64, 0x01), storage, find: async () => third.record })
		).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
	});
});

describe('new keys for the books (#627)', () => {
	/** Books opened with A, with B and C added. */
	async function books() {
		const storage = memoryStorage();
		let opened = await openBooksVault({ ...A, storage });
		opened = await addPasskey(opened, B, storage);
		opened = await addPasskey(opened, C, storage);
		return { storage, opened };
	}
	const same = (/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b) =>
		a.length === b.length && a.every((x, i) => x === b[i]);

	it('a new root, the old one kept before it, a slot for each passkey that answered', async () => {
		const { storage, opened } = await books();
		const rekeyed = await rekeyBooksVault(opened, [A, B], storage);
		expect(same(rekeyed.root, opened.root)).toBe(false);
		expect(rekeyed.previous?.map((r) => same(r, opened.root))).toEqual([true]);
		expect(rekeyed.record.vault.id).not.toBe(opened.record.vault.id);
		// This browser keeps the new record only.
		expect(loadVaultRecords(storage).map((r) => r.vault.id)).toEqual([rekeyed.record.vault.id]);
		// A and B open it, with the same new root and the old one before it.
		const withB = await openBooksVault({ ...B, storage });
		expect(same(withB.root, rekeyed.root)).toBe(true);
		expect(withB.previous?.map((r) => same(r, opened.root))).toEqual([true]);
		// C did not answer: refused here, not given books of its own.
		await expect(openBooksVault({ ...C, storage })).rejects.toBeInstanceOf(RemovedPasskeyError);
	});

	it('a renewal later keeps the roots before', async () => {
		const { storage, opened } = await books();
		const rekeyed = await rekeyBooksVault(opened, [A, B], storage);
		const renewed = await renewBooksVault(
			rekeyed,
			[A],
			[rekeyed.record.slots[1]?.kid ?? ''],
			storage
		);
		const again = await openBooksVault({ ...A, storage });
		expect(same(again.root, renewed.root)).toBe(true);
		expect(again.previous?.map((r) => same(r, opened.root))).toEqual([true]);
	});

	it('another device of the owner takes the successor when its passkey has a slot there', async () => {
		const { storage, opened } = await books();
		// The other device: its own browser, the same books, opened with B.
		const there = memoryStorage();
		there.setItem(VAULTS_STORAGE_KEY, String(storage.getItem(VAULTS_STORAGE_KEY)));
		const onB = await openBooksVault({ ...B, storage: there });
		const rekeyed = await rekeyBooksVault(opened, [A, B], storage);

		const switched = await adoptSuccessorVault(onB, rekeyed.record.vault, B, there);
		expect(same(switched.root, rekeyed.root)).toBe(true);
		expect(loadVaultRecords(there).map((r) => r.vault.id)).toEqual([rekeyed.record.vault.id]);

		// C has no slot in the new vault: refused.
		const elsewhere = memoryStorage();
		elsewhere.setItem(VAULTS_STORAGE_KEY, JSON.stringify([opened.record]));
		const onC = await openBooksVault({ ...C, storage: elsewhere });
		await expect(
			adoptSuccessorVault(onC, rekeyed.record.vault, C, elsewhere)
		).rejects.toBeInstanceOf(RemovedPasskeyError);
	});

	it('a new vault of other books is refused', async () => {
		const { storage, opened } = await books();
		// Other books, made with C, that A was added to.
		const otherStorage = memoryStorage();
		let other = await openBooksVault({ ...C, storage: otherStorage });
		other = await addPasskey(other, A, otherStorage);
		const theirs = await rekeyBooksVault(other, [C, A], otherStorage);
		const onA = await openBooksVault({ ...A, storage });
		expect(same(onA.root, opened.root)).toBe(true);
		await expect(adoptSuccessorVault(onA, theirs.record.vault, A, storage)).rejects.toBeInstanceOf(
			VaultStorageError
		);
	});
});

// #524: passkey B has a slot in the books A made on another device, and their
// vault is published. On this device B opened Belege without "Restore" and
// founded books of its own.
describe('the other books of a passkey (#524)', () => {
	async function trap() {
		const laptop = memoryStorage();
		const there = await addPasskey(await openBooksVault({ ...A, storage: laptop }), B, laptop);
		/** What index P of B holds: the record, no names. */
		const published = {
			vault: there.record.vault,
			slots: there.record.slots.map((s) => ({ ...s, label: '' })),
			removed: []
		};
		const phone = memoryStorage();
		const own = await openBooksVault({ ...B, storage: phone });
		expect(own.created).toBe(true);
		expect(own.root).toEqual(B.prfOutput);
		return { laptop, there, published, phone, own };
	}

	it('a vault from the index that this passkey opens, with another root, is other books', async () => {
		const { published, own, there } = await trap();
		const other = await otherBooks(own, published, B);
		expect(other?.vault.id).toBe(there.record.vault.id);
		expect(other?.vault.slots).toHaveLength(2);
	});

	it('nothing, the same vault, the same books or a vault it cannot open is not', async () => {
		const { published, own, there, phone } = await trap();
		expect(await otherBooks(own, null, B)).toBeNull();
		expect(
			await otherBooks(own, { vault: own.record.vault, slots: [], removed: [] }, B)
		).toBeNull();
		// Not the shape of a vault record: from outside, so checked.
		for (const broken of [
			'vault',
			{},
			{ vault: { id: 7, slots: [] }, slots: [] },
			{ vault: { id: 'x', slots: 'none' }, slots: [] },
			{ vault: { id: 'x', slots: [null] }, slots: [] },
			{ vault: published.vault }
		]) {
			expect(await otherBooks(own, broken, B)).toBeNull();
		}
		// Another passkey's vault: this one has no slot in it.
		const onlyA = await openBooksVault({ ...A, storage: memoryStorage() });
		expect(await otherBooks(own, { ...published, vault: onlyA.record.vault }, B)).toBeNull();
		// A slot under this passkey's id that its key does not open.
		const forged = await addPasskey(
			await openBooksVault({ ...A, storage: memoryStorage() }),
			{ ...B, prfOutput: bytes(32, 9) },
			memoryStorage()
		);
		expect(await otherBooks(own, { ...published, vault: forged.record.vault }, B)).toBeNull();
		// The same books under a renewed vault: another id, the same root.
		const renewed = await renewBooksVault(own, [B], [], memoryStorage());
		expect(renewed.record.vault.id).not.toBe(own.record.vault.id);
		expect(await otherBooks(own, { ...published, vault: renewed.record.vault }, B)).toBeNull();
		// The same books under new keys (#627): theirs is the successor's way.
		const rekeyed = await rekeyBooksVault(own, [B], memoryStorage());
		expect(await otherBooks(own, { ...published, vault: rekeyed.record.vault }, B)).toBeNull();
		expect(await otherBooks(rekeyed, { ...published, vault: own.record.vault }, B)).toBeNull();
		// Kept in this browser already.
		expect(await otherBooks(own, published, B, [there.record])).toBeNull();
		// Nothing was written.
		expect(loadVaultRecords(phone)).toHaveLength(1);
	});

	it('an unlock stays in the books founded here until the person asks for the others', async () => {
		const { published, phone, own } = await trap();
		let asked = 0;
		const find = async () => (asked++, published);
		const again = await openBooksVault({ ...B, storage: phone, find });
		expect(asked).toBe(0);
		expect(again.root).toEqual(own.root);
		expect(again.switched).toBeUndefined();
	});

	it('asked for, the other vault is opened and kept; the books founded here are set aside', async () => {
		const { published, phone, own, there } = await trap();
		const kid = own.kid;
		const opened = await openBooksVault({
			...B,
			storage: phone,
			find: async () => published,
			other: true
		});
		expect(opened.switched).toBe(true);
		expect(opened.found).toBe(true);
		expect(opened.root).toEqual(A.prfOutput);
		expect(opened.record.vault.id).toBe(there.record.vault.id);
		// Both are kept: nothing is lost. This passkey's name is this browser's own.
		const records = loadVaultRecords(phone);
		expect(records.map((r) => r.vault.id)).toEqual([own.record.vault.id, there.record.vault.id]);
		expect(records[0].aside).toEqual([kid]);
		expect(records[1].aside).toBeUndefined();
		expect(records[1].slots.find((s) => s.kid === kid)?.label).toBe('YubiKey');
		// From now on, without asking anyone: the other books.
		const next = await openBooksVault({ ...B, storage: phone });
		expect(next.root).toEqual(A.prfOutput);
		expect(next.switched).toBeUndefined();
		// Asked once more, the index names what is kept already: nothing changes.
		const same = await openBooksVault({
			...B,
			storage: phone,
			find: async () => published,
			other: true
		});
		expect(same.switched).toBeUndefined();
		expect(loadVaultRecords(phone)).toHaveLength(2);
		// What is done to the adopted vault leaves the one set aside as it is.
		await addPasskey(next, C, phone);
		expect(loadVaultRecords(phone)[0].aside).toEqual([kid]);
		expect((await openBooksVault({ ...B, storage: phone })).root).toEqual(A.prfOutput);
	});

	it('asked for, but the index fails or names nothing usable: the books here open', async () => {
		const { phone, own } = await trap();
		const before = phone.map.get(VAULTS_STORAGE_KEY);
		for (const find of [
			async () => null,
			async () => {
				throw new Error('Aleph did not answer: 503');
			},
			async () => /** @type {any} */ ({ vault: { id: 'x', slots: [{ kid: own.kid }] }, slots: [] })
		]) {
			const opened = await openBooksVault({ ...B, storage: phone, find, other: true });
			expect(opened.root).toEqual(own.root);
			expect(opened.switched).toBeUndefined();
			expect(opened.found).toBe(false);
		}
		expect(phone.map.get(VAULTS_STORAGE_KEY)).toBe(before);
	});

	it('another passkey of the books founded here still opens them, and leaves the choice alone', async () => {
		const { published, phone, own } = await trap();
		await addPasskey(own, C, phone);
		await openBooksVault({ ...B, storage: phone, find: async () => published, other: true });
		// C has no slot elsewhere: the books founded here, as before.
		const withC = await openBooksVault({ ...C, storage: phone });
		expect(withC.root).toEqual(B.prfOutput);
		// What C does there writes the record anew: B stays set aside in it.
		await addRecoveryWords(withC, bytes(64, 0x5e), phone);
		expect(loadVaultRecords(phone)[0].aside).toEqual([own.kid]);
		expect((await openBooksVault({ ...B, storage: phone })).root).toEqual(A.prfOutput);
	});
});

describe('two vaults of the same books (#555)', () => {
	/** Two devices of passkey A, each with a vault of its own: the same root, other ids. */
	async function twoDevices() {
		const laptop = memoryStorage();
		const phone = memoryStorage();
		const onLaptop = await addPasskey(await openBooksVault({ ...A, storage: laptop }), B, laptop);
		const onPhone = await addPasskey(await openBooksVault({ ...A, storage: phone }), C, phone);
		expect(onPhone.root).toEqual(onLaptop.root);
		expect(onPhone.record.vault.id).not.toBe(onLaptop.record.vault.id);
		return { laptop, phone, onLaptop, onPhone };
	}
	/** @param {import('./books-vault.js').VaultRecord} record */
	const published = (record) => ({
		vault: record.vault,
		slots: record.slots.map((s) => ({ ...s, label: '' }))
	});

	it('a restore that meets the other device’s vault is refused, not remembered as removed', async () => {
		const { onLaptop, onPhone } = await twoDevices();
		// An empty device with B: its index names the laptop's vault, index M the phone's.
		const empty = memoryStorage();
		const found = await openBooksVault({ ...B, storage: empty, find: async () => onLaptop.record });
		expect(found.found).toBe(true);
		await expect(
			adoptNewerVault(found, onPhone.record.vault, B, empty, published(onPhone.record).slots)
		).rejects.toBeInstanceOf(NotInPublishedVaultError);
		// Nothing kept: B is not refused here for good, and asks again.
		expect(loadVaultRecords(empty)).toEqual([]);
		const again = await openBooksVault({ ...B, storage: empty, find: async () => onLaptop.record });
		expect(again.root).toEqual(A.prfOutput);
		// … while a passkey taken out of the same vault is refused and remembered, as before.
		const withoutB = removePasskey(onLaptop, again.kid, memoryStorage());
		await expect(adoptNewerVault(again, withoutB.record.vault, B, empty)).rejects.toBeInstanceOf(
			RemovedPasskeyError
		);
		expect(loadVaultRecords(empty)[0].removed).toEqual([again.kid]);
	});

	it('before publishing, the phone takes the published vault; C still opens the books there', async () => {
		const { phone, onLaptop, onPhone } = await twoDevices();
		const { opened, lost } = await convergeOnPublished(
			onPhone,
			published(onLaptop.record),
			A,
			phone
		);
		expect(opened.record.vault.id).toBe(onLaptop.record.vault.id);
		expect(opened.root).toEqual(onPhone.root);
		// The names this browser knows stay; B comes without one, as published.
		expect(opened.record.slots.map((s) => [s.credentialId, s.label])).toEqual([
			['cred-a', 'Laptop'],
			['cred-b', '']
		]);
		expect(lost.map((s) => s.label)).toEqual(['Telefon']);
		// A opens the published vault from now on; C, only in the old one, the same books.
		const nextA = await openBooksVault({ ...A, storage: phone });
		expect(nextA.record.vault.id).toBe(onLaptop.record.vault.id);
		const withC = await openBooksVault({ ...C, storage: phone });
		expect(withC.record.vault.id).toBe(onPhone.record.vault.id);
		expect(withC.root).toEqual(A.prfOutput);
		// Once taken, publishing again changes nothing.
		const same = await convergeOnPublished(opened, published(onLaptop.record), A, phone);
		expect(same.opened).toBe(opened);
	});

	it('a published vault without this passkey, or with other books, is neither taken nor overwritten', async () => {
		const { phone, onPhone } = await twoDevices();
		const other = memoryStorage();
		const onlyB = await openBooksVault({ ...B, storage: other });
		await expect(
			convergeOnPublished(onPhone, published(onlyB.record), A, phone)
		).rejects.toBeInstanceOf(PublishedVaultLacksPasskeyError);
		// A vault this passkey opens, of other books: refused as well.
		const foreign = await addPasskey(onlyB, A, other);
		await expect(
			convergeOnPublished(onPhone, published(foreign.record), A, phone)
		).rejects.toBeInstanceOf(VaultStorageError);
		expect(loadVaultRecords(phone).map((r) => r.vault.id)).toEqual([onPhone.record.vault.id]);
	});

	it('its own vault from before a renewal here is replaced by publishing, not taken back', async () => {
		const storage = memoryStorage();
		const before = await addPasskey(await openBooksVault({ ...A, storage }), B, storage);
		const renewed = await renewBooksVault(before, [A], [before.record.slots[1].kid], storage);
		expect(renewed.record.replaces).toEqual([before.record.vault.id]);
		const { opened, lost } = await convergeOnPublished(
			renewed,
			published(before.record),
			A,
			storage
		);
		expect(opened).toBe(renewed);
		expect(lost).toEqual([]);
		// Kept across reads, and by what is written after.
		const again = await openBooksVault({ ...A, storage });
		expect(again.record.replaces).toEqual([before.record.vault.id]);
	});
});

describe('a restore that finds no books (#555)', () => {
	it('asks before a new vault is made, and keeps nothing when the answer is no', async () => {
		const storage = memoryStorage();
		let asked = 0;
		const no = async () => {
			asked++;
			throw new Error('no');
		};
		await expect(openBooksVault({ ...A, storage, confirmNew: no })).rejects.toThrow('no');
		expect(asked).toBe(1);
		expect(storage.getItem(VAULTS_STORAGE_KEY)).toBeNull();
		const yes = await openBooksVault({ ...A, storage, confirmNew: async () => void asked++ });
		expect(yes.created).toBe(true);
		expect(asked).toBe(2);
		// A vault here, or one found elsewhere: nothing to ask.
		await openBooksVault({ ...A, storage, confirmNew: no });
		const empty = memoryStorage();
		const found = await openBooksVault({
			...A,
			storage: empty,
			find: async () => yes.record,
			confirmNew: no
		});
		expect(found.found).toBe(true);
		expect(asked).toBe(2);
	});
});
