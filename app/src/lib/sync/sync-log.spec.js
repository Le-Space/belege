// The sync log (sync-log.js): what an entry is in a few facts, and the log
// sealed in this browser – opened only with its key, the newest kept.
// Everything here is made up.
import { describe, expect, it } from 'vitest';

import { sealer } from '../db-encryption.js';
import { MAX, SYNC_LOG_KEY, createSyncLog, describeEntry } from './sync-log.js';

/** A Storage in memory. @returns {Storage} */
function memoryStorage() {
	const map = new Map();
	return /** @type {any} */ ({
		getItem: (/** @type {string} */ k) => map.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => map.delete(k)
	});
}

const entry = (/** @type {any} */ value, op = 'PUT') => ({
	hash: 'zdpu1',
	payload: { op, key: value.id, value }
});

describe('what an entry is', () => {
	it('a receipt: file name, size, date; new or changed or deleted', () => {
		const receipt = {
			id: '01JZ0000000000000000000001',
			fileName: 'quittung-baumarkt.pdf',
			size: 48_213,
			documentDate: '2026-10-21',
			createdAt: '2026-10-23T08:00:00Z',
			updatedAt: '2026-10-23T08:00:00Z'
		};
		expect(describeEntry('receipts', entry(receipt))).toEqual({
			op: 'new',
			id: receipt.id,
			what: { fileName: 'quittung-baumarkt.pdf', size: 48_213, date: '2026-10-21' }
		});
		expect(
			describeEntry('receipts', entry({ ...receipt, updatedAt: '2026-10-23T09:00:00Z' })).op
		).toBe('changed');
		expect(describeEntry('receipts', entry({ ...receipt, deleted: true })).op).toBe('deleted');
	});

	it('a payment: counterparty, amount, day; a setting: its key only', () => {
		expect(
			describeEntry(
				'transactions',
				entry({
					id: 't1',
					counterparty: 'Beispiel Baumarkt',
					amountCents: -4711,
					bookedOn: '2026-10-20'
				})
			).what
		).toEqual({ counterparty: 'Beispiel Baumarkt', amountCents: -4711, date: '2026-10-20' });
		expect(
			describeEntry('settings', entry({ id: 's1', key: 'network-mode', value: { mode: 'qr' } }))
				.what
		).toEqual({
			key: 'network-mode'
		});
	});
});

describe('the log in this browser', () => {
	const key = new Uint8Array(32).fill(7);
	const line = (/** @type {number} */ at) =>
		/** @type {any} */ ({
			at,
			direction: 'in',
			collection: 'receipts',
			peerId: 'peer-a',
			op: 'new',
			id: String(at),
			what: { fileName: 'geheim-beleg.pdf' }
		});

	it('is sealed: nothing of it readable, opened only with its key', async () => {
		const storage = memoryStorage();
		const log = createSyncLog(await sealer(key), { storage, saveAfter: 0 });
		log.add(line(1));
		await log.flush();
		const kept = String(storage.getItem(SYNC_LOG_KEY));
		expect(kept).not.toContain('geheim');
		expect(atob(kept)).not.toContain('geheim');
		const again = createSyncLog(await sealer(key), { storage });
		expect((await again.load()).map((l) => l.id)).toEqual(['1']);
		// Another passkey's key: an empty log, not an error.
		const other = createSyncLog(await sealer(new Uint8Array(32).fill(9)), { storage });
		expect(await other.load()).toEqual([]);
	});

	it('keeps the newest, newest first', async () => {
		const log = createSyncLog(await sealer(key), {
			storage: memoryStorage(),
			max: 3,
			saveAfter: 0
		});
		for (let at = 1; at <= 5; at++) log.add(line(at));
		expect(log.list().map((l) => l.at)).toEqual([5, 4, 3]);
		expect(MAX).toBe(300);
	});
});
