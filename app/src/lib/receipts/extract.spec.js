// "Auslesen" against a stand-in bridge: what is sent, and what comes back onto the record.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from './blob-store.js';
import { importFile } from './import.js';
import { NeedsConfirmationError, extractReceipt, extractable, summaryFields } from './extract.js';

const ANSWER = {
	vendor: 'Wolkenfabrik Hosting GmbH',
	gross: 119,
	net: 100,
	vat: [{ rate: 19, amount: 19 }],
	currency: 'EUR',
	invoice_date: '2026-08-15',
	invoice_number: 'WF-2026-0815'
};

async function setup() {
	const { collection: receipts } = memoryCollection('receipts');
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	/** @type {any[]} */
	const sent = [];
	const client = {
		extract: async (/** @type {any} */ body) => {
			sent.push(body);
			return { extraction: ANSWER, model: 'deepseek-flash', usage: {}, attempts: [] };
		}
	};
	return { receipts, blobs, client, sent };
}

const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake');
const pdfText = async () => ({ text: 'Anbieter: Wolkenfabrik Hosting GmbH\nBrutto: 119,00 EUR' });

describe('extractReceipt', () => {
	it('sends the PDF text with the mail hints and the mail id; fills the record', async () => {
		const { receipts, blobs, client, sent } = await setup();
		const { record } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'R.PDF',
			source: 'mail',
			sourceRef: 'bWFpbA#2',
			fields: {
				mailId: 'bWFpbA',
				subject: 'Ihre Rechnung',
				from: 'Wolkenfabrik <rechnung@wolkenfabrik.example>',
				receivedAt: '2026-08-19T09:00:00Z',
				authVerdict: 'pass'
			}
		});
		const updated = await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (record),
			pdfText,
			now: () => new Date('2026-09-24T10:00:00Z')
		});
		expect(sent).toEqual([
			{
				text: 'Anbieter: Wolkenfabrik Hosting GmbH\nBrutto: 119,00 EUR',
				hints: {
					subject: 'Ihre Rechnung',
					from: 'Wolkenfabrik <rechnung@wolkenfabrik.example>',
					fileName: 'R.PDF',
					receivedAt: '2026-08-19'
				},
				source: { mailId: 'bWFpbA' }
			}
		]);
		expect(updated).toMatchObject({
			status: 'ausgelesen',
			vendor: 'Wolkenfabrik Hosting GmbH',
			amountCents: 11900,
			currency: 'EUR',
			documentDate: '2026-08-15',
			invoiceNumber: 'WF-2026-0815',
			extractionModel: 'deepseek-flash',
			extractedAt: '2026-09-24T10:00:00.000Z',
			extractionError: null
		});
	});

	it('no receipt at all ("none", e.g. a sign-in link): read, then out of the matching', async () => {
		const { receipts, blobs } = await setup();
		const client = {
			extract: async () => ({
				extraction: { document_type: 'none', vendor: 'Anthropic', gross: null, currency: null },
				model: 'deepseek-flash',
				usage: {},
				attempts: []
			})
		};
		const { record } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'link.pdf',
			source: 'upload',
			sourceRef: 'none#1',
			fields: {}
		});
		const updated = await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (record),
			pdfText
		});
		expect(updated).toMatchObject({
			status: 'ignoriert',
			amountCents: null,
			extractionError: null
		});
	});

	it('an unverified sender: nothing is sent until confirmed; then confirmedByUser goes along', async () => {
		const { receipts, blobs, client, sent } = await setup();
		const { record } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'x.pdf',
			source: 'mail',
			sourceRef: 'cGg#2',
			fields: { mailId: 'cGg', authVerdict: 'fail' }
		});
		await expect(
			extractReceipt({ client, receipts, blobs, record: /** @type {any} */ (record), pdfText })
		).rejects.toBeInstanceOf(NeedsConfirmationError);
		expect(sent).toEqual([]);
		await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ ({ ...record, confirmedByUser: true }),
			pdfText
		});
		expect(sent[0]).toMatchObject({ source: { mailId: 'cGg' }, confirmedByUser: true });
	});

	it('a mail without a file sends its subject and text; a scan and an image send nothing', async () => {
		const { receipts, blobs, client, sent } = await setup();
		const text = await receipts.put({
			source: 'mail',
			mailId: 'dA',
			subject: 'Bestellung 555',
			excerpt: 'Summe: 23,80 EUR',
			authVerdict: 'pass',
			fileCid: null,
			mime: 'text/plain',
			status: 'neu'
		});
		await extractReceipt({ client, receipts, blobs, record: text, pdfText });
		expect(sent[0].text).toBe('Bestellung 555\n\nSumme: 23,80 EUR');

		const { record: scan } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'scan.pdf',
			source: 'upload',
			sourceRef: 'upload:scan.pdf'
		});
		const noText = await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (scan),
			pdfText: async () => ({ text: '  \n ' })
		});
		expect(noText.extractionError).toBe('no-text');

		const { record: image } = await importFile({
			receipts,
			blobs,
			bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
			fileName: 'taxi.jpg',
			source: 'upload',
			sourceRef: 'upload:taxi.jpg'
		});
		const marked = await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (image),
			pdfText
		});
		expect(marked.extractionError).toBe('image');
		expect(sent).toHaveLength(1);
		expect(extractable(await receipts.list()).map((r) => r.fileName)).toEqual([]);
	});

	it('a bridge error is kept on the record and thrown', async () => {
		const { receipts, blobs } = await setup();
		const { record } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'a.pdf',
			source: 'upload',
			sourceRef: 'upload:a.pdf'
		});
		const failing = {
			extract: async () => {
				throw new Error('Kein Modell lieferte eine brauchbare Antwort');
			}
		};
		await expect(
			extractReceipt({
				client: failing,
				receipts,
				blobs,
				record: /** @type {any} */ (record),
				pdfText
			})
		).rejects.toThrow(/brauchbare/);
		const [stored] = await receipts.list();
		expect(stored.extractionError).toMatch(/brauchbare/);
		expect(stored.status).toBe('neu');
	});

	it('summaryFields: cents as integers, bad values dropped', () => {
		expect(
			summaryFields({ gross: 52.59, currency: 'EUR', invoice_date: '2026-08-02' })
		).toMatchObject({
			amountCents: 5259,
			documentDate: '2026-08-02'
		});
		expect(summaryFields({ gross: 0.1 + 0.2 }).amountCents).toBe(30);
		expect(
			summaryFields({ gross: 'viel', invoice_date: '2.8.2026', currency: 'Euro' })
		).toMatchObject({
			amountCents: null,
			documentDate: null,
			currency: 'EUR'
		});
	});
});
