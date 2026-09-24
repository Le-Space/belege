// "Auslesen": a receipt's text to the bridge, the bridge's answer onto the
// record.
//
// The browser extracts a PDF's text layer (pdf.js) and sends it with the
// mail's subject and sender as hints; the bridge redacts, asks the LLM and
// checks the answer (bridge/src/llm/). The file itself never leaves the
// browser. A mail without a file sends its text excerpt. Images have no text
// layer and no OCR yet: they are marked, not sent.

import { needsConfirmation } from './import.js';

/** Fewer characters than this: a scan without a text layer. */
const MIN_TEXT = 20;

export class NeedsConfirmationError extends Error {
	constructor() {
		super('Der Absender ist nicht bestätigt: erst prüfen und freigeben.');
		this.name = 'NeedsConfirmationError';
	}
}

/**
 * The fields the list shows, from the bridge's answer.
 *
 * @param {any} x the extraction
 */
export function summaryFields(x) {
	const gross = typeof x?.gross === 'number' && Number.isFinite(x.gross) ? x.gross : null;
	return {
		vendor: typeof x?.vendor === 'string' && x.vendor.trim() ? x.vendor.trim() : null,
		amountCents: gross === null ? null : Math.round(gross * 100),
		currency: typeof x?.currency === 'string' && /^[A-Z]{3}$/.test(x.currency) ? x.currency : 'EUR',
		documentDate:
			typeof x?.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date)
				? x.invoice_date
				: null,
		invoiceNumber: typeof x?.invoice_number === 'string' ? x.invoice_number : null
	};
}

/**
 * @param {object} params
 * @param {{ extract: (body: any) => Promise<any> }} params.client the bridge
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {import('../store/repository.js').StoredRecord} params.record
 * @param {(bytes: Uint8Array) => Promise<{ text: string }>} [params.pdfText]
 * @param {() => Date} [params.now]
 * @returns {Promise<import('../store/repository.js').StoredRecord>} the updated record
 */
export async function extractReceipt({
	client,
	receipts,
	blobs,
	record,
	pdfText,
	now = () => new Date()
}) {
	if (needsConfirmation(record)) throw new NeedsConfirmationError();

	if (record.mime?.startsWith('image/')) {
		return receipts.put({
			...record,
			extractionError: 'image'
		});
	}

	let text = '';
	if (record.fileCid && record.mime === 'application/pdf') {
		const read = pdfText ?? (await import('./pdf.js')).extractPdfText;
		text = (await read(await blobs.get(record.fileCid))).text;
		if (text.replace(/\s+/g, '').length < MIN_TEXT) {
			return receipts.put({ ...record, extractionError: 'no-text' });
		}
	} else {
		text = [record.subject, record.excerpt].filter(Boolean).join('\n\n');
	}

	/** @type {Record<string, string>} */
	const hints = {};
	if (record.subject) hints.subject = record.subject;
	if (record.from) hints.from = record.from;
	if (record.fileName) hints.fileName = record.fileName;
	if (record.receivedAt) hints.receivedAt = String(record.receivedAt).slice(0, 10);

	let result;
	try {
		result = await client.extract({
			text,
			hints,
			...(record.source === 'mail' && record.mailId ? { source: { mailId: record.mailId } } : {}),
			...(record.confirmedByUser === true ? { confirmedByUser: true } : {})
		});
	} catch (error) {
		await receipts.put({
			...record,
			extractionError: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
	return receipts.put({
		...record,
		...summaryFields(result.extraction),
		extraction: result.extraction,
		extractionModel: result.model,
		extractionError: null,
		extractedAt: now().toISOString(),
		status: record.status === 'zugeordnet' ? 'zugeordnet' : 'ausgelesen'
	});
}

/**
 * The receipts "Alle neuen auslesen" takes: new, not waiting for a yes, not an image.
 *
 * @param {import('../store/repository.js').StoredRecord[]} records
 */
export function extractable(records) {
	return records.filter(
		(r) =>
			r.status === 'neu' &&
			!r.extraction &&
			!needsConfirmation(r) &&
			!String(r.mime ?? '').startsWith('image/') &&
			r.extractionError !== 'no-text'
	);
}
