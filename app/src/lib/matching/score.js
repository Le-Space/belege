// Scoring receipts against bank transactions, and deciding which pairs are
// sure. Pure: no store, no clock, no network. Ported from
// spikes/matching/match.mjs (phase 0) and hardened:
//
//   amount            40  same absolute amount in cents, same currency
//   invoice number    50  the receipt's number, separators stripped, in the
//                         purpose or the end-to-end id
//   customer number   20  the same for the customer number
//   vendor IBAN       15  full IBAN, or the last four digits, = counterparty IBAN
//   vendor name       20  token overlap with the counterparty (10 when the
//                         name only shows in the purpose, as on card payments)
//   learned vendor    40  a person linked this counterparty to this vendor
//                         before (partners.js): stronger than a name overlap,
//                         so amount + learned vendor + date is sure – still
//                         only 30 ahead of every rival, like every pair
//   date window       10  invoice date −5 … due/debit date (or invoice date) +10
//   far-off date     −30  more than 60 days outside that window
//   wrong direction  −40  money came in for an expense, or went out for an
//                         income (our own invoice, a credit note)
//
// A pair is "sicher" at 90 or more and 30 ahead of every rival, on both
// sides: the receipt's second-best transaction and the transaction's
// second-best receipt. Sage bills 7,47 € every month; only the invoice number
// tells the two debits apart, and without it neither may be taken.

import { compactIban, dayNumber, normalizeRef, sameVendor } from './normalize.js';
import { counterpartyKey } from './partners.js';
import { isOwnName } from './classify.js';

export const POINTS = Object.freeze({
	amount: 40,
	invoiceNumber: 50,
	customerNumber: 20,
	iban: 15,
	vendor: 20,
	vendorInPurpose: 10,
	vendorLearned: 40,
	date: 10,
	farDate: -30,
	wrongDirection: -40
});

/** Best score for a pair to be taken without asking. */
export const SURE = 90;
/** How far the best must lead every rival. */
export const LEAD = 30;
/** Below this a receipt has no candidate worth a question. */
export const CANDIDATE = 50;
/** A reference shorter than this matches too much by chance. */
export const MIN_REF = 5;
/** How many candidates a question offers. */
export const MAX_CANDIDATES = 3;
/** A candidate below this is noise, not worth offering. */
export const SHOWN = 40;

/**
 * @typedef {object} ReceiptFacts
 * @property {string} id
 * @property {number} absCents
 * @property {string} currency
 * @property {string} invoiceNumber normalised
 * @property {string} customerNumber normalised
 * @property {string} vendorIban compact, or ''
 * @property {string} ibanLast4
 * @property {string} vendor
 * @property {number | null} from first day of the date window
 * @property {number | null} to last day of the date window
 * @property {string} documentType
 * @property {'expense' | 'income'} direction what the bank should show
 * @property {boolean} reminder a payment reminder: never takes a booking itself
 * @property {boolean} ours the invoice is our own (vendor = our company)
 */

/**
 * @typedef {object} TxFacts
 * @property {string} id
 * @property {number} amountCents signed
 * @property {string} currency
 * @property {string} text purpose + end-to-end id, normalised
 * @property {string} purpose as booked
 * @property {string} counterparty
 * @property {string} counterpartyIban compact, or ''
 * @property {number | null} day
 * @property {string[]} learnedVendors vendors a person linked this counterparty to (partners.js)
 */

/** @typedef {{ score: number, reasons: string[] }} Score */

/**
 * What matching needs of a receipt record.
 *
 * @param {Record<string, any>} r a receipts record (after extraction)
 * @param {{ companyNames?: string[] }} [ctx]
 * @returns {ReceiptFacts | null} null when it has no amount to match
 */
export function receiptFacts(r, ctx = {}) {
	const x = r.extraction ?? {};
	const cents =
		typeof r.amountCents === 'number'
			? r.amountCents
			: typeof x.gross === 'number' && Number.isFinite(x.gross)
				? Math.round(x.gross * 100)
				: null;
	if (cents === null || cents === 0) return null;
	const invoiceDate = r.documentDate ?? x.invoice_date ?? null;
	const due = x.due_or_debit_date ?? null;
	const received = typeof r.receivedAt === 'string' ? r.receivedAt.slice(0, 10) : null;
	const start = dayNumber(invoiceDate) ?? dayNumber(received);
	const end = dayNumber(due) ?? start;
	const vendor = String(r.vendor ?? x.vendor ?? '');
	const ours = (ctx.companyNames ?? []).some((name) => isOwnName(vendor, name));
	const creditNote = cents < 0 || x.document_type === 'credit_note';
	const documentType = String(x.document_type ?? 'other');
	return {
		id: r.id,
		absCents: Math.abs(cents),
		currency: String(r.currency ?? x.currency ?? 'EUR'),
		invoiceNumber: normalizeRef(r.invoiceNumber ?? x.invoice_number),
		customerNumber: normalizeRef(x.customer_number),
		vendorIban: compactIban(x.vendor_iban ?? x.iban),
		ibanLast4: String(x.iban_last4 ?? '')
			.replace(/\s/g, '')
			.toUpperCase()
			.slice(-4),
		vendor,
		from: start === null ? null : start - 5,
		// Our own invoices without a due date: customers take their time.
		to: end === null ? null : Math.max(end, start ?? end) + (ours && !due ? 30 : 10),
		documentType,
		// Our own invoice is paid to us; a vendor's credit note is refunded to us.
		direction: ours !== creditNote ? 'income' : 'expense',
		reminder: documentType === 'payment_reminder',
		ours
	};
}

/**
 * What matching needs of a transaction record.
 *
 * @param {Record<string, any>} t a transactions record
 * @param {{ learnedVendors?: Map<string, string[]> }} [ctx]
 * @returns {TxFacts}
 */
export function txFacts(t, ctx = {}) {
	const purpose = String(t.purpose ?? '');
	const tagged =
		/(?:^|\s)IBAN\s*[:+]\s*(.*?)(?=\s+(?:BIC|EREF|KREF|MREF|CRED|DEBT|SVWZ|ABWA|ABWE|PURP)\s*[:+]|$)/i.exec(
			purpose
		)?.[1];
	return {
		id: t.id,
		amountCents: Number(t.amountCents ?? 0),
		currency: String(t.currency ?? 'EUR'),
		text: normalizeRef(`${purpose} ${t.endToEndId ?? ''}`),
		purpose,
		counterparty: String(t.counterparty ?? ''),
		counterpartyIban: compactIban(t.counterpartyIban) || compactIban(tagged),
		day: dayNumber(t.bookedOn),
		learnedVendors: ctx.learnedVendors?.get(counterpartyKey(t.counterparty)) ?? []
	};
}

/**
 * One receipt against one transaction.
 *
 * @param {ReceiptFacts} r
 * @param {TxFacts} t
 * @returns {Score}
 */
export function scorePair(r, t) {
	/** @type {string[]} */
	const reasons = [];
	let score = 0;
	/** @param {keyof typeof POINTS} key @param {string} reason */
	const add = (key, reason) => {
		score += POINTS[key];
		reasons.push(reason);
	};

	if (Math.abs(t.amountCents) === r.absCents && t.currency === r.currency) add('amount', 'amount');
	if (r.invoiceNumber.length >= MIN_REF && t.text.includes(r.invoiceNumber)) {
		add('invoiceNumber', 'invoice-number');
	}
	if (
		r.customerNumber.length >= MIN_REF &&
		r.customerNumber !== r.invoiceNumber &&
		t.text.includes(r.customerNumber)
	) {
		add('customerNumber', 'customer-number');
	}
	if (t.counterpartyIban) {
		const full = r.vendorIban && r.vendorIban === t.counterpartyIban;
		const last4 =
			!r.vendorIban && r.ibanLast4.length === 4 && t.counterpartyIban.endsWith(r.ibanLast4);
		if (full || last4) add('iban', 'iban');
	}
	// Our own invoice names us as vendor, and the payer is the customer: no name to compare.
	if (!r.ours && r.vendor) {
		if (sameVendor(r.vendor, t.counterparty)) add('vendor', 'vendor');
		// A person linked this counterparty to this vendor before.
		else if ((t.learnedVendors ?? []).some((v) => sameVendor(r.vendor, v)))
			add('vendorLearned', 'vendor-learned');
		else if (sameVendor(r.vendor, t.purpose)) add('vendorInPurpose', 'vendor-in-purpose');
	}
	if (r.from !== null && r.to !== null && t.day !== null) {
		if (t.day >= r.from && t.day <= r.to) add('date', 'date');
		else if (Math.min(Math.abs(t.day - r.from), Math.abs(t.day - r.to)) > 60) {
			add('farDate', 'far-date');
		}
	}
	if (
		(r.direction === 'expense' && t.amountCents > 0) ||
		(r.direction === 'income' && t.amountCents < 0)
	) {
		add('wrongDirection', 'wrong-direction');
	}
	return { score, reasons };
}

/**
 * @typedef {{ transactionId: string, score: number, reasons: string[] }} TxCandidate
 * @typedef {{ receiptId: string, score: number, reasons: string[] }} ReceiptCandidate
 */

/**
 * A receipt's transactions, best first, positive scores only.
 *
 * @param {ReceiptFacts} r
 * @param {TxFacts[]} txs
 * @returns {TxCandidate[]}
 */
export function rankTransactions(r, txs) {
	return txs
		.map((t) => ({ transactionId: t.id, ...scorePair(r, t) }))
		.filter((c) => c.score > 0)
		.sort((a, b) => b.score - a.score || (a.transactionId < b.transactionId ? -1 : 1));
}

/**
 * Whether the best of a ranking is sure on its own (no rival considered on
 * the other side): ≥ SURE and LEAD ahead of the runner-up.
 *
 * @param {{ score: number }[]} ranked best first
 * @returns {'sicher' | 'unsicher' | 'keiner'}
 */
export function verdict(ranked) {
	const [best, second] = ranked;
	if (!best || best.score < CANDIDATE) return 'keiner';
	if (best.score >= SURE && best.score - (second?.score ?? 0) >= LEAD) return 'sicher';
	return 'unsicher';
}

/**
 * @typedef {object} Assignment
 * @property {{ receiptId: string, transactionId: string, score: number, reasons: string[] }[]} sure
 * @property {{ receiptId: string, candidates: TxCandidate[] }[]} unsure receipts with a candidate but no sure pair
 * @property {string[]} none receipts without any candidate
 * @property {{ transactionId: string, candidates: ReceiptCandidate[] }[]} unmatched transactions nothing was sure about
 */

/**
 * Every open receipt against every open transaction, then the sure pairs,
 * best first, each taking its receipt and its transaction out of the running.
 *
 * Payment reminders are scored for their questions but neither take a
 * booking nor count as a rival: the invoice they remind of should.
 *
 * @param {object} params
 * @param {ReceiptFacts[]} params.receipts open ones: no active match
 * @param {TxFacts[]} params.transactions open ones: no match, no "no receipt needed"
 * @param {(receiptId: string, transactionId: string) => boolean} [params.excluded] pairs a person rejected
 * @returns {Assignment}
 */
export function assign({ receipts, transactions, excluded = () => false }) {
	/** @type {{ r: ReceiptFacts, t: TxFacts, score: number, reasons: string[] }[]} */
	const pairs = [];
	for (const r of receipts) {
		for (const t of transactions) {
			if (excluded(r.id, t.id)) continue;
			const s = scorePair(r, t);
			if (s.score > 0) pairs.push({ r, t, ...s });
		}
	}
	const takenR = new Set();
	const takenT = new Set();
	const competing = pairs.filter((p) => !p.r.reminder);

	/** The best rival score of a pair, from either side, among what is still open. */
	const rival = (/** @type {(typeof pairs)[number]} */ p) => {
		let best = 0;
		for (const q of competing) {
			if (q === p || takenR.has(q.r.id) || takenT.has(q.t.id)) continue;
			if ((q.r.id === p.r.id) !== (q.t.id === p.t.id) && q.score > best) best = q.score;
		}
		return best;
	};

	/** @type {Assignment['sure']} */
	const sure = [];
	const ordered = competing
		.filter((p) => p.score >= SURE)
		.sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1));
	for (const p of ordered) {
		if (takenR.has(p.r.id) || takenT.has(p.t.id)) continue;
		if (p.score - rival(p) < LEAD) continue;
		takenR.add(p.r.id);
		takenT.add(p.t.id);
		sure.push({ receiptId: p.r.id, transactionId: p.t.id, score: p.score, reasons: p.reasons });
	}

	/** @type {Assignment['unsure']} */
	const unsure = [];
	/** @type {string[]} */
	const none = [];
	for (const r of receipts) {
		if (takenR.has(r.id)) continue;
		const ranked = pairs
			.filter((p) => p.r.id === r.id && !takenT.has(p.t.id))
			.sort((a, b) => b.score - a.score || (a.t.id < b.t.id ? -1 : 1))
			.map((p) => ({ transactionId: p.t.id, score: p.score, reasons: p.reasons }))
			.filter((c) => c.score >= SHOWN);
		if (ranked[0] && ranked[0].score >= CANDIDATE) {
			unsure.push({ receiptId: r.id, candidates: ranked.slice(0, MAX_CANDIDATES) });
		} else none.push(r.id);
	}

	/** @type {Assignment['unmatched']} */
	const unmatched = [];
	for (const t of transactions) {
		if (takenT.has(t.id)) continue;
		const candidates = pairs
			.filter((p) => p.t.id === t.id && !takenR.has(p.r.id) && p.score >= CANDIDATE)
			.sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1))
			.slice(0, MAX_CANDIDATES)
			.map((p) => ({ receiptId: p.r.id, score: p.score, reasons: p.reasons }));
		unmatched.push({ transactionId: t.id, candidates });
	}
	return { sure, unsure, none, unmatched };
}
