// "Auslesen": a receipt's text to the bridge, the bridge's answer onto the
// record.
//
// The browser extracts a PDF's text layer (pdf.js) and sends it with the
// mail's subject and sender as hints; the bridge redacts, asks the LLM and
// checks the answer (bridge/src/llm/). The file itself never leaves the
// browser. A mail without a file sends its text excerpt. Images have no text
// layer and no OCR yet: they are marked, not sent.

import { recordEvent, tokenCount } from '../activity/events.js';
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

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * How the bridge read it, from its answer (bridge/README.md, POST /extract):
 * kept on the record, sealed like the rest. An older bridge that says less
 * leaves zeros and nulls, never `undefined` (dag-cbor has none).
 *
 * @param {any} result
 */
export function extractionInfo(result) {
	const r = result?.redactions;
	const counts =
		r && typeof r === 'object'
			? {
					terms: num(r.terms),
					iban: num(r.iban),
					email: num(r.email),
					street: num(r.street),
					postcode: num(r.postcode)
				}
			: null;
	const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
	const fallbackUsed = result?.fallback ? result.fallback.used === true : attempts.length > 1;
	return {
		model: typeof result?.model === 'string' ? result.model : null,
		fallback: fallbackUsed,
		fallbackReason: fallbackUsed
			? String(result?.fallback?.reason ?? attempts[0]?.reason ?? '') || null
			: null,
		attempts: attempts.map((/** @type {any} */ a) => ({
			model: String(a?.model ?? ''),
			ok: a?.ok === true,
			reason: String(a?.reason ?? ''),
			ms: num(a?.ms)
		})),
		ms: typeof result?.ms === 'number' ? result.ms : null,
		usage: {
			prompt: num(result?.usage?.prompt),
			completion: num(result?.usage?.completion),
			reasoning: num(result?.usage?.reasoning)
		},
		// Every attempt's tokens: a failed first try is billed too.
		tokensTotal: attempts.some((/** @type {any} */ a) => a?.usage)
			? attempts.reduce(
					(/** @type {number} */ n, /** @type {any} */ a) => n + tokenCount(a?.usage),
					0
				)
			: tokenCount(result?.usage),
		redactions: counts
			? { ...counts, total: typeof r.total === 'number' ? r.total : sum(counts) }
			: typeof r === 'number'
				? { terms: 0, iban: 0, email: 0, street: 0, postcode: 0, total: r }
				: null
	};
}

/** @param {Record<string, number>} c */
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);

/**
 * @param {object} params
 * @param {{ extract: (body: any) => Promise<any> }} params.client the bridge
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {import('../store/repository.js').StoredRecord} params.record
 * @param {(bytes: Uint8Array) => Promise<{ text: string }>} [params.pdfText]
 * @param {() => Date} [params.now]
 * @param {import('../store/repository.js').Collection} [params.events] the Verlauf
 * @returns {Promise<import('../store/repository.js').StoredRecord>} the updated record
 */
export async function extractReceipt({
	client,
	receipts,
	blobs,
	record,
	pdfText,
	now = () => new Date(),
	events
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
		const message = error instanceof Error ? error.message : String(error);
		await receipts.put({ ...record, extractionError: message });
		await recordEvent(events, 'extract', { receiptId: record.id, ok: false, error: message });
		throw error;
	}
	const info = extractionInfo(result);
	const updated = await receipts.put({
		...record,
		...summaryFields(result.extraction),
		extraction: result.extraction,
		extractionModel: result.model,
		extractionInfo: info,
		// What left this machine, as the bridge sent it: redacted. Sealed like the rest.
		extractionSent: typeof result.sentText === 'string' ? result.sentText : null,
		extractionError: null,
		extractedAt: now().toISOString(),
		status: record.status === 'zugeordnet' ? 'zugeordnet' : 'ausgelesen'
	});
	await recordEvent(events, 'extract', {
		receiptId: record.id,
		ok: true,
		model: info.model,
		fallback: info.fallback,
		fallbackReason: info.fallbackReason,
		ms: info.ms,
		tokens: info.usage,
		tokensTotal: info.tokensTotal,
		redactions: info.redactions
	});
	return updated;
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
