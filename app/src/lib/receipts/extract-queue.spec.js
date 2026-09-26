// "Alle neuen auslesen" app-wide: one run, nothing sent twice, cancel, stop
// when locked; and an extraction never overwrites what changed meanwhile.
// Made-up receipts and answers only.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from './blob-store.js';
import { extractReceipt } from './extract.js';
import {
	cancelExtractAll,
	extractAll,
	extractOne,
	extractRun,
	reading
} from './extract-queue.svelte.js';

const ANSWER = {
	vendor: 'Wolkenfabrik Hosting GmbH',
	gross: 119,
	currency: 'EUR',
	invoice_date: '2026-08-15'
};

/**
 * A bridge whose answers wait until `release()` is called, so a test can act
 * while the model "thinks".
 */
function slowClient() {
	/** @type {string[]} */
	const sent = [];
	/** @type {(() => void)[]} */
	let waiting = [];
	return {
		sent,
		/** Answer every request sent so far. */
		release() {
			const now = waiting;
			waiting = [];
			for (const go of now) go();
		},
		pending: () => waiting.length,
		client: {
			extract: async (/** @type {any} */ body) => {
				sent.push(body.hints.subject);
				await new Promise((resolve) => waiting.push(() => resolve(undefined)));
				return { extraction: ANSWER, model: 'fake', usage: {}, attempts: [] };
			}
		}
	};
}

async function books(count = 3) {
	const { collection: receipts } = memoryCollection('receipts');
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	/** @type {any[]} */
	const records = [];
	for (let i = 0; i < count; i++) {
		// A mail without a file: the text is its subject and excerpt.
		records.push(
			await receipts.put({
				status: 'neu',
				source: 'mail',
				mailId: `m${i}`,
				subject: `Rechnung ${i}`,
				excerpt: 'Brutto 119,00 EUR',
				from: 'Wolkenfabrik <rechnung@wolkenfabrik.example>',
				receivedAt: '2026-08-19T09:00:00Z',
				authVerdict: 'pass',
				mime: 'text/plain'
			})
		);
	}
	return { receipts, blobs, records };
}

/** Let pending promises run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @param {() => boolean} ok */
async function until(ok) {
	for (let i = 0; i < 200 && !ok(); i++) await tick();
	expect(ok()).toBe(true);
}

describe('an extraction writes onto the receipt as it is then', () => {
	it('keeps what a person changed while the model answered', async () => {
		const { receipts, blobs, records } = await books(1);
		const slow = slowClient();
		const done = extractReceipt({ client: slow.client, receipts, blobs, record: records[0] });
		await until(() => slow.pending() === 1);
		const now = await receipts.get(records[0].id);
		await receipts.put({ ...now, note: 'von Hand', confirmedByUser: true });
		slow.release();
		const updated = await done;
		expect(updated).toMatchObject({
			note: 'von Hand',
			confirmedByUser: true,
			status: 'ausgelesen'
		});
		expect(updated.extraction.vendor).toBe(ANSWER.vendor);
	});

	it('a receipt deleted meanwhile stays deleted and gets nothing', async () => {
		const { receipts, blobs, records } = await books(1);
		const slow = slowClient();
		const done = extractReceipt({ client: slow.client, receipts, blobs, record: records[0] });
		await until(() => slow.pending() === 1);
		await receipts.softDelete(records[0].id);
		slow.release();
		await done;
		const stored = await receipts.get(records[0].id);
		expect(stored).toMatchObject({ deleted: true });
		expect(stored?.extraction).toBeUndefined();
	});
});

describe('the app-wide queue', () => {
	it('reads each receipt once; a second run and a single read of one being read are refused', async () => {
		const { receipts, blobs, records } = await books(3);
		const slow = slowClient();
		const ctx = { client: slow.client, store: () => ({ receipts }), blobs: () => blobs };
		const run = extractAll(
			ctx,
			records.map((r) => r.id)
		);
		await until(() => slow.pending() === 1);
		expect(extractRun.progress).toEqual({ done: 0, count: 3 });
		expect(reading.has(records[0].id)).toBe(true);

		expect(await extractAll(ctx, [records[1].id])).toBe(false);
		expect(await extractOne(ctx, records[0])).toBe(false);

		// Read by hand meanwhile: the run skips it.
		const one = extractOne(ctx, records[1]);
		await until(() => slow.pending() === 2);
		slow.release();
		await one;
		for (let i = 0; i < 5; i++) {
			await tick();
			slow.release();
		}
		expect(await run).toBe(true);
		expect(slow.sent).toEqual(['Rechnung 0', 'Rechnung 1', 'Rechnung 2']);
		expect(extractRun.progress).toBeNull();
		expect(reading.size).toBe(0);
		const stored = await receipts.list();
		expect(stored.every((r) => r.status === 'ausgelesen')).toBe(true);
	});

	it('"Abbrechen" finishes the receipt being read and sends no other', async () => {
		const { receipts, blobs, records } = await books(3);
		const slow = slowClient();
		const ctx = { client: slow.client, store: () => ({ receipts }), blobs: () => blobs };
		const run = extractAll(
			ctx,
			records.map((r) => r.id)
		);
		await until(() => slow.pending() === 1);
		cancelExtractAll();
		expect(extractRun.cancelling).toBe(true);
		slow.release();
		await run;
		expect(slow.sent).toEqual(['Rechnung 0']);
		expect(extractRun).toMatchObject({ progress: null, cancelling: false });
	});

	it('stops when the books are locked', async () => {
		const { receipts, blobs, records } = await books(3);
		const slow = slowClient();
		/** @type {{ receipts: any } | null} */
		let open = { receipts };
		const ctx = { client: slow.client, store: () => open, blobs: () => blobs };
		const run = extractAll(
			ctx,
			records.map((r) => r.id)
		);
		await until(() => slow.pending() === 1);
		open = null;
		slow.release();
		await run;
		expect(slow.sent).toEqual(['Rechnung 0']);
	});
});
