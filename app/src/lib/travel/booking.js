// The bookings of a travel statement (issue #213, step 6). A closed
// statement is booked on the traveller's account – "Reisekosten <name>", an
// account without an import whose ledger account is the traveller's clearing
// account: an employee's own (#380, required), the owner's from the legal
// form where none is set (booking/settings.js privateAccounts) – the
// shareholder clearing account of a UG/GmbH, 1890 Privateinlage for a sole
// proprietor or partnership. Each line an outflow of that account, against
// the expense account of its category (travel/accounts.js):
//
//   a receipt paid privately   its gross, its VAT key, linked to the receipt
//   meal allowances            the month's total, no VAT, linked to the statement
//   mileage                    the month's total, no VAT, linked to the statement
//   overnight flat rates       an employee's nights without an invoice (#380):
//                              the month's total on the accommodation account,
//                              no VAT, linked to the statement
//   a hospitality bill         split: net × 70 % plus the whole VAT on 4650
//                              with its key, the rest on 4654 without one,
//                              both linked to the bill
//
// So the clearing account owes the traveller what the statement says, and
// the payout (step 7) clears it. Receipts booked as private outlays (#293)
// and those the company paid are not booked here. Each line carries its
// account and key (`travelLine`): the suggestion, confirmed like any booking
// (booking/suggest.js). A correction reverses the lines of the statement it
// replaces, then books its own.

/* eslint-disable belege/no-german -- the Buchungstext of a German booking (#192) */

import { importTransactions, upsertAccount } from '../bank/import.js';
import { privateAccounts } from '../booking/settings.js';
import { taxKeyFor } from '../booking/tax-keys.js';
import { confirmMatch } from '../matching/actions.js';
import { lastDayOf } from './statement.js';
import { receiptCategory, travelAccount, travelSet } from './accounts.js';
import { hospitalityOf } from './view.js';

/** @typedef {Record<string, any>} Rec */

export const TRAVEL_SOURCE = 'travel';

/** @param {Rec} tx */
export const isTravelBooking = (tx) => tx?.source === TRAVEL_SOURCE;

/**
 * The traveller's account, made once. Its ledger account: the traveller's
 * clearing account where it has one (an employee always), kept in step with
 * it; else, for the owner, the one the legal form names, where the account
 * has none yet.
 *
 * @param {{ accounts: import('../store/repository.js').Collection }} store
 * @param {import('../booking/settings.js').DatevSettings} settings cleaned
 * @param {Rec} traveller
 */
export async function travellerAccount(store, settings, traveller) {
	const name = String(traveller.name ?? '').trim();
	const record = await upsertAccount(store.accounts, {
		source: TRAVEL_SOURCE,
		sourceAccountId: String(traveller.id),
		ibanLast4: '',
		name: `Reisekosten${name ? ` ${name}` : ''}`,
		currency: 'EUR',
		kind: 'travel'
	});
	const own = String(traveller.clearingAccount ?? '').trim();
	if (own) {
		return record.ledgerAccount === own
			? record
			: store.accounts.put({ ...record, ledgerAccount: own });
	}
	if (traveller.role === 'employee')
		throw new Error('An employee’s statement needs their clearing account.');
	const ledger = privateAccounts(settings).repayment;
	if (!record.ledgerAccount && ledger)
		return store.accounts.put({ ...record, ledgerAccount: ledger });
	return record;
}

/**
 * A line's BU key: from the receipt's German VAT only. A receipt in another
 * currency carries no German input VAT (statement.js leaves its VAT out).
 *
 * @param {import('./statement.js').ReceiptLine} line
 * @param {Rec} receipt
 * @param {import('../booking/settings.js').TaxKeys | undefined} keys
 * @param {string | null} [account]
 */
const germanKey = (line, receipt, keys, account = null) =>
	line.vat.length
		? taxKeyFor(receipt, { income: false, keys, account })
		: { taxKey: '', via: 'no-vat' };

/**
 * The lines a statement books: pure, from what it printed.
 *
 * @param {import('./statement.js').Statement} s
 * @param {object} p
 * @param {import('./accounts.js').TravelSet} p.set
 * @param {Map<string, Rec>} p.receipts by id
 * @param {import('../booking/settings.js').TaxKeys} [p.keys]
 * @returns {{ key: string, cents: number, account: string, taxKey: string, taxVia: string, category: string, receiptId: string | null, text: string }[]}
 *   receiptId null: linked to the statement itself
 */
export function statementLines(s, { set, receipts, keys }) {
	/** @type {ReturnType<typeof statementLines>} */
	const out = [];
	const month = s.month;
	const lines = [...s.trips.flatMap((x) => x.receipts), ...s.hospitality.map((h) => h.line)].filter(
		(l) => l.paidBy === 'private' && !l.outlay && l.grossCents
	);
	for (const l of lines) {
		const r = receipts.get(l.receiptId);
		if (!r) continue;
		if (r.hospitality) {
			// The bill as paid, without a tip: net × the deductible share, plus the whole VAT.
			const split = hospitalityOf({ ...r, hospitality: { ...r.hospitality, tipCents: 0 } });
			const deductible = split.deductibleCents + split.inputVatCents;
			const rest = /** @type {number} */ (l.grossCents) - deductible;
			const key = germanKey(l, r, keys);
			out.push({
				key: `${l.receiptId}:hospitality`,
				cents: deductible,
				account: travelAccount(set, 'hospitality').number,
				taxKey: key.taxKey,
				taxVia: key.via,
				category: 'hospitality',
				receiptId: l.receiptId,
				text: `Bewirtung ${l.vendor} (abziehbar)`
			});
			if (rest > 0)
				out.push({
					key: `${l.receiptId}:hospitalityNonDeductible`,
					cents: rest,
					account: travelAccount(set, 'hospitalityNonDeductible').number,
					taxKey: '',
					taxVia: 'none',
					category: 'hospitalityNonDeductible',
					receiptId: l.receiptId,
					text: `Bewirtung ${l.vendor} (nicht abziehbar)`
				});
			continue;
		}
		const category = receiptCategory(r, l.kind);
		const account = travelAccount(set, category).number;
		const key = germanKey(l, r, keys, account);
		out.push({
			key: l.receiptId,
			cents: /** @type {number} */ (l.grossCents),
			account,
			taxKey: key.taxKey,
			taxVia: key.via,
			category,
			receiptId: l.receiptId,
			text: l.vendor
		});
	}
	if (s.totals.allowanceCents)
		out.push({
			key: 'meals',
			cents: s.totals.allowanceCents,
			account: travelAccount(set, 'meals').number,
			taxKey: '',
			taxVia: 'none',
			category: 'meals',
			receiptId: null,
			text: `Verpflegungspauschalen ${month}`
		});
	if (s.totals.lodgingCents)
		out.push({
			key: 'lodging',
			cents: s.totals.lodgingCents,
			account: travelAccount(set, 'accommodation').number,
			taxKey: '',
			taxVia: 'none',
			category: 'accommodation',
			receiptId: null,
			text: `Übernachtungspauschalen ${month}`
		});
	if (s.totals.mileageCents)
		out.push({
			key: 'mileage',
			cents: s.totals.mileageCents,
			account: travelAccount(set, 'mileage').number,
			taxKey: '',
			taxVia: 'none',
			category: 'mileage',
			receiptId: null,
			text: `Kilometer ${month}`
		});
	return out;
}

/**
 * Book a closed statement; a correction first reverses what the statement
 * it replaces booked.
 *
 * @param {object} p
 * @param {any} p.store accounts, transactions, matches, receipts, events
 * @param {import('../booking/settings.js').DatevSettings} p.settings cleaned
 * @param {Rec} p.traveller
 * @param {Rec} p.closed the closed statement record (number, receiptId, corrects)
 * @param {import('./statement.js').Statement} p.statement what it printed
 * @returns {Promise<{ account: Rec, booked: Rec[], reversed: Rec[] }>}
 */
export async function bookStatement({ store, settings, traveller, closed, statement }) {
	const account = await travellerAccount(store, settings, traveller);
	const date = lastDayOf(statement.month);
	const receipts = new Map(
		(await store.receipts.list()).map((/** @type {Rec} */ r) => [String(r.id), r])
	);
	const lines = statementLines(statement, {
		set: travelSet(settings, traveller),
		receipts,
		keys: settings.taxKeys
	});
	const fingerprintAccount = `${TRAVEL_SOURCE}:${traveller.id}`;

	/** @param {import('../bank/import.js').IncomingTransaction[]} incoming */
	async function write(incoming) {
		await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: { id: account.id, source: TRAVEL_SOURCE, fingerprintAccount },
			incoming
		});
		const ids = new Set(incoming.map((i) => i.sourceId));
		return store.transactions.list({
			where: (/** @type {Rec} */ t) => t.accountId === account.id && ids.has(t.sourceId)
		});
	}

	/** @type {Rec[]} */
	let reversed = [];
	if (closed.corrects) {
		const before = await store.transactions.list({
			where: (/** @type {Rec} */ t) =>
				isTravelBooking(t) &&
				t.travelLine?.statementId === closed.corrects &&
				!t.travelLine?.reverses
		});
		// In the order they were booked.
		before.sort((/** @type {Rec} */ a, /** @type {Rec} */ c) => (a.id < c.id ? -1 : 1));
		const stored = await write(
			before.map((/** @type {Rec} */ t) => ({
				sourceId: `${t.sourceId}:storno:${closed.number}`,
				date,
				valueDate: date,
				amountCents: -Number(t.amountCents),
				currency: 'EUR',
				counterpartyName: t.counterpartyName,
				purpose: `Storno ${t.purpose}`,
				bookingType: 'Reisekosten'
			}))
		);
		reversed = [];
		for (const t of before) {
			const s = stored.find(
				(/** @type {Rec} */ x) => x.sourceId === `${t.sourceId}:storno:${closed.number}`
			);
			if (!s) continue;
			const put = await store.transactions.put({
				...s,
				travelLine: { ...t.travelLine, statementId: closed.id, reverses: t.id }
			});
			await confirmMatch(store, {
				receiptId: String(closed.receiptId),
				transactionId: put.id,
				reasons: ['manual', 'travel'],
				alongside: true
			});
			reversed.push(put);
		}
	}

	const name = String(traveller.name ?? '').trim();
	const stored = await write(
		lines.map((l) => ({
			sourceId: `${closed.number}:${l.key}`,
			date,
			valueDate: date,
			amountCents: -l.cents,
			currency: 'EUR',
			counterpartyName: name || 'Reisekosten',
			purpose: `${closed.number} · ${l.text}`,
			bookingType: 'Reisekosten'
		}))
	);
	/** @type {Rec[]} */
	const booked = [];
	for (const l of lines) {
		const s = stored.find((/** @type {Rec} */ x) => x.sourceId === `${closed.number}:${l.key}`);
		if (!s) continue;
		const put = await store.transactions.put({
			...s,
			travelLine: {
				statementId: closed.id,
				number: closed.number,
				category: l.category,
				account: l.account,
				taxKey: l.taxKey,
				taxVia: l.taxVia,
				receiptId: l.receiptId
			}
		});
		await confirmMatch(store, {
			receiptId: l.receiptId ?? String(closed.receiptId),
			transactionId: put.id,
			reasons: ['manual', 'travel'],
			// The statement, and a hospitality bill split in two, carry several lines.
			alongside: l.receiptId === null || l.category.startsWith('hospitality')
		});
		booked.push(put);
	}
	return { account, booked, reversed };
}
