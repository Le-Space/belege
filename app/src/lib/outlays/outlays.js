// Private outlays (issue #293): what the managing shareholder paid privately
// for the business – cash abroad, a private card – has no account Belege can
// read. It gets one: "Auslagen Geschäftsführung", an account without an
// import whose bookings come from receipts. "Privat ausgelegt …" on a receipt
// books its amount there and links the receipt to that booking, so it is
// covered and no longer waits for a bank payment.
//
// The booking is an outflow of the account, as a bank payment would be: in
// the DATEV export it goes against the account's ledger account – the
// shareholder clearing account of a UG/GmbH, 1890 (Privateinlage) for a sole
// proprietor or partnership (booking/settings.js privateAccounts) – with the
// expense account confirmed like any booking's. Paying it back is a later
// step of #293.
//
// A receipt in another currency keeps its amount as `original` and is booked
// in euros at a rate: the ECB's of the day where the bridge has one, else one
// entered by hand from a document (the card statement, an exchange receipt) –
// the ECB publishes no ruble rate since 2022-03-01. The rate's source stays
// on the booking (`outlay.rateSource`).

/* eslint-disable belege/no-german -- stored in the books, see the follow-up on #192 */

import { importTransactions, upsertAccount } from '../bank/import.js';
import { privateAccounts } from '../booking/settings.js';
import { confirmMatch } from '../matching/actions.js';
import { receiptDate, receiptVendor } from '../receipts/view.js';

/** @typedef {Record<string, any>} Rec */

export const OUTLAY_SOURCE = 'outlay';
/** The one person who lays out money for now (#293, "to decide"). */
export const OWNER = 'owner';
export const HOW = /** @type {const} */ (['cash', 'card', 'other']);

/** How a payment was made, as the books say it. */
const HOW_LABEL = /** @type {Record<string, string>} */ ({
	cash: 'bar',
	card: 'private Karte',
	other: 'anders'
});

/** @param {Rec} tx */
export const isOutlay = (tx) => tx?.source === OUTLAY_SOURCE;

/**
 * The outlay account, made once; its ledger account from the settings where
 * the legal form names one and it has none yet.
 *
 * @param {{ accounts: import('../store/repository.js').Collection }} store
 * @param {import('../booking/settings.js').DatevSettings} settings cleaned
 */
export async function outlayAccount(store, settings) {
	const record = await upsertAccount(store.accounts, {
		source: OUTLAY_SOURCE,
		sourceAccountId: OWNER,
		ibanLast4: '',
		name: 'Auslagen Geschäftsführung',
		currency: 'EUR',
		kind: 'outlay'
	});
	const ledger = privateAccounts(settings).repayment;
	if (!record.ledgerAccount && ledger)
		return store.accounts.put({ ...record, ledgerAccount: ledger });
	return record;
}

/** `16990` or `16.990,00`-free decimal `16990.00` → cents. @param {string} amount */
function cents(amount) {
	const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim());
	if (!m) throw new Error(`Kein Betrag: ${amount}`);
	return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * Euro cents of an amount in another currency at a rate (EUR per unit),
 * half away from zero.
 *
 * @param {number} amountCents in the receipt's currency
 * @param {string} rate EUR per unit, a decimal string
 */
export function euroCents(amountCents, rate) {
	const r = Number(rate);
	if (!(r > 0) || !/^\d+(\.\d+)?$/.test(String(rate).trim())) throw new Error(`Kein Kurs: ${rate}`);
	return Math.round(amountCents * r);
}

/**
 * A receipt's amount and currency for an outlay: its gross without sign, and
 * the sign the booking takes (an expense goes out, a credit note comes in).
 *
 * @param {Rec} receipt
 * @returns {{ amountCents: number, currency: string, outgoing: boolean } | null}
 */
export function outlayAmount(receipt) {
	const raw =
		typeof receipt.amountCents === 'number'
			? receipt.amountCents
			: typeof receipt.extraction?.gross === 'number'
				? Math.round(receipt.extraction.gross * 100)
				: null;
	if (raw === null || raw === 0) return null;
	const currency = String(receipt.currency ?? receipt.extraction?.currency ?? 'EUR').toUpperCase();
	return { amountCents: Math.abs(raw), currency, outgoing: raw > 0 };
}

/**
 * Book a receipt as paid privately: a booking on the outlay account, the
 * receipt linked to it.
 *
 * @param {object} p
 * @param {any} p.store accounts, transactions, matches, events
 * @param {import('../booking/settings.js').DatevSettings} p.settings cleaned
 * @param {Rec} p.receipt
 * @param {'cash' | 'card' | 'other'} p.how
 * @param {string} [p.day] YYYY-MM-DD; the receipt's day by default
 * @param {string} [p.amount] decimal in the receipt's currency; the receipt's by default
 * @param {{ rate: string, source: 'ecb' | 'manual', at?: string, note?: string } | null} [p.rate] EUR per unit; needed when not EUR
 * @param {string} [p.note]
 * @returns {Promise<{ transaction: Rec, account: Rec }>}
 */
export async function bookOutlay({
	store,
	settings,
	receipt,
	how,
	day,
	amount,
	rate = null,
	note = ''
}) {
	if (!HOW.includes(how)) throw new Error(`Unbekannte Zahlungsart: ${how}`);
	const known = outlayAmount(receipt);
	if (!known && !amount) throw new Error('Der Beleg hat keinen Betrag.');
	const currency = known?.currency ?? 'EUR';
	const amountCents = amount ? cents(amount) : /** @type {number} */ (known?.amountCents);
	const date = day ?? receiptDate(/** @type {any} */ (receipt));
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Der Beleg hat kein Datum.');
	if (currency !== 'EUR' && !rate) throw new Error(`Kein Kurs für ${currency}.`);
	const eur =
		currency === 'EUR' ? amountCents : euroCents(amountCents, /** @type {any} */ (rate).rate);
	const outgoing = known?.outgoing ?? true;
	const vendor = receiptVendor(/** @type {any} */ (receipt));

	const account = await outlayAccount(store, settings);
	const before = await store.transactions.list({
		includeDeleted: true,
		where: (/** @type {Rec} */ t) =>
			t.accountId === account.id && t.outlay?.receiptId === receipt.id
	});
	if (before.some((/** @type {Rec} */ t) => !t.deleted))
		throw new Error('Dieser Beleg ist schon als Auslage gebucht.');
	// Booked again after an undo: a booking of its own, not the deleted one revived.
	const sourceId = `${OUTLAY_SOURCE}:${receipt.id}:${before.length + 1}`;
	await importTransactions({
		transactions: store.transactions,
		events: store.events,
		account: {
			id: account.id,
			source: OUTLAY_SOURCE,
			fingerprintAccount: `${OUTLAY_SOURCE}:${OWNER}`
		},
		incoming: [
			{
				sourceId,
				date,
				valueDate: date,
				amountCents: outgoing ? -eur : eur,
				currency: 'EUR',
				counterpartyName: vendor,
				purpose: [
					`Privat ausgelegt (${HOW_LABEL[how]})`,
					receipt.invoiceNumber ? `Rechnung ${receipt.invoiceNumber}` : '',
					note.trim()
				]
					.filter(Boolean)
					.join(' · '),
				bookingType: 'Auslage',
				...(currency !== 'EUR'
					? {
							original: {
								amount: `${outgoing ? '-' : ''}${(amountCents / 100).toFixed(2)}`,
								currency,
								rate: /** @type {any} */ (rate).rate
							}
						}
					: {})
			}
		]
	});
	const [stored] = await store.transactions.list({
		includeDeleted: true,
		where: (/** @type {Rec} */ t) => t.sourceId === sourceId && t.accountId === account.id
	});
	const transaction = await store.transactions.put({
		...stored,
		outlay: {
			how,
			receiptId: receipt.id,
			...(note.trim() ? { note: note.trim().slice(0, 300) } : {}),
			...(currency !== 'EUR'
				? {
						rateSource: /** @type {any} */ (rate).source,
						rateAt: /** @type {any} */ (rate).at ?? `${date}T00:00:00Z`,
						...(rate?.note ? { rateNote: String(rate.note).slice(0, 300) } : {})
					}
				: {})
		}
	});
	await confirmMatch(store, {
		receiptId: receipt.id,
		transactionId: transaction.id,
		reasons: ['manual', 'outlay']
	});
	return { transaction, account };
}

/**
 * Undo an outlay: the booking deleted, the receipt free again (for a
 * payment that turned up after all).
 *
 * @param {any} store
 * @param {string} transactionId
 */
export async function undoOutlay(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx || !isOutlay(tx)) throw new Error('Keine Auslage.');
	for (const m of await store.matches.list()) {
		if (m.transactionId === transactionId && !m.deleted && m.state !== 'rejected') {
			await store.matches.put({ ...m, state: 'rejected' });
		}
	}
	await store.transactions.softDelete(transactionId);
}
