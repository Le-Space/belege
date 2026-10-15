// Paperless-ngx documents into the books (#318): source 'paperless', sourceRef
// `paperless:<id>`, known ones not even fetched, the same bytes that came by
// mail a duplicate, tags left out on request, and the moment of the last fetch
// kept. All documents made up.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { importFile } from '../receipts/import.js';
import { sourceCounts } from '../receipts/view.js';
import {
	cleanPaperlessSettings,
	fetchPaperless,
	importPaperlessDocuments,
	loadPaperlessSettings,
	newestAdded,
	paperlessSourceRef,
	parseTags,
	savePaperlessSettings
} from './import.js';

const pdf = (/** @type {string} */ marker) =>
	new TextEncoder().encode(`%PDF-1.4\n${marker}\n%%EOF`);

async function setup() {
	const { collection: receipts } = memoryCollection('receipts');
	const { collection: settings } = memoryCollection('settings');
	const { collection: events } = memoryCollection('events');
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	return { receipts, settings, events, blobs };
}

/** @param {number} id @param {Partial<import('./import.js').PaperlessDocument>} [over] */
const doc = (id, over = {}) => ({
	id,
	title: `Rechnung ${id}`,
	created: '2026-09-03',
	added: `2026-09-${String(id).padStart(2, '0')}T08:00:00+02:00`,
	correspondent: 'Beispiel Hosting GmbH',
	documentType: 'Rechnung',
	tags: ['Rechnung'],
	originalFileName: `RE-${id}.pdf`,
	mimeType: 'application/pdf',
	content: `Beispiel Hosting GmbH Rechnung ${id} Summe 23,80 EUR`,
	...over
});

/** A bridge with one file per document id; counts what was asked. */
/**
 * @param {Record<number, Uint8Array | 'not-a-receipt'>} files
 * @param {import('./import.js').PaperlessDocument[]} [list]
 */
function bridge(files, list = []) {
	/** @type {number[]} */
	const asked = [];
	/** @type {(string | null)[]} */
	const since = [];
	return {
		asked,
		since,
		paperlessDocuments: async (/** @type {string | null} */ s) => {
			since.push(s);
			return list;
		},
		paperlessDocument: async (/** @type {number} */ id) => {
			asked.push(id);
			const f = files[id];
			if (f === 'not-a-receipt') {
				throw Object.assign(new Error('no receipt'), { code: 'PAPERLESS_NOT_A_RECEIPT' });
			}
			return f;
		}
	};
}

describe('importPaperlessDocuments', () => {
	it('keeps a new document as a receipt with its Paperless fields and OCR text', async () => {
		const { receipts, blobs } = await setup();
		/** @type {any[]} */
		const created = [];
		const counts = await importPaperlessDocuments({
			receipts,
			blobs,
			client: bridge({ 11: pdf('eleven') }),
			documents: [doc(11)],
			created
		});
		expect(counts).toEqual({ new: 1, known: 0, duplicate: 0, skipped: 0, unsupported: 0 });
		const [r] = created;
		expect(r).toMatchObject({
			source: 'paperless',
			sourceRef: 'paperless:11',
			fileName: 'RE-11.pdf',
			mime: 'application/pdf',
			from: 'Beispiel Hosting GmbH',
			subject: 'Rechnung 11',
			receivedAt: '2026-09-03',
			status: 'neu',
			paperless: { id: 11, documentType: 'Rechnung', tags: ['Rechnung'] }
		});
		expect(r.paperlessContent).toContain('Summe 23,80 EUR');
		expect(sourceCounts(await receipts.list())).toMatchObject({ paperless: 1, mail: 0 });
	});

	it('does not even ask for a known document, and a deleted one stays known', async () => {
		const { receipts, blobs } = await setup();
		const client = bridge({ 11: pdf('eleven'), 12: pdf('twelve') });
		await importPaperlessDocuments({ receipts, blobs, client, documents: [doc(11), doc(12)] });
		const twelve = (await receipts.list()).find((r) => r.sourceRef === paperlessSourceRef(12));
		await receipts.put({ ...twelve, deleted: true });
		client.asked.length = 0;
		const again = await importPaperlessDocuments({
			receipts,
			blobs,
			client,
			documents: [doc(11), doc(12)]
		});
		expect(again).toMatchObject({ new: 0, known: 2 });
		expect(client.asked).toEqual([]);
	});

	it('takes the same bytes that came by mail as a duplicate', async () => {
		const { receipts, blobs } = await setup();
		const bytes = pdf('same invoice');
		await importFile({
			receipts,
			blobs,
			bytes,
			fileName: 'RE-11.pdf',
			source: 'mail',
			sourceRef: 'mail:INBOX:1:7:2'
		});
		const counts = await importPaperlessDocuments({
			receipts,
			blobs,
			client: bridge({ 11: bytes }),
			documents: [doc(11)]
		});
		expect(counts).toMatchObject({ new: 0, duplicate: 1 });
		expect(await receipts.list()).toHaveLength(1);
	});

	it('leaves out a document with a tag the person named, without fetching it', async () => {
		const { receipts, blobs } = await setup();
		const client = bridge({ 11: pdf('eleven'), 12: pdf('twelve') });
		const counts = await importPaperlessDocuments({
			receipts,
			blobs,
			client,
			documents: [doc(11, { tags: ['Rechnung', 'aus-Mail'] }), doc(12)],
			skipTags: ['AUS-MAIL']
		});
		expect(counts).toMatchObject({ new: 1, skipped: 1 });
		expect(client.asked).toEqual([12]);
	});

	it('counts a document that is no receipt file, and goes on', async () => {
		const { receipts, blobs } = await setup();
		const counts = await importPaperlessDocuments({
			receipts,
			blobs,
			client: bridge({ 14: 'not-a-receipt', 15: pdf('fifteen') }),
			documents: [doc(14), doc(15)]
		});
		expect(counts).toMatchObject({ new: 1, unsupported: 1 });
	});
});

describe('fetchPaperless', () => {
	it('asks for what is new since the last fetch, and remembers the newest', async () => {
		const { receipts, settings, events, blobs } = await setup();
		const store = { receipts, settings, events };
		const first = bridge({ 3: pdf('three'), 4: pdf('four') }, [doc(3), doc(4)]);
		const one = await fetchPaperless({ store, blobs, client: first });
		expect(one).toMatchObject({ documents: 2, counts: { new: 2 } });
		expect(one.createdIds).toHaveLength(2);
		expect(first.since).toEqual([null]);
		expect((await loadPaperlessSettings(settings)).since).toBe(doc(4).added);

		const second = bridge({}, []);
		await fetchPaperless({ store, blobs, client: second });
		expect(second.since).toEqual([doc(4).added]);
		const kinds = (await events.list()).map((e) => e.kind);
		expect(kinds.filter((k) => k === 'paperless-fetch')).toHaveLength(2);
	});

	it('remembers nothing when the import fails half-way', async () => {
		const { receipts, settings, events, blobs } = await setup();
		const client = bridge({ 3: pdf('three') }, [doc(3), doc(4)]);
		client.paperlessDocument = async (id) => {
			if (id === 4)
				throw Object.assign(new Error('unreachable'), { code: 'PAPERLESS_UNREACHABLE' });
			return pdf('three');
		};
		await expect(
			fetchPaperless({ store: { receipts, settings, events }, blobs, client })
		).rejects.toThrow('unreachable');
		expect((await loadPaperlessSettings(settings)).since).toBe(null);
	});
});

describe('settings', () => {
	it('cleans what is stored, and keeps tags unique', async () => {
		expect(cleanPaperlessSettings(null)).toEqual({ since: null, skipTags: [], mailToo: false });
		expect(
			cleanPaperlessSettings({ since: 'gestern', skipTags: [' a ', 'a', '', 'b'], mailToo: 'ja' })
		).toEqual({ since: null, skipTags: ['a', 'b'], mailToo: false });
		const { settings } = await setup();
		await savePaperlessSettings(settings, { mailToo: true });
		await savePaperlessSettings(settings, { skipTags: parseTags('aus-Mail, Rechnung,') });
		expect(await loadPaperlessSettings(settings)).toEqual({
			since: null,
			skipTags: ['aus-Mail', 'Rechnung'],
			mailToo: true
		});
	});

	it('takes the newest added, whatever the order', () => {
		expect(newestAdded([doc(5), doc(2)], null)).toBe(doc(5).added);
		expect(newestAdded([doc(2)], doc(9).added)).toBe(doc(9).added);
		expect(newestAdded([], null)).toBe(null);
	});
});
