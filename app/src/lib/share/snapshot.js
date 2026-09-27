// What a read share for an assistant holds (issue #124): the chosen
// collections of one year, as plain JSON, redacted by default. Pure; built in
// the browser, the only place the sealed books can be read.
//
// Redacted means:
//   - IBANs down to their last four characters;
//   - e-mail addresses and phone numbers removed;
//   - long numbers (customer, contract, card) masked but their last three;
//   - wallet addresses and transaction hashes shortened;
//   - file names and mail senders left out.
// Kept: vendors and counterparties as the bank names them, amounts, dates,
// purposes, and what is linked to what – that is what an analysis needs.
// Between the owner's own devices nothing is redacted; this is for a third
// party only.

import { payeeName } from '../bank/payee.js';
import { accountLabel } from '../bank/format.js';
import { isActive } from '../matching/engine.js';
import { receiptDate, receiptVendor } from '../receipts/view.js';
import { receiptCents } from '../matching/vendor-account.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'transactions' | 'receipts' | 'questions'} Collection */

export const COLLECTIONS = /** @type {const} */ (['transactions', 'receipts', 'questions']);

const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+|\b00)\d[\d\s/()-]{6,}\d|\b0\d{2,5}[\s/-]?\d{3,}[\s-]?\d{0,6}\b/g;
const EVM = /\b0x[0-9a-fA-F]{8,}\b/g;
const BECH32 = /\b[a-z]{1,20}1[02-9ac-hj-np-z]{20,}\b/g;
const HEX = /\b[0-9A-Fa-f]{32,}\b/g;
const LONG_NUMBER = /\b[A-Z]{0,4}\d[\dA-Z-]{7,}\b/g;

/**
 * A text with the identifying parts taken out.
 *
 * @param {unknown} text
 */
export function redactText(text) {
	return String(text ?? '')
		.replace(IBAN, (m) => `[IBAN …${m.replace(/\s/g, '').slice(-4)}]`)
		.replace(EMAIL, '[E-Mail]')
		.replace(EVM, (m) => `${m.slice(0, 6)}…${m.slice(-4)}`)
		.replace(BECH32, (m) => `${m.slice(0, 6)}…${m.slice(-4)}`)
		.replace(HEX, (m) => `${m.slice(0, 6)}…${m.slice(-4)}`)
		.replace(PHONE, '[Telefon]')
		.replace(LONG_NUMBER, (m) => `…${m.slice(-3)}`);
}

/**
 * @param {object} p
 * @param {{ transactions: Rec[], receipts: Rec[], questions: Rec[], matches: Rec[], accounts: Rec[], classifications: Record<string, Rec> }} p.books
 * @param {Collection[]} p.collections
 * @param {number} p.year
 * @param {boolean} p.redacted
 * @param {string} p.now ISO
 */
export function buildSnapshot({ books, collections, year, redacted, now }) {
	const y = String(year);
	const r = (/** @type {unknown} */ v) => (redacted ? redactText(v) : String(v ?? ''));
	const accountById = new Map(books.accounts.map((a) => [String(a.id), a]));
	const account = (/** @type {unknown} */ id) => {
		const a = accountById.get(String(id));
		return a ? r(accountLabel(a)) : '';
	};
	/** @type {Map<string, string>} receipt id → transaction id */
	const linkOf = new Map();
	for (const m of books.matches)
		if (isActive(m)) linkOf.set(String(m.receiptId), String(m.transactionId));

	/** @type {Record<string, unknown>} */
	const out = {
		about:
			'Belege: a snapshot of the books for an assistant. Amounts in euro cents; negative is money out.',
		year,
		redacted,
		createdAt: now
	};
	if (collections.includes('transactions')) {
		out.transactions = books.transactions
			.filter((t) => !t.deleted && String(t.bookedOn ?? '').startsWith(y))
			.sort((a, b) => String(a.bookedOn).localeCompare(String(b.bookedOn)))
			.map((t) => ({
				id: String(t.id),
				day: String(t.bookedOn),
				amountCents: Number(t.amountCents ?? 0),
				currency: t.currency ?? 'EUR',
				account: account(t.accountId),
				payee: r(payeeName(t).name),
				purpose: r(t.purpose),
				type: String(t.bookingType ?? ''),
				...(t.asset ? { asset: t.asset, quantity: t.quantity } : {}),
				receiptId: t.receiptId ?? null,
				classification: books.classifications[t.id]?.kind ?? (t.noReceipt ? 'no-receipt' : null),
				...(redacted ? {} : { counterpartyIban: t.counterpartyIban ?? '' })
			}));
	}
	if (collections.includes('receipts')) {
		out.receipts = books.receipts
			.filter((x) => !x.deleted && String(receiptDate(/** @type {any} */ (x)) ?? '').startsWith(y))
			.map((x) => ({
				id: String(x.id),
				day: receiptDate(/** @type {any} */ (x)),
				vendor: r(receiptVendor(/** @type {any} */ (x))),
				grossCents: receiptCents(x),
				currency: x.extraction?.currency ?? 'EUR',
				number: r(x.extraction?.invoice_number ?? ''),
				summary: r(x.extraction?.summary ?? ''),
				status: x.status ?? 'neu',
				source: x.source ?? '',
				outgoing: Boolean(x.outgoing),
				transactionId: linkOf.get(String(x.id)) ?? null,
				...(redacted ? {} : { fileName: x.fileName ?? '', from: x.from ?? '' })
			}));
	}
	if (collections.includes('questions')) {
		out.questions = books.questions
			.filter((q) => !q.deleted && q.state === 'open')
			.map((q) => ({
				id: String(q.id),
				kind: q.kind,
				transactionId: q.transactionId ?? null,
				receiptId: q.receiptId ?? null,
				candidates: (q.candidates ?? []).map((/** @type {Rec} */ c) => ({
					transactionId: c.transactionId ?? null,
					receiptId: c.receiptId ?? null,
					score: c.score ?? null
				}))
			}));
	}
	return out;
}

/**
 * The scope as shown in lists: "Zahlungen, Belege 2026 · geschwärzt".
 *
 * @param {Collection[]} collections
 * @param {number} year
 * @param {boolean} redacted
 * @param {(key: string) => string} label
 */
export const scopeText = (collections, year, redacted, label) =>
	`${collections.map(label).join(', ')} ${year}${redacted ? ` · ${label('redacted')}` : ''}`;
