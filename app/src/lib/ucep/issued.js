// "Rechnungen abgleichen" (issue #8): the paired invoicing app's issued
// invoices come into Belege as our own invoices, the matching links them to
// the payments that paid them, and the app learns which were paid, when and
// how much (Le-Space/ucep-spec, extensions/invoice.md 0.2.0: `list-issued`,
// `get-pdf`, `record-payment`).
//
// The bank data stays here. The app is told only the day, the amount and the
// payment's id in Belege (the reference it keys the payment by) – never the
// account, the payer's IBAN or the purpose text. Who links a payment is the
// matching's rules or the person, as for every receipt; nothing is linked
// because the app said so.

import { isActive } from '../matching/engine.js';
import { setAsideReceipt } from '../matching/actions.js';
import { importFile } from '../receipts/import.js';
import { INVOICE_EXTENSION, decimalFromUnits, reach } from './consumer.js';
import { t } from '../i18n/index.js';

/** The receipts' `source` for an issued invoice, and its `sourceRef` prefix. */
export const ISSUED_SOURCE = 'invoice-app';
/** What a payment is keyed by in the app: `{ system, id }` with the booking's id. */
export const REFERENCE_SYSTEM = 'belege';

/**
 * @typedef {{ value: string, currency: string }} Money
 * @typedef {{ paidOn: string, amount: Money, reference: { system: string, id: string } }} Payment
 * @typedef {object} IssuedInvoice as `list-issued` gives it
 * @property {string} documentId
 * @property {string} number
 * @property {'issued' | 'cancelled'} state
 * @property {string} issuedOn
 * @property {string} [dueOn]
 * @property {{ name: string }} customer
 * @property {Money} total
 * @property {Money} [paid]
 * @property {Payment[]} [payments]
 */

/**
 * A decimal string in whole units as cents, without floats: "119.5" → 11950.
 * Null for anything else.
 *
 * @param {unknown} value
 */
export function centsOf(value) {
	const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
	if (!m) return null;
	const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
	return m[1] ? -cents : cents;
}

/** @param {string} documentId */
export const sourceRefOf = (documentId) => `${ISSUED_SOURCE}:${documentId}`;

/**
 * What the receipt of an issued invoice carries: ours by where it came from,
 * the customer to compare with the payer, and the due date for the window.
 *
 * @param {IssuedInvoice} inv
 */
export function receiptFieldsOf(inv) {
	return {
		confirmedByUser: true,
		ownInvoice: true,
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		vendor: 'Eigene Rechnung',
		customer: String(inv.customer?.name ?? ''),
		invoiceNumber: String(inv.number),
		documentDate: String(inv.issuedOn),
		...(inv.dueOn ? { dueOn: String(inv.dueOn) } : {}),
		amountCents: centsOf(inv.total?.value) ?? 0,
		currency: String(inv.total?.currency ?? 'EUR'),
		issuedBy: { documentId: inv.documentId, number: inv.number }
	};
}

/**
 * The extraction of an issued invoice, from what the app said: the same keys
 * a model's reading has (receipts/extract.js), so the matching and the views
 * treat it like any read receipt.
 *
 * @param {IssuedInvoice} inv
 */
export function extractionOf(inv) {
	const cents = centsOf(inv.total?.value) ?? 0;
	return {
		// A Storno comes as an issued document with a negative total: our credit note.
		document_type: cents < 0 ? 'credit_note' : 'invoice',
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		vendor: 'Eigene Rechnung',
		invoice_number: String(inv.number),
		invoice_date: String(inv.issuedOn),
		due_or_debit_date: inv.dueOn ? String(inv.dueOn) : null,
		gross: cents / 100,
		currency: String(inv.total?.currency ?? 'EUR'),
		from: 'invoice-app'
	};
}

/**
 * What to tell the app about one invoice: the payments linked to its receipt
 * now, against those Belege reported before. A payment that paid several
 * invoices at once counts each invoice's total, not the whole transfer.
 *
 * @param {IssuedInvoice} inv
 * @param {{ tx: Record<string, any>, shared: boolean }[]} linked the receipt's active links
 * @returns {{ record: Payment[], remove: string[] }} payments to record, references to remove
 */
export function paymentPlan(inv, linked) {
	const currency = String(inv.total?.currency ?? 'EUR');
	const total = centsOf(inv.total?.value) ?? 0;
	/** @type {Map<string, Payment>} */
	const wanted = new Map();
	for (const { tx, shared } of linked) {
		const cents = Number(tx.amountCents ?? 0);
		if (cents <= 0 || String(tx.currency ?? 'EUR') !== currency) continue;
		const amount = shared ? Math.min(cents, total) : cents;
		wanted.set(String(tx.id), {
			paidOn: String(tx.bookedOn),
			amount: { value: decimalFromUnits(amount, 2), currency },
			reference: { system: REFERENCE_SYSTEM, id: String(tx.id) }
		});
	}
	const reported = new Map(
		(inv.payments ?? [])
			.filter((p) => p.reference?.system === REFERENCE_SYSTEM)
			.map((p) => [String(p.reference.id), p])
	);
	const record = [...wanted.values()].filter((p) => {
		const before = reported.get(p.reference.id);
		return (
			!before ||
			before.paidOn !== p.paidOn ||
			centsOf(before.amount?.value) !== centsOf(p.amount.value)
		);
	});
	const remove = [...reported.keys()].filter((id) => !wanted.has(id));
	return { record, remove };
}

/**
 * Every issued invoice, page by page.
 *
 * @param {any} consumer
 * @param {string} peerId
 * @param {{ since?: string }} [options]
 * @returns {Promise<IssuedInvoice[]>}
 */
export async function listIssued(consumer, peerId, { since } = {}) {
	/** @type {IssuedInvoice[]} */
	const all = [];
	/** @type {string | null} */
	let cursor = null;
	do {
		/** @type {{ invoices?: IssuedInvoice[], next?: string | null }} */
		const page = await consumer.call(peerId, INVOICE_EXTENSION, 'list-issued', {
			...(since ? { since } : {}),
			...(cursor ? { cursor } : {}),
			limit: 200
		});
		all.push(...(page?.invoices ?? []));
		cursor = page?.next ?? null;
	} while (cursor);
	return all;
}

/** @param {string} value */
function fromBase64(value) {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes))
	);
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {object} IssuedSyncResult
 * @property {number} invoices issued invoices the app listed
 * @property {number} added new receipts
 * @property {number} pdfLater invoices whose PDF comes only over a direct connection
 * @property {number} reported payments recorded in the app
 * @property {number} removed payments taken back in the app
 * @property {number} paid invoices the app now counts as paid
 */

/**
 * "Rechnungen abgleichen": fetch the issued invoices, keep the new ones as
 * receipts, let the matching run, and tell the app what is paid.
 *
 * @param {object} params
 * @param {any} params.consumer
 * @param {import('./consumer.js').PairedApp} params.app
 * @param {import('../matching/engine.js').MatchingStore} params.store
 * @param {import('../receipts/blob-store.js').BlobStore} params.blobs
 * @param {() => Promise<unknown>} params.match runs the matching over the books
 * @returns {Promise<IssuedSyncResult>}
 */
export async function syncIssuedInvoices({ consumer, app, store, blobs, match }) {
	if (!(await reach(consumer, app.addrs))) {
		throw new Error(t('messages.ucep.unreachable'));
	}
	const invoices = await listIssued(consumer, app.peerId).catch((/** @type {any} */ e) => {
		if (e?.code === 'UNKNOWN_COMMAND') {
			throw new Error(t('messages.ucep.oldVersion'));
		}
		if (e?.code === 'SCOPE_MISSING' || e?.code === 'PAIRING_REQUIRED') {
			throw new Error(t('messages.ucep.scopeMissing'));
		}
		throw e;
	});
	/** @type {IssuedSyncResult} */
	const result = {
		invoices: invoices.length,
		added: 0,
		pdfLater: 0,
		reported: 0,
		removed: 0,
		paid: 0
	};

	const receipts = await store.receipts.list({ includeDeleted: true });
	const byRef = new Map(
		receipts.filter((r) => r.source === ISSUED_SOURCE).map((r) => [String(r.sourceRef), r])
	);
	const linkedIds = async () =>
		new Set((await store.matches.list()).filter(isActive).map((m) => m.receiptId));

	for (const inv of invoices) {
		const known = byRef.get(sourceRefOf(inv.documentId));
		if (inv.state === 'cancelled') {
			if (known && !known.deleted && !known.setAside && !(await linkedIds()).has(known.id)) {
				await setAsideReceipt(store, known.id);
			}
			continue;
		}
		if (known) continue;
		const pdf = await consumer.call(app.peerId, INVOICE_EXTENSION, 'get-pdf', {
			documentId: inv.documentId
		});
		if (!pdf?.base64) {
			result.pdfLater++;
			continue;
		}
		const bytes = fromBase64(pdf.base64);
		if ((await sha256Hex(bytes)) !== pdf.sha256) {
			throw new Error(t('messages.ucep.invoicePdfMismatch', { number: inv.number }));
		}
		const { record } = await importFile({
			receipts: store.receipts,
			blobs,
			bytes,
			fileName: `${inv.number}.pdf`,
			source: ISSUED_SOURCE,
			sourceRef: sourceRefOf(inv.documentId),
			fields: receiptFieldsOf(inv)
		});
		if (record) {
			// Read already: the app said what is on it, no model needs to (the matching takes read receipts only).
			const read = await store.receipts.put({
				...record,
				extraction: extractionOf(inv),
				status: 'ausgelesen'
			});
			byRef.set(sourceRefOf(inv.documentId), read);
			result.added++;
		}
	}

	await match();

	const matches = (await store.matches.list()).filter(isActive);
	/** @type {Map<string, number>} links per transaction: a transfer paying several invoices */
	const perTx = new Map();
	for (const m of matches) perTx.set(m.transactionId, (perTx.get(m.transactionId) ?? 0) + 1);
	for (const inv of invoices) {
		if (inv.state !== 'issued') continue;
		const receipt = byRef.get(sourceRefOf(inv.documentId));
		if (!receipt && !(inv.payments ?? []).length) continue;
		/** @type {{ tx: Record<string, any>, shared: boolean }[]} */
		const linked = [];
		for (const m of matches.filter((x) => receipt && x.receiptId === receipt.id)) {
			const tx = await store.transactions.get(m.transactionId);
			if (tx && !tx.deleted) linked.push({ tx, shared: (perTx.get(m.transactionId) ?? 0) > 1 });
		}
		const plan = paymentPlan(inv, linked);
		let state = null;
		for (const p of plan.record) {
			state = await consumer.call(app.peerId, INVOICE_EXTENSION, 'record-payment', {
				documentId: inv.documentId,
				...p
			});
			result.reported++;
		}
		for (const id of plan.remove) {
			state = await consumer.call(app.peerId, INVOICE_EXTENSION, 'record-payment', {
				documentId: inv.documentId,
				paidOn: null,
				reference: { system: REFERENCE_SYSTEM, id }
			});
			result.removed++;
		}
		const paidNow = state ? state.state : null;
		const paidBefore =
			(centsOf(inv.paid?.value) ?? 0) >= (centsOf(inv.total?.value) ?? 0) &&
			(centsOf(inv.total?.value) ?? 0) > 0;
		if (paidNow === 'paid' || paidNow === 'overpaid' || (paidNow === null && paidBefore)) {
			result.paid++;
		}
	}
	return result;
}
