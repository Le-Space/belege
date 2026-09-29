// "Beleg hochladen und dieser Zahlung zuordnen": a file from the detail view
// of one booking. Stored exactly like an upload on the Belege page (sealed,
// deduplicated by content), read if it can be, then linked to this booking
// as the person's own decision (state `confirmed`) – even when the points are
// low, because the person said so. The points and reasons are kept, and
// contradictions are named: another amount, an invoice number the purpose
// does not carry.
//
// A file that is already the receipt of another booking is not moved here
// silently (one receipt, one booking: the other would lose it). The upload
// says whose it is (`linked-elsewhere`); `moveReceipt` moves it on the
// person's word, and the log says from where to where.

import { recordEvent } from '../activity/events.js';
import { confirmMatch } from '../matching/actions.js';
import { isActive } from '../matching/engine.js';
import { normalizeRef } from '../matching/normalize.js';
import { MIN_REF, receiptFacts, scorePair, txFacts } from '../matching/score.js';
import { sha256Hex } from './blob-store.js';
import { extractReceipt } from './extract.js';
import { importFile } from './import.js';

/** @typedef {import('../store/repository.js').StoredRecord} StoredRecord */

/**
 * What speaks against the pair, for the warning.
 *
 * @param {Record<string, any>} receipt read
 * @param {Record<string, any>} tx
 * @returns {('amount' | 'invoice-number')[]}
 */
export function contradictions(receipt, tx) {
	/** @type {('amount' | 'invoice-number')[]} */
	const out = [];
	const cents =
		typeof receipt.amountCents === 'number'
			? receipt.amountCents
			: typeof receipt.extraction?.gross === 'number'
				? Math.round(receipt.extraction.gross * 100)
				: null;
	if (cents !== null && Math.abs(cents) !== Math.abs(Number(tx.amountCents ?? 0))) {
		out.push('amount');
	}
	const number = normalizeRef(receipt.invoiceNumber ?? receipt.extraction?.invoice_number);
	if (number.length >= MIN_REF) {
		const text = normalizeRef(`${tx.purpose ?? ''} ${tx.endToEndId ?? ''}`);
		if (!text.includes(number)) out.push('invoice-number');
	}
	return out;
}

/**
 * @param {object} params
 * @param {import('../matching/engine.js').MatchingStore} params.store
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {{ extract: (body: any) => Promise<any> } | null} params.client the bridge, for reading; null leaves it unread
 * @param {Record<string, any>} params.tx the booking
 * @param {{ name: string, bytes: Uint8Array }} params.file
 * @param {{ companyNames?: string[] }} [params.ctx]
 * @param {(bytes: Uint8Array) => Promise<{ text: string }>} [params.pdfText]
 * @returns {Promise<{ outcome: 'linked' | 'linked-elsewhere' | 'unsupported' | 'too-large', receipt: StoredRecord | null, duplicate: boolean, score: number | null, reasons: string[], warnings: ('amount' | 'invoice-number' | 'unread')[], extractError: string | null, elsewhere?: StoredRecord | null }>}
 */
export async function attachUpload({ store, blobs, client, tx, file, ctx = {}, pdfText }) {
	const imported = await importFile({
		receipts: store.receipts,
		blobs,
		bytes: file.bytes,
		fileName: file.name,
		source: 'upload',
		sourceRef: `upload:${file.name}`
	});
	/** @type {StoredRecord | null} */
	let receipt = imported.record;
	const duplicate = imported.outcome === 'duplicate';
	if (duplicate) {
		// The same file is here already: that receipt is the one.
		const sha = await sha256Hex(file.bytes);
		receipt = (await store.receipts.list()).find((r) => r.sha256 === sha) ?? null;
	}
	if (!receipt) {
		return {
			outcome: imported.outcome === 'too-large' ? 'too-large' : 'unsupported',
			receipt: null,
			duplicate,
			score: null,
			reasons: [],
			warnings: [],
			extractError: null
		};
	}

	// Already another booking's receipt: say so, move nothing.
	if (duplicate) {
		const other = (await store.matches.list({ where: (m) => m.receiptId === receipt?.id })).find(
			(m) => isActive(m) && m.transactionId !== tx.id
		);
		if (other) {
			return {
				outcome: 'linked-elsewhere',
				receipt,
				duplicate,
				score: null,
				reasons: [],
				warnings: [],
				extractError: null,
				elsewhere: (await store.transactions.get(other.transactionId)) ?? null
			};
		}
	}

	/** @type {string | null} */
	let extractError = null;
	if (!receipt.extraction && client && !String(receipt.mime).startsWith('image/')) {
		try {
			receipt = await extractReceipt({
				client,
				receipts: store.receipts,
				blobs,
				record: receipt,
				pdfText,
				events: store.events
			});
		} catch (error) {
			extractError = error instanceof Error ? error.message : String(error);
			receipt = (await store.receipts.get(receipt.id)) ?? receipt;
		}
	}

	const facts = receipt.extraction ? receiptFacts(receipt, ctx) : null;
	const { score, reasons } = facts ? scorePair(facts, txFacts(tx)) : { score: null, reasons: [] };
	const match = await confirmMatch(
		store,
		{ receiptId: receipt.id, transactionId: tx.id, score, reasons: [...reasons, 'manual'] },
		{ log: false }
	);
	/** @type {('amount' | 'invoice-number' | 'unread')[]} */
	const warnings = receipt.extraction ? contradictions(receipt, tx) : ['unread'];
	await recordEvent(store.events, 'decision', {
		action: 'upload-link',
		receiptId: receipt.id,
		transactionId: tx.id,
		matchId: match.id,
		score,
		duplicate,
		warnings
	});
	return { outcome: 'linked', receipt, duplicate, score, reasons, warnings, extractError };
}

/**
 * "Hierher umhängen": the person moves a receipt from another booking to this
 * one. The other booking needs a receipt again; the log says so.
 *
 * @param {object} params
 * @param {import('../matching/engine.js').MatchingStore} params.store
 * @param {string} params.receiptId
 * @param {Record<string, any>} params.tx this booking
 * @param {string} params.fromTransactionId the booking it was the receipt of
 * @param {{ companyNames?: string[] }} [params.ctx]
 */
export async function moveReceipt({ store, receiptId, tx, fromTransactionId, ctx = {} }) {
	const receipt = await store.receipts.get(receiptId);
	if (!receipt) throw new Error(`No receipt ${receiptId}`);
	const facts = receipt.extraction ? receiptFacts(receipt, ctx) : null;
	const { score, reasons } = facts ? scorePair(facts, txFacts(tx)) : { score: null, reasons: [] };
	const match = await confirmMatch(
		store,
		{ receiptId, transactionId: tx.id, score, reasons: [...reasons, 'manual'] },
		{ log: false }
	);
	await recordEvent(store.events, 'decision', {
		action: 'receipt-moved',
		receiptId,
		transactionId: tx.id,
		fromTransactionId,
		matchId: match.id
	});
	return match;
}
