// The ECB's rate of a payment's day, for an invoice in another currency
// (instalments.js `paidIn`). A USD invoice paid in instalments from euros –
// in Monero valued at the day's euro rate, or from a bank that names no
// original amount – could not be reckoned: euros are never taken for
// dollars. With the rate of each payment's day kept on the booking, each
// instalment counts in the invoice's currency, and the invoice says what is
// open in it.
//
// Kept as `fx: { USD: { rate, source, at } }` on the transaction: EUR per
// unit, from the bridge's /rates (bridge/src/rates.js, the ECB reference rate
// of the day or the last before it). An import does not own the field
// (bank/import.js FIELDS), so a sync keeps it. For what is linked: the active
// links of receipts in a currency other than the payment's, where the bank
// gave no original amount and no rate is kept yet. And for what could be
// linked (#474): a euro booking in the date window of an open receipt in
// another currency gets the rate only when, at it, the amount comes near what
// is open – so matching can count it (score.js `amount-converted`), and the
// other bookings of those days stay as they are.

import { isCrypto } from '../assets/registry.js';
import { FX_MATCH_TOLERANCE, receiptFacts } from './score.js';
import { dayNumber } from './normalize.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {{ tx: Rec, currency: string, day: string, near?: number[] }} Gap */

/** A link that counts (engine.js `isActive`, kept here to load no engine). @param {Rec} m */
const isActive = (m) => !m.deleted && (m.state === 'auto' || m.state === 'confirmed');

/** A receipt's currency, upper case. @param {Rec} r */
const currencyOf = (r) => String(r?.currency ?? r?.extraction?.currency ?? 'EUR').toUpperCase();

/**
 * The linked payments that need a rate: `{ tx, currency, day }`, each payment
 * and currency once.
 *
 * @param {{ receipts: Rec[], matches: Rec[], transactions: Rec[] }} books
 * @returns {{ tx: Rec, currency: string, day: string }[]}
 */
export function fxGaps({ receipts, matches, transactions }) {
	const receiptById = new Map(receipts.filter((r) => !r.deleted).map((r) => [r.id, r]));
	const txById = new Map(transactions.filter((t) => !t.deleted).map((t) => [t.id, t]));
	/** @type {Map<string, { tx: Rec, currency: string, day: string }>} */
	const out = new Map();
	for (const m of matches) {
		if (!isActive(m)) continue;
		const receipt = receiptById.get(m.receiptId);
		const tx = txById.get(m.transactionId);
		if (!receipt || !tx) continue;
		const currency = currencyOf(receipt);
		if (!/^[A-Z]{3}$/.test(currency) || currency === 'EUR') continue;
		if (String(tx.currency ?? 'EUR').toUpperCase() !== 'EUR') continue;
		if (String(tx.original?.currency ?? '').toUpperCase() === currency) continue;
		if (tx.fx?.[currency]?.rate) continue;
		const day = String(tx.bookedOn ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		out.set(`${tx.id}|${currency}`, { tx, currency, day });
	}
	return [...out.values()];
}

/**
 * The euro bookings that could pay an open receipt in another currency:
 * `{ tx, currency, day, near }`, with `near` the amounts still open (cents in
 * that currency) the booking's amount is to be held against. Open receipts
 * (read, no active link) in an ECB currency, not crypto; bookings in euros,
 * in the receipt's date window, without a link, an original amount in that
 * currency or a rate for it.
 *
 * @param {{ receipts: Rec[], matches: Rec[], transactions: Rec[] }} books
 * @returns {Gap[]}
 */
export function fxCandidateGaps({ receipts, matches, transactions }) {
	const linkedR = new Set();
	const linkedT = new Set();
	for (const m of matches) {
		if (!isActive(m)) continue;
		linkedR.add(m.receiptId);
		linkedT.add(m.transactionId);
	}
	const open = receipts
		.filter((r) => !r.deleted && r.extraction && !linkedR.has(r.id))
		.map((r) => ({ currency: currencyOf(r), facts: receiptFacts(r) }))
		.filter(
			({ currency, facts }) =>
				facts &&
				facts.from !== null &&
				facts.to !== null &&
				/^[A-Z]{3}$/.test(currency) &&
				currency !== 'EUR' &&
				!isCrypto(currency)
		);
	/** @type {Map<string, Gap & { near: number[] }>} */
	const out = new Map();
	if (!open.length) return [];
	for (const tx of transactions) {
		if (tx.deleted || linkedT.has(tx.id)) continue;
		if (String(tx.currency ?? 'EUR').toUpperCase() !== 'EUR') continue;
		const day = String(tx.bookedOn ?? '');
		const n = dayNumber(day);
		if (n === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		for (const { currency, facts } of open) {
			const f = /** @type {import('./score.js').ReceiptFacts} */ (facts);
			if (n < /** @type {number} */ (f.from) || n > /** @type {number} */ (f.to)) continue;
			if (String(tx.original?.currency ?? '').toUpperCase() === currency) continue;
			if (tx.fx?.[currency]?.rate) continue;
			const key = `${tx.id}|${currency}`;
			const gap = out.get(key) ?? { tx, currency, day, near: [] };
			gap.near.push(f.openCents);
			out.set(key, gap);
		}
	}
	return [...out.values()];
}

/** Whether a euro amount at a rate comes near one of the open amounts. @param {Rec} tx @param {number} rate @param {number[]} near */
const comesNear = (tx, rate, near) => {
	const converted = Math.abs(Number(tx.amountCents ?? 0)) / rate;
	return near.some((open) => open > 0 && Math.abs(converted - open) <= open * FX_MATCH_TOLERANCE);
};

/**
 * Rates the bridge gave, by `currency|day`: a past day's reference rate does
 * not change, and a candidate that did not come near is asked again on every
 * run otherwise.
 * @type {Map<string, any>}
 */
const known = new Map();

/**
 * Ask the bridge for each gap's rate and keep it on the booking – a
 * candidate's (`near`) only when the amount comes near at it. One request
 * per currency and day; a rate the bridge does not have leaves the gap open
 * (asked again next time). At most `limit` requests a run.
 *
 * @param {object} params
 * @param {{ rate: (asset: string, date: string) => Promise<any> }} params.client
 * @param {import('../store/repository.js').Collection} params.transactions
 * @param {Gap[]} params.gaps
 * @param {number} [params.limit]
 * @returns {Promise<number>} bookings that got a rate
 */
export async function fillFx({ client, transactions, gaps, limit = 60 }) {
	/** @type {Map<string, any>} */
	const asked = new Map();
	let requests = 0;
	let filled = 0;
	for (const { tx, currency, day, near } of gaps) {
		const key = `${currency}|${day}`;
		if (!asked.has(key)) {
			if (known.has(key)) asked.set(key, known.get(key));
			else {
				if (requests >= limit) break;
				requests += 1;
				const answer = await client.rate(currency, day).catch(() => null);
				if (answer && typeof answer.rate === 'string' && Number(answer.rate) > 0) {
					known.set(key, answer);
				}
				asked.set(key, answer);
			}
		}
		const rate = asked.get(key);
		if (!rate || typeof rate.rate !== 'string' || !(Number(rate.rate) > 0)) continue;
		if (near && !comesNear(tx, Number(rate.rate), near)) continue;
		const [current] = await transactions.list({ where: (/** @type {Rec} */ r) => r.id === tx.id });
		if (!current || current.fx?.[currency]?.rate) continue;
		await transactions.put({
			...current,
			fx: {
				...(current.fx ?? {}),
				[currency]: {
					rate: rate.rate,
					source: String(rate.source ?? 'ecb'),
					at: String(rate.at ?? `${day}T00:00:00Z`)
				}
			}
		});
		filled += 1;
	}
	return filled;
}
