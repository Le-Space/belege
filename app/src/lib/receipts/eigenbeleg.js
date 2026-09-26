// "Eigenbeleg erstellen": a receipt the company writes itself for a payment
// that has no receipt from the other side, e.g. fees paid on a blockchain
// that issues no invoices, or a payment whose invoice cannot be had.
//
// An Eigenbeleg is not an invoice. It has its own number range (EB-YYYY-NNN),
// says what was paid, to whom, when and how much, and why there is no
// receipt from the other side; who wrote it and when is printed on it, with a
// line to sign. For a crypto payment it also carries quantity, rate with its
// source, and the transaction reference.
//
// It becomes an ordinary receipt: stored sealed like an upload (source
// `eigenbeleg`), linked to its booking as the person's decision, numbered by
// the export and put into the ZIP like any other receipt.
//
// Whether an Eigenbeleg is accepted, and up to which amount, is the tax
// adviser's call (docs/export.md).

import { recordEvent } from '../activity/events.js';
import { accountLabel, displayPurpose } from '../bank/format.js';
import { hasQuantity } from '../assets/valuation.js';
import { confirmMatch } from '../matching/actions.js';
import { importFile } from './import.js';

/** @typedef {import('../store/repository.js').StoredRecord} StoredRecord */

const NUMBER = /^EB-(\d{4})-(\d{3,})$/;

/**
 * The next number in the Eigenbeleg range of a year: EB-2026-001, EB-2026-002, …
 *
 * @param {Record<string, any>[]} receipts all of them, set aside ones too
 * @param {string} year YYYY
 */
export function nextSelfNumber(receipts, year) {
	let highest = 0;
	for (const r of receipts) {
		const m = NUMBER.exec(String(r.selfNumber ?? ''));
		if (m && m[1] === year) highest = Math.max(highest, Number(m[2]));
	}
	return `EB-${year}-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * What the form starts with. A crypto payment gets a reason to start from;
 * for any other payment the person writes it.
 *
 * @param {Record<string, any>} tx
 */
export function eigenbelegDraft(tx) {
	return {
		counterparty: String(tx.counterparty ?? '').trim(),
		description: displayPurpose(tx.purpose),
		reason: hasQuantity(tx)
			? 'Die Zahlung erfolgte auf der Blockchain; der Empfänger stellt dafür keine Rechnung aus.'
			: ''
	};
}

/**
 * @typedef {object} EigenbelegDocument what the PDF shows
 * @property {string} number
 * @property {string} issuer our company, '' when none is set
 * @property {string} date YYYY-MM-DD, of the payment
 * @property {number} amountCents signed, from the account's view
 * @property {string} account
 * @property {string} counterparty
 * @property {string} purpose the bank's purpose, as the booking has it
 * @property {string} description what was paid for
 * @property {string} reason why there is no receipt from the other side
 * @property {string} txRef '' when none
 * @property {{ asset: string, quantity: string, decimals: number, rate: string, source: string, at: string } | null} crypto
 * @property {string} createdAt ISO 8601
 * @property {string} createdBy who wrote it (a name, or the identity's DID)
 */

/**
 * The document for a booking and what the person wrote.
 *
 * @param {object} params
 * @param {Record<string, any>} params.tx
 * @param {Record<string, any> | null} params.account
 * @param {{ counterparty: string, description: string, reason: string }} params.input
 * @param {string} params.number
 * @param {string} params.issuer
 * @param {string} params.createdBy
 * @param {Date} params.now
 * @returns {EigenbelegDocument}
 */
export function eigenbelegDocument({ tx, account, input, number, issuer, createdBy, now }) {
	const v = tx.valuation;
	return {
		number,
		issuer,
		date: String(tx.bookedOn),
		amountCents: Number(tx.amountCents ?? 0),
		account: account ? accountLabel(account) : '',
		counterparty: input.counterparty.trim(),
		purpose: displayPurpose(tx.purpose),
		description: input.description.trim(),
		reason: input.reason.trim(),
		txRef: String(tx.txRef ?? ''),
		crypto:
			hasQuantity(tx) && v?.rate
				? {
						asset: String(tx.asset),
						quantity: String(tx.quantity),
						decimals: Number(tx.decimals),
						rate: String(v.rate),
						source: String(v.source ?? ''),
						at: String(v.at ?? '')
					}
				: null,
		createdAt: now.toISOString(),
		createdBy
	};
}

/**
 * Write the Eigenbeleg, store it as a receipt and link it to its booking.
 *
 * @param {object} params
 * @param {import('../matching/engine.js').MatchingStore} params.store
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {Record<string, any>} params.tx
 * @param {Record<string, any> | null} params.account
 * @param {{ counterparty: string, description: string, reason: string }} params.input
 * @param {string} [params.issuer] our company's name
 * @param {string} [params.createdBy]
 * @param {() => Date} [params.now]
 * @returns {Promise<{ receipt: StoredRecord, number: string }>}
 */
export async function createEigenbeleg({
	store,
	blobs,
	tx,
	account,
	input,
	issuer = '',
	createdBy = '',
	now = () => new Date()
}) {
	if (!input.description.trim())
		throw new Error('Was wurde bezahlt? Das gehört auf den Eigenbeleg.');
	if (input.reason.trim().length < 10) {
		throw new Error('Warum gibt es keinen Beleg der Gegenseite? Ein Satz genügt.');
	}
	const all = await store.receipts.list({ includeDeleted: true });
	const existing = all.find(
		(r) => !r.deleted && r.source === 'eigenbeleg' && r.sourceRef === `eigenbeleg:${tx.id}`
	);
	if (existing) {
		throw new Error(`Für diese Zahlung gibt es schon den Eigenbeleg ${existing.selfNumber}.`);
	}

	const created = now();
	const number = nextSelfNumber(all, String(tx.bookedOn).slice(0, 4));
	const doc = eigenbelegDocument({ tx, account, input, number, issuer, createdBy, now: created });
	const { eigenbelegPdf } = await import('./eigenbeleg-pdf.js');
	const bytes = await eigenbelegPdf(doc);

	const { record } = await importFile({
		receipts: store.receipts,
		blobs,
		bytes,
		fileName: `${number}.pdf`,
		source: 'eigenbeleg',
		sourceRef: `eigenbeleg:${tx.id}`,
		fields: {
			confirmedByUser: true,
			vendor: 'Eigenbeleg',
			documentDate: doc.date,
			amountCents: Math.abs(doc.amountCents),
			currency: 'EUR',
			selfNumber: number,
			selfReceipt: {
				counterparty: doc.counterparty,
				description: doc.description,
				reason: doc.reason,
				createdAt: doc.createdAt,
				createdBy: doc.createdBy
			}
		}
	});
	if (!record) throw new Error('Der Eigenbeleg konnte nicht gespeichert werden.');

	await confirmMatch(
		store,
		{ receiptId: record.id, transactionId: tx.id, score: null, reasons: ['manual', 'eigenbeleg'] },
		{ log: false }
	);
	await recordEvent(store.events, 'decision', {
		action: 'eigenbeleg',
		receiptId: record.id,
		transactionId: tx.id,
		number
	});
	return { receipt: (await store.receipts.get(record.id)) ?? record, number };
}
