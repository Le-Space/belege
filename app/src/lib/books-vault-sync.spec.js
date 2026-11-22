// The vault's record for every own device (#962): two copies of one vault
// merge – what each device added, what each took out, the later recovery
// words –, a slot taken out after it was added stays out, a copy of another
// vault or another payload changes nothing, and each merged slot still opens
// the same root with its own passkey. Made-up bytes.
import { describe, expect, it } from 'vitest';

import {
	addPasskey,
	addRecoveryWords,
	adoptSyncedVault,
	mergeVaultRecords,
	openBooksVault,
	removePasskey,
	sameJson,
	sharedRecordOf,
	wordsSlotId
} from './books-vault.js';

const bytes = (/** @type {number} */ n, /** @type {number} */ fill) => new Uint8Array(n).fill(fill);
/** @param {number} n @param {string} label */
const passkey = (n, label) => ({
	prfOutput: bytes(32, n),
	rawCredentialId: bytes(16, 0xa0 + n),
	credentialId: `cred-${n}`,
	label
});
const A = passkey(1, 'Laptop');
const B = passkey(2, 'Telefon');
const C = passkey(3, 'Büro-Laptop');

function memoryStorage() {
	/** @type {Map<string, string>} */
	const map = new Map();
	return {
		getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
		removeItem: (/** @type {string} */ k) => void map.delete(k)
	};
}

/** A clock that moves on a minute per call. */
function clock() {
	let t = Date.parse('2026-01-01T00:00:00Z');
	return () => new Date((t += 60_000));
}

/** @param {any} record */
const kidsOf = (record) => record.vault.slots.map((/** @type {any} */ s) => s.kid).sort();

/** The books made with A on one device, copied to a second device. */
async function twoDevices() {
	const now = clock();
	const here = memoryStorage();
	const opened = await openBooksVault({ ...A, storage: here, now });
	const there = memoryStorage();
	const copy = adoptSyncedVault(
		{ ...opened, record: { ...opened.record, slots: [], removed: [] } },
		sharedRecordOf(opened.record),
		there
	);
	return { now, here, there, opened, copy };
}

/** @param {any} record @param {typeof A} pk */
async function opensWith(record, pk) {
	const storage = memoryStorage();
	storage.setItem('belege.vaults.v1', JSON.stringify([record]));
	return openBooksVault({ ...pk, storage });
}

describe('the vault for every own device (#962)', () => {
	it('merges what two devices added: each passkey opens the same root', async () => {
		const { now, here, there, opened } = await twoDevices();
		const withB = await addPasskey(opened, B, here, now);
		const withC = await addPasskey(opened, C, there, now);
		const merged = mergeVaultRecords(withB.record, sharedRecordOf(withC.record));
		expect(kidsOf(merged)).toEqual(
			[withB.kid, ...withB.record.vault.slots.map((/** @type {any} */ s) => s.kid)]
				.concat(withC.record.vault.slots.map((/** @type {any} */ s) => s.kid))
				.filter((k, i, all) => all.indexOf(k) === i)
				.sort()
		);
		expect(merged.slots.map((s) => s.label).sort()).toEqual(['Büro-Laptop', 'Laptop', 'Telefon']);
		for (const pk of [A, B, C]) {
			const back = await opensWith(merged, pk);
			expect(Array.from(back.root)).toEqual(Array.from(opened.root));
		}
		// The other way round, the same slots.
		const other = mergeVaultRecords(withC.record, sharedRecordOf(withB.record));
		expect(kidsOf(other)).toEqual(kidsOf(merged));
	});

	it('keeps a passkey out that was taken out after it was added', async () => {
		const { now, here, opened } = await twoDevices();
		const withB = await addPasskey(opened, B, here, now);
		const stale = sharedRecordOf(withB.record);
		const removed = removePasskey(
			withB,
			(await openBooksVault({ ...B, storage: here })).kid,
			here,
			now
		);
		const merged = mergeVaultRecords(removed.record, stale);
		expect(merged).toBe(removed.record);
		// … and a device that still has B learns that it is out.
		const told = mergeVaultRecords(withB.record, sharedRecordOf(removed.record));
		expect(kidsOf(told)).toEqual(kidsOf(removed.record));
		expect(told.removed).toHaveLength(1);
		await expect(opensWith(told, B)).rejects.toThrow();
	});

	it('takes a passkey added again after it was taken out', async () => {
		const { now, here, opened } = await twoDevices();
		const withB = await addPasskey(opened, B, here, now);
		const bKid = (await openBooksVault({ ...B, storage: here })).kid;
		const removed = removePasskey(withB, bKid, here, now);
		const again = await addPasskey(removed, B, here, now);
		const merged = mergeVaultRecords(removed.record, sharedRecordOf(again.record));
		expect(kidsOf(merged)).toContain(bKid);
		expect(merged.removed).not.toContain(bKid);
	});

	it('takes the later recovery words', async () => {
		const { now, here, opened } = await twoDevices();
		const first = await addRecoveryWords(opened, bytes(64, 7), here, now);
		const second = await addRecoveryWords(first, bytes(64, 8), here, now);
		const merged = mergeVaultRecords(first.record, sharedRecordOf(second.record));
		const kid = await wordsSlotId();
		const slot = (/** @type {any} */ r) =>
			r.vault.slots.find((/** @type {any} */ s) => s.kid === kid);
		expect(slot(merged)).toEqual(slot(second.record));
		// The older words do not come back from an older copy.
		expect(mergeVaultRecords(second.record, sharedRecordOf(first.record))).toBe(second.record);
	});

	it('changes nothing for another vault, another payload, or the same record', async () => {
		const { opened } = await twoDevices();
		const other = await openBooksVault({ ...B, storage: memoryStorage() });
		expect(mergeVaultRecords(opened.record, sharedRecordOf(other.record))).toBe(opened.record);
		const forged = {
			...sharedRecordOf(opened.record),
			vault: { ...opened.record.vault, payload: other.record.vault.payload }
		};
		expect(mergeVaultRecords(opened.record, forged)).toBe(opened.record);
		expect(mergeVaultRecords(opened.record, sharedRecordOf(opened.record))).toBe(opened.record);
		expect(adoptSyncedVault(opened, null, memoryStorage())).toBe(opened);
	});

	it('takes the same record with its keys in another order as the same', async () => {
		const { opened } = await twoDevices();
		/** The keys sorted at every level, as the sealed settings give a record back. @param {any} v @returns {any} */
		const reordered = (v) =>
			Array.isArray(v)
				? v.map(reordered)
				: v && typeof v === 'object'
					? Object.fromEntries(
							Object.keys(v)
								.reverse()
								.map((k) => [k, reordered(v[k])])
						)
					: v;
		const shared = sharedRecordOf(opened.record);
		expect(JSON.stringify(reordered(shared))).not.toBe(JSON.stringify(shared));
		expect(sameJson(reordered(shared), shared)).toBe(true);
		expect(mergeVaultRecords(opened.record, reordered(shared))).toBe(opened.record);
		expect(sameJson(shared, { ...shared, removed: ['x'] })).toBe(false);
	});

	it('keeps what this browser alone decides', async () => {
		const { now, here, opened } = await twoDevices();
		const aside = { ...opened, record: { ...opened.record, aside: ['x'] } };
		const withB = await addPasskey(opened, B, here, now);
		const merged = mergeVaultRecords(aside.record, sharedRecordOf(withB.record));
		expect(merged.aside).toEqual(['x']);
		expect(sharedRecordOf(merged)).not.toHaveProperty('aside');
	});
});
