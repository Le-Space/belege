// The documents that stand for wages and taxes (issue #233, part 2): a
// payroll run's payslips or journal, the wage-tax return, a contribution
// statement, a tax assessment or advance return. Payroll.js already says such
// payments need no receipt of their own; here one uploaded document is linked
// to all the payments it stands for – the wages of a month to their payroll,
// the wage tax to its return – so the receipt is found from the payment, and
// the payment from the receipt.
//
// What a document is and which period it covers is proposed from its file
// name, subject and text; a person confirms, and picks the payments (those of
// its kind and period are ticked). Nothing is linked by itself.

import { recordEvent } from '../activity/events.js';
import { confirmMatch } from './actions.js';
import { isActive, syncLinks } from './engine.js';
import { periodOf } from './payroll.js';

/** @typedef {Record<string, any>} Rec */

/** @typedef {'payroll' | 'wage-tax-return' | 'contributions' | 'tax-assessment'} DocKind */

/** The payments each kind of document stands for (payroll.js kinds). */
export const DOC_KINDS = /** @type {const} */ ({
	payroll: ['wage'],
	'wage-tax-return': ['payroll-tax'],
	contributions: ['social-security'],
	'tax-assessment': ['tax-payment']
});

/** What each kind prints; the first that fits wins. */
const WORDS = /** @type {[DocKind, RegExp][]} */ ([
	['wage-tax-return', /lohnsteuer-?anmeldung|lohnsteueranmeldung/i],
	['contributions', /beitragsnachweis|beitragsschätzung|beitragserhebung/i],
	[
		'payroll',
		/lohnjournal|lohnabrechnung|gehaltsabrechnung|entgeltabrechnung|verdienstabrechnung|lohnkonto|payslip|payroll/i
	],
	[
		'tax-assessment',
		/steuerbescheid|bescheid über|umsatzsteuer-?voranmeldung|ust-?va|vorauszahlungsbescheid|festsetzung/i
	]
]);

/**
 * What a receipt looks like as a payroll or tax document, and its period.
 *
 * @param {Rec} receipt
 * @returns {{ kind: DocKind, period: string | null } | null}
 */
export function guessPayrollDoc(receipt) {
	const text = [
		receipt.fileName,
		receipt.subject,
		receipt.vendor,
		receipt.extraction?.vendor,
		receipt.extraction?.document_type,
		receipt.text
	]
		.filter(Boolean)
		.join(' ');
	const hit = WORDS.find(([, re]) => re.test(text));
	if (!hit) return null;
	return { kind: hit[0], period: periodOf(text) };
}

/** `2025-12`, `2025-Q4`, `2024`, `2024/2025`: a period as payroll.js gives it. */
export const PERIOD = /^(20\d{2}(-(0[1-9]|1[0-2]|Q[1-4]))?|20\d{2}\/20\d{2})$/;

/**
 * The payments a document of this kind and period stands for: classified as
 * its kind (payroll.js), of that period – by the purpose's period, else, for a
 * month, the month it was booked in.
 *
 * @param {{ kind: DocKind, period: string }} doc
 * @param {Rec[]} transactions
 * @param {Record<string, any>} classifications by transaction id
 * @returns {Rec[]} oldest first
 */
export function paymentsFor({ kind, period }, transactions, classifications) {
	const kinds = /** @type {readonly string[]} */ (DOC_KINDS[kind] ?? []);
	return transactions
		.filter((tx) => {
			if (tx.deleted) return false;
			const c = classifications[String(tx.id)];
			if (!c || !kinds.includes(c.kind)) return false;
			if (c.period) return c.period === period;
			return /^\d{4}-\d{2}$/.test(period) && String(tx.bookedOn ?? '').slice(0, 7) === period;
		})
		.sort((a, b) => String(a.bookedOn).localeCompare(String(b.bookedOn)));
}

/**
 * Keep a receipt as a payroll or tax document of a period, linked to the
 * payments it stands for – alongside each other, as one invoice paid in
 * instalments is (actions.js `alongside`).
 *
 * @param {any} store receipts, transactions, matches, events
 * @param {string} receiptId
 * @param {{ kind: DocKind, period: string }} doc
 * @param {string[]} transactionIds
 */
export async function linkPayrollDoc(store, receiptId, { kind, period }, transactionIds) {
	if (!(kind in DOC_KINDS)) throw new Error(`Not a payroll document kind: ${kind}`);
	if (!PERIOD.test(period))
		throw Object.assign(new Error(`Not a period: ${period}`), { code: 'period' });
	const receipt = await store.receipts.get(receiptId);
	if (!receipt || receipt.deleted) throw new Error(`No receipt ${receiptId}`);
	await store.receipts.put({ ...receipt, payrollDoc: { kind, period } });
	for (const transactionId of transactionIds) {
		await confirmMatch(
			store,
			{ receiptId, transactionId, reasons: ['manual', 'payroll-doc'], alongside: true },
			{ log: false }
		);
	}
	await recordEvent(store.events, 'decision', {
		action: 'payroll-doc',
		receiptId,
		kind,
		period,
		count: transactionIds.length
	});
}

/**
 * No payroll or tax document after all: its links let go, the payments
 * covered again by their kind alone.
 *
 * @param {any} store
 * @param {string} receiptId
 */
export async function unlinkPayrollDoc(store, receiptId) {
	const receipt = await store.receipts.get(receiptId);
	if (!receipt) return;
	for (const m of await store.matches.list({
		where: (/** @type {Rec} */ m) => m.receiptId === receiptId
	})) {
		if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
	}
	await store.receipts.put({ ...receipt, payrollDoc: null });
	await syncLinks(store);
	await recordEvent(store.events, 'decision', { action: 'payroll-doc-undo', receiptId });
}
