// Enable Banking's transactions → what the app imports (issue #224, step 3).
//
// Their schema follows the Berlin Group's: an amount without sign plus
// `credit_debit_indicator` (CRDT in, DBIT out), the other side as `creditor`
// or `debtor` with its account, the purpose as lines in
// `remittance_information`. Only booked entries count (`status` BOOK, or none
// given); pending ones change or vanish and are counted, not imported.
//
// The app computes the dedup fingerprint itself, from its own account key;
// `sourceId` is the bank's entry reference, else Enable Banking's id.

import { createHash } from 'node:crypto';

import { compactIban, parseAmountCents, parseDate } from './normalize.js';

/**
 * The same key the app keeps for an IBAN (app/src/lib/bank/fingerprint.js,
 * `ibanKey`): SHA-256 over a fixed prefix and the compact IBAN. The app can
 * tell two sources of one account apart from it without the IBAN itself.
 *
 * @param {string} iban
 */
export function ibanKey(iban) {
	const compact = String(iban ?? '')
		.replace(/\s/g, '')
		.toUpperCase();
	return `iban-sha256:${createHash('sha256').update(`belege/iban/v1:${compact}`).digest('hex')}`;
}

/**
 * @typedef {object} EnableBankingTransaction the app's IncomingTransaction
 * @property {string | null} sourceId
 * @property {string | null} date
 * @property {string | null} valueDate
 * @property {number} amountCents NaN when the amount is unreadable
 * @property {string} currency
 * @property {string} counterpartyName
 * @property {string} counterpartyIban
 * @property {string} purpose
 * @property {string} endToEndId
 * @property {string} bookingType
 */

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;
/** @param {unknown} s @param {number} max */
const text = (s, max) =>
	String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);

/**
 * @param {any} t one entry of GET /accounts/{uid}/transactions
 * @param {{ currency: string }} account
 * @returns {EnableBankingTransaction | null} null for a pending entry
 */
export function normalizeEnableBankingTransaction(t, account) {
	if (t?.status && t.status !== 'BOOK') return null;
	const date = parseDate(t?.booking_date ?? t?.value_date);
	let amount = NaN;
	try {
		amount = parseAmountCents(String(t?.transaction_amount?.amount ?? '').replace(/^[-+]/, ''));
	} catch {
		// Left NaN: the app skips an entry without an amount and counts it.
	}
	const out = t?.credit_debit_indicator === 'DBIT';
	const other = out ? t?.creditor : t?.debtor;
	const otherAccount = compactIban((out ? t?.creditor_account : t?.debtor_account)?.iban);
	const reference = text(t?.entry_reference, 128) || text(t?.transaction_id, 128);
	return {
		sourceId: reference || null,
		date,
		valueDate: parseDate(t?.value_date) ?? date,
		amountCents: Number.isSafeInteger(amount) ? (out ? -amount : amount) : NaN,
		currency: text(t?.transaction_amount?.currency, 3) || account.currency || 'EUR',
		counterpartyName: text(other?.name, 140),
		counterpartyIban: IBAN.test(otherAccount) ? otherAccount : '',
		purpose: text(
			Array.isArray(t?.remittance_information) ? t.remittance_information.join(' ') : '',
			1000
		),
		endToEndId: '',
		bookingType: text(t?.bank_transaction_code?.description, 100)
	};
}
