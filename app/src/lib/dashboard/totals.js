// Income and expenses of a year (issue #194): what really came in from outside
// and what went out, bank and crypto apart. Pure.
//
// Moving money between one's own places is neither: own transfers, swaps and
// trades (a crypto sale to euros on an exchange is a swap), token burns and
// migrations, staking deposits, dust, and what a rule says to ignore. A refund
// is netted against its charge: it lowers the expenses (or the income) it
// undoes, rather than counting as the opposite. Private payments from the
// business account and loans are no business income or expenses; they get a
// line of their own. Fees are expenses, staking rewards income, as booked.
// Taxes paid to the tax office (VAT, corporate and trade tax, #233) are no
// operating expense either; they have a line of their own. Wages, wage tax
// and contributions are expenses.
// A crypto booking without a rate has no euro amount: counted, not summed.

import { privateKind } from '../matching/private-kind.js';
import { isWalletSource } from '../wallets/chains.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'bank' | 'crypto'} Place */
/** @typedef {'income' | 'expenses' | 'private' | 'loan' | 'tax' | 'unpriced'} Bucket */

/** Classifications that move money between one's own places, or nowhere. */
const NEITHER = new Set([
	'own-transfer',
	'crypto-swap',
	'crypto-stake',
	'crypto-dust',
	'token-burn',
	'token-migration',
	'rule-ignore'
]);

/**
 * Bank (Hibiscus, CAMT, anything else) or crypto (an exchange, a wallet).
 *
 * @param {Rec} tx
 * @returns {Place}
 */
export const placeOf = (tx) =>
	tx.source === 'kraken' || isWalletSource(String(tx.source ?? '')) ? 'crypto' : 'bank';

/**
 * Where a booking counts, or null when it is neither income nor expense.
 * `cents` is what it adds to its bucket: positive for income and expenses
 * alike, negative for a refund (it lowers the side it undoes), and signed as
 * booked for private payments and loans.
 *
 * @param {Rec} tx
 * @param {Rec | undefined} classification
 * @returns {{ place: Place, bucket: Bucket, cents: number } | null}
 */
export function flowOf(tx, classification) {
	if (tx.deleted) return null;
	const place = placeOf(tx);
	const kind = classification?.kind;
	if (NEITHER.has(kind) || tx.movement === 'trade') return null;
	const amount = Number(tx.amountCents ?? 0);
	if (privateKind(tx) || kind === 'rule-private')
		return { place, bucket: 'private', cents: amount };
	if (kind === 'loan') return { place, bucket: 'loan', cents: amount };
	if (kind === 'tax-payment') return { place, bucket: 'tax', cents: amount };
	if (tx.rateMissing) return { place, bucket: 'unpriced', cents: 0 };
	if (amount === 0) return null;
	if (kind === 'refund' && classification?.role === 'refund') {
		// Money back lowers the expenses; a refund we paid lowers the income.
		return { place, bucket: amount > 0 ? 'expenses' : 'income', cents: -Math.abs(amount) };
	}
	return { place, bucket: amount > 0 ? 'income' : 'expenses', cents: Math.abs(amount) };
}

/**
 * The key of a booking's flow, for a link to Zahlungen and its filter:
 * `bank-income`, `crypto-expenses`, `private`, `loan`, `unpriced`.
 *
 * @param {Rec} tx
 * @param {Rec | undefined} classification
 * @returns {string | null}
 */
export function flowKey(tx, classification) {
	const flow = flowOf(tx, classification);
	if (!flow) return null;
	return flow.bucket === 'income' || flow.bucket === 'expenses'
		? `${flow.place}-${flow.bucket}`
		: flow.bucket;
}

export const FLOW_KEYS = /** @type {const} */ ([
	'bank-income',
	'bank-expenses',
	'crypto-income',
	'crypto-expenses',
	'private',
	'loan',
	'tax',
	'unpriced'
]);

/**
 * @typedef {object} Totals all in cents; expenses as positive numbers
 * @property {{ income: number, expenses: number }} bank
 * @property {{ income: number, expenses: number }} crypto
 * @property {{ income: number, expenses: number }} total
 * @property {number} balance income − expenses
 * @property {{ paid: number, repaid: number, count: number }} private paid privately from the business, and paid back
 * @property {{ received: number, paid: number, count: number }} loans
 * @property {{ paid: number, refunded: number, count: number }} taxes paid to and refunded by the tax office
 * @property {number} unpriced crypto bookings without a rate, not summed
 * @property {number} counted bookings in the four sums
 */

/**
 * @param {Rec[]} transactions the bookings of the year shown
 * @param {Record<string, Rec>} classifications by booking id
 * @returns {Totals}
 */
export function yearTotals(transactions, classifications) {
	/** @type {Totals} */
	const t = {
		bank: { income: 0, expenses: 0 },
		crypto: { income: 0, expenses: 0 },
		total: { income: 0, expenses: 0 },
		balance: 0,
		private: { paid: 0, repaid: 0, count: 0 },
		loans: { received: 0, paid: 0, count: 0 },
		taxes: { paid: 0, refunded: 0, count: 0 },
		unpriced: 0,
		counted: 0
	};
	for (const tx of transactions) {
		const flow = flowOf(tx, classifications[String(tx.id)]);
		if (!flow) continue;
		if (flow.bucket === 'unpriced') t.unpriced++;
		else if (flow.bucket === 'private') {
			t.private.count++;
			if (flow.cents < 0) t.private.paid += -flow.cents;
			else t.private.repaid += flow.cents;
		} else if (flow.bucket === 'tax') {
			t.taxes.count++;
			if (flow.cents < 0) t.taxes.paid += -flow.cents;
			else t.taxes.refunded += flow.cents;
		} else if (flow.bucket === 'loan') {
			t.loans.count++;
			if (flow.cents > 0) t.loans.received += flow.cents;
			else t.loans.paid += -flow.cents;
		} else {
			t[flow.place][flow.bucket] += flow.cents;
			t.counted++;
		}
	}
	t.total.income = t.bank.income + t.crypto.income;
	t.total.expenses = t.bank.expenses + t.crypto.expenses;
	t.balance = t.total.income - t.total.expenses;
	return t;
}
