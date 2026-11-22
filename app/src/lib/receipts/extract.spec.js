// "Auslesen" against a stand-in bridge: what is sent, and what comes back onto the record.
import { sealCall } from '@le-space/bridge-protocol/seal';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from './blob-store.js';
import { importFile } from './import.js';
import { NeedsConfirmationError, extractReceipt, extractable, summaryFields } from './extract.js';
import { setBridgeRequestLimit } from '../sync/bridge-limit.js';
import { checkRequestSize } from '../sync/remote-bridge.js';
import { MAX_TEXT, OMITTED } from './text-budget.js';

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

	it('a scan or photo from Paperless is read with its OCR text (#318)', async () => {
		const { receipts, blobs, client, sent } = await setup();
		const ocr = 'Musterbaumarkt\nSchrauben 4,99\nSUMME EUR 4,99';
		const { record: photo } = await importFile({
			receipts,
			blobs,
			bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 4]),
			fileName: 'scan-0001.jpg',
			source: 'paperless',
			sourceRef: 'paperless:12',
			fields: { subject: 'Kassenbon Baumarkt', paperlessContent: ocr }
		});
		const { record: scan } = await importFile({
			receipts,
			blobs,
			bytes: new TextEncoder().encode('%PDF-1.4 scanned'),
			fileName: 'scan.pdf',
			source: 'paperless',
			sourceRef: 'paperless:13',
			fields: { paperlessContent: ocr }
		});
		const { record: short } = await importFile({
			receipts,
			blobs,
			bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6]),
			fileName: 'blurry.jpg',
			source: 'paperless',
			sourceRef: 'paperless:14',
			fields: { paperlessContent: '4,99' }
		});
		// Both with OCR text are taken by "Alle neuen auslesen"; the one without enough is not.
		expect(
			extractable(await receipts.list())
				.map((r) => r.fileName)
				.sort()
		).toEqual(['scan-0001.jpg', 'scan.pdf']);

		await extractReceipt({ client, receipts, blobs, record: /** @type {any} */ (photo), pdfText });
		await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (scan),
			pdfText: async () => ({ text: ' ' })
		});
		expect(sent.map((b) => b.text)).toEqual([ocr, ocr]);
		expect(sent[0].hints).toMatchObject({
			subject: 'Kassenbon Baumarkt',
			fileName: 'scan-0001.jpg'
		});

		const blurry = await extractReceipt({
			client,
			receipts,
			blobs,
			record: /** @type {any} */ (short),
			pdfText
		});
		expect(blurry.extractionError).toBe('image');
		expect(sent).toHaveLength(2);
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

describe('a long text (#975)', () => {
	afterEach(() => setBridgeRequestLimit(null));

	/** Many pages of made-up line items: the vendor and number on the first, the total on the last. */
	const pages = (/** @type {string} */ item) =>
		[
			'Wolkenfabrik Hosting GmbH\nRechnungsnummer WF-2026-0815\nRechnungsdatum 15.08.2026',
			...Array.from({ length: 120 }, (_, p) =>
				Array.from({ length: 30 }, (_, i) => `Seite ${p + 2}, ${item} ${i + 1}: 12,34 EUR`).join(
					'\n'
				)
			),
			'Summe netto 100,00 EUR\nUSt 19 % 19,00 EUR\nGesamtbetrag 119,00 EUR'
		].join('\f\n');

	/** @param {string} text */
	async function read(text) {
		const { receipts, blobs, client, sent } = await setup();
		const { record: imported } = await importFile({
			receipts,
			blobs,
			bytes: pdfBytes,
			fileName: 'lang.pdf',
			source: 'upload',
			sourceRef: `long#${Math.random()}`,
			fields: {}
		});
		const record = /** @type {NonNullable<typeof imported>} */ (imported);
		const updated = await extractReceipt({
			client,
			receipts,
			blobs,
			record,
			pdfText: async () => ({ text })
		});
		return { body: sent[0], updated };
	}

	it('to a bridge from before (64 KiB): head and tail, sealed within the limit, the record says so', async () => {
		const text = pages('Leistungszeitraum mit Überstunden für Größenänderung');
		expect(text.length).toBeGreaterThan(MAX_TEXT * 2);
		const { body, updated } = await read(text);
		expect(body.text).toContain('Rechnungsnummer WF-2026-0815');
		expect(body.text).toContain('Gesamtbetrag 119,00 EUR');
		expect(body.text).toContain(OMITTED);
		expect(body.text.length).toBeLessThanOrEqual(MAX_TEXT);
		// As the client sends it (20 terms) and the stream seals it: within UCEP's 64 KiB.
		const args = {
			...body,
			redactTerms: Array.from({ length: 20 }, (_, i) => `Musterbegriff ${i}`.padEnd(200, 'x'))
		};
		const call = await sealCall(
			crypto.getRandomValues(new Uint8Array(32)),
			{ consumer: '12D3KooWa', provider: '12D3KooWb', command: 'llm.extract' },
			args
		);
		expect(() => checkRequestSize('llm.extract', call.sent)).not.toThrow();
		expect(updated.extractionInfo.shortened).toEqual({
			chars: text.length,
			sent: body.text.length
		});
	});

	it('a text of many umlauts: cut for 64 KiB, whole for a bridge that states 1 MiB', async () => {
		const text = `Wolkenfabrik Hosting GmbH ${'äöüßÄÖÜ '.repeat(3500)} Gesamtbetrag 119,00 EUR`;
		expect(text.length).toBeLessThan(MAX_TEXT);
		expect(new TextEncoder().encode(text).length).toBeGreaterThan(44 * 1024);
		const small = await read(text);
		expect(small.body.text).not.toBe(text);
		expect(small.body.text).toContain('Gesamtbetrag 119,00 EUR');

		setBridgeRequestLimit(() => 1024 * 1024);
		const big = await read(text);
		expect(big.body.text).toBe(text);
		expect(big.updated.extractionInfo.shortened).toBeNull();
	});

	it('a short text goes whole, and the record says nothing was left out', async () => {
		const { body, updated } = await read('Wolkenfabrik Hosting GmbH\nGesamtbetrag 119,00 EUR');
		expect(body.text).toBe('Wolkenfabrik Hosting GmbH\nGesamtbetrag 119,00 EUR');
		expect(updated.extractionInfo.shortened).toBeNull();
	});
});
