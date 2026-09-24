// Receipts into the store: dedup by content, mail parts skipped by reference,
// unverified senders marked, files that are no receipt refused.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from './blob-store.js';
import { importFile, importFiles, importMailMessages, needsConfirmation, sniff } from './import.js';

const pdf = (/** @type {string} */ marker) =>
	new TextEncoder().encode(`%PDF-1.4\n${marker}\n%%EOF`);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function setup() {
	const { collection: receipts } = memoryCollection('receipts');
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	return { receipts, blobs };
}

/** A mail as GET /mail/messages lists it. */
function mail(/** @type {Record<string, any>} */ over = {}) {
	return {
		id: 'bWFpbC0x',
		folder: 'INBOX',
		uid: 1,
		date: '2026-08-19T09:00:00.000Z',
		receivedAt: '2026-08-19T09:00:05.000Z',
		from: { address: 'rechnung@wolkenfabrik.example', name: 'Wolkenfabrik Hosting GmbH' },
		subject: 'Ihre Rechnung WF-1',
		auth: { verdict: 'pass' },
		outgoing: false,
		attachments: [{ part: '2', name: 'R.PDF', kind: 'pdf', isPdf: true }],
		excerpt: 'Anbei die Rechnung.',
		...over
	};
}

describe('receipt import', () => {
	it('sniff goes by the bytes, not the name', () => {
		expect(sniff(pdf('x'))).toEqual({ kind: 'pdf', mime: 'application/pdf' });
		expect(sniff(png).mime).toBe('image/png');
		expect(sniff(new TextEncoder().encode('<html>')).kind).toBe('other');
	});

	it('an upload: sealed file, record with sha256 and status neu; the same bytes again are a duplicate', async () => {
		const { receipts, blobs } = await setup();
		const first = await importFile({
			receipts,
			blobs,
			bytes: pdf('A'),
			fileName: 'a.pdf',
			source: 'upload',
			sourceRef: 'upload:a.pdf'
		});
		expect(first.outcome).toBe('new');
		expect(first.record).toMatchObject({
			source: 'upload',
			fileName: 'a.pdf',
			mime: 'application/pdf',
			status: 'neu',
			extraction: null
		});
		expect(first.record?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(await blobs.get(/** @type {string} */ (first.record?.fileCid))).toEqual(pdf('A'));

		const again = await importFile({
			receipts,
			blobs,
			bytes: pdf('A'),
			fileName: 'renamed.pdf',
			source: 'upload',
			sourceRef: 'upload:renamed.pdf'
		});
		expect(again.outcome).toBe('duplicate');
		expect(await receipts.list()).toHaveLength(1);
	});

	it('a soft-deleted receipt still counts: it does not come back', async () => {
		const { receipts, blobs } = await setup();
		const { record } = await importFile({
			receipts,
			blobs,
			bytes: pdf('B'),
			fileName: 'b.pdf',
			source: 'upload',
			sourceRef: 'upload:b.pdf'
		});
		await receipts.softDelete(/** @type {any} */ (record).id);
		const counts = await importFiles({
			receipts,
			blobs,
			source: 'folder',
			files: [{ name: 'b.pdf', path: 'x/b.pdf', bytes: async () => pdf('B') }]
		});
		expect(counts).toEqual({ new: 0, duplicate: 1, unsupported: 0 });
	});

	it('files that are no PDF or image are refused', async () => {
		const { receipts, blobs } = await setup();
		const counts = await importFiles({
			receipts,
			blobs,
			source: 'upload',
			files: [
				{ name: 'fake.pdf', bytes: async () => new TextEncoder().encode('MZ executable') },
				{ name: 'bild.png', bytes: async () => png }
			]
		});
		expect(counts).toEqual({ new: 1, duplicate: 0, unsupported: 1 });
		const [only] = await receipts.list();
		expect(only.mime).toBe('image/png');
	});

	it('mail: attachments become receipts; a second fetch downloads nothing again', async () => {
		const { receipts, blobs } = await setup();
		/** @type {string[]} */
		const downloads = [];
		const client = {
			mailAttachment: async (/** @type {string} */ id, /** @type {string} */ part) => {
				downloads.push(`${id}#${part}`);
				return pdf(`${id}-${part}`);
			}
		};
		const messages = [
			mail(),
			mail({
				id: 'bWFpbC0y',
				attachments: [
					{ part: '2', name: 'logo.png', kind: 'other' },
					{ part: '3', name: 'quittung.jpg', kind: 'image' }
				]
			}),
			mail({ id: 'bWFpbC0z', attachments: [], excerpt: 'Ihre Bestellung: 23,80 EUR' })
		];
		const counts = await importMailMessages({ receipts, blobs, client, messages });
		expect(counts).toEqual({ new: 3, duplicate: 0, skipped: 0, unsupported: 0 });
		expect(downloads).toEqual(['bWFpbC0x#2', 'bWFpbC0y#3']);
		const all = await receipts.list();
		const text = all.find((r) => r.sourceRef === 'bWFpbC0z#text');
		expect(text).toMatchObject({
			fileCid: null,
			mime: 'text/plain',
			excerpt: 'Ihre Bestellung: 23,80 EUR'
		});
		const first = all.find((r) => r.sourceRef === 'bWFpbC0x#2');
		expect(first).toMatchObject({
			source: 'mail',
			mailId: 'bWFpbC0x',
			from: 'Wolkenfabrik Hosting GmbH <rechnung@wolkenfabrik.example>',
			subject: 'Ihre Rechnung WF-1',
			authVerdict: 'pass',
			status: 'neu'
		});

		const again = await importMailMessages({ receipts, blobs, client, messages });
		expect(again).toEqual({ new: 0, duplicate: 0, skipped: 3, unsupported: 0 });
		expect(downloads).toHaveLength(2);
	});

	it('mail: the same PDF in two mails is one receipt', async () => {
		const { receipts, blobs } = await setup();
		const client = { mailAttachment: async () => pdf('same') };
		const counts = await importMailMessages({
			receipts,
			blobs,
			client,
			messages: [mail(), mail({ id: 'bWFpbC05' })]
		});
		expect(counts).toEqual({ new: 1, duplicate: 1, skipped: 0, unsupported: 0 });
	});

	it('mail: a sender that failed DKIM/SPF is a question; our own forward (Sent) is not', async () => {
		const { receipts, blobs } = await setup();
		let n = 0;
		const client = { mailAttachment: async () => pdf(`m${n++}`) };
		await importMailMessages({
			receipts,
			blobs,
			client,
			messages: [
				mail({ id: 'cGhpc2gx', auth: { verdict: 'fail' } }),
				mail({ id: 'bm9uZTE', auth: { verdict: 'none' } }),
				mail({ id: 'c2VudDE', auth: { verdict: 'none' }, outgoing: true })
			]
		});
		const byId = Object.fromEntries((await receipts.list()).map((r) => [r.mailId, r]));
		expect(byId.cGhpc2gx.status).toBe('rückfrage');
		expect(needsConfirmation(byId.cGhpc2gx)).toBe(true);
		expect(byId.bm9uZTE.status).toBe('rückfrage');
		expect(byId.c2VudDE.status).toBe('neu');
		expect(needsConfirmation(byId.c2VudDE)).toBe(false);
		expect(needsConfirmation({ ...byId.cGhpc2gx, confirmedByUser: true })).toBe(false);
		expect(needsConfirmation({ source: 'upload' })).toBe(false);
	});
});
