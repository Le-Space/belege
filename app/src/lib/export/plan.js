// What a month's DATEV export holds, before anything is written: the lines
// of the Buchungsstapel, the receipts and their numbers, and the check list
// the export page shows. Pure, from the records the app already has.
//
// Decisions (docs/export.md):
//   - every booking of the month needs a confirmed account ("Übernehmen");
//     the check list blocks the export until it has one, also for fees and
//     transfers, whose suggestion is automatic but still confirmed
//   - every bank account with a booking in the month needs its ledger
//     account (Eigene Anweisungen)
//   - one line per booking; Konto = the bank's ledger account, Gegenkonto =
//     the confirmed account; Belegdatum = the booking date, so every line
//     lies inside the stack's period
//   - a booking with several receipts: the first receipt's number in
//     Belegfeld 1; all its receipts go into the ZIP
//   - an own transfer between two of our accounts whose other side is in
//     the books is exported once, from the account with the lower ledger
//     number, against the other bank's ledger account (not 1360, which
//     would then stay open); the other side is left out of the stack
//   - receipt numbers YYYY-MM-NNN in booking order, kept on the receipt
//     (`exportNumber`) once exported, so a second export gives the same ones
//   - every account with a booking in the month gets a statement in the ZIP
//     (statement.js); a booking without a receipt of its own – a fee, an own
//     transfer, a reward – carries that statement's number (KA-YYYY-MM-<ledger>)
//     in Belegfeld 1: the statement is its receipt

import { isBookingConfirmed } from '../booking/suggest.js';
import { ledgerOf } from '../booking/settings.js';
import { isActive } from '../matching/engine.js';
import { isTxCovered, matchesOfTx } from '../matching/view.js';
import { dayNumber } from '../matching/normalize.js';
import { MIRROR_DAYS } from '../matching/context.js';
import { needsConfirmation } from '../receipts/import.js';
import { receiptDate, receiptVendor } from '../receipts/view.js';
import { TRANSFER_ACCOUNT } from '../booking/skr03.js';
import { quantityText } from '../assets/valuation.js';
import { monthStatements } from './statement.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {import('../matching/classify.js').Classification} Classification */

/** A number the export gave a receipt. */
export const RECEIPT_NUMBER = /^(\d{4}-\d{2})-(\d{3})$/;

/**
 * @typedef {object} PlannedLine
 * @property {Rec} tx
 * @property {Rec | null} bank the bank account record
 * @property {Rec[]} receipts linked receipts, first one first
 * @property {Rec | null} match the first receipt's active match
 * @property {Rec | null} transferWith the other side, for a transfer exported once
 * @property {import('./datev.js').BookingLine} line
 */

/**
 * @typedef {object} MonthPlan
 * @property {string} month
 * @property {Rec[]} bookings the month's bookings, by date
 * @property {PlannedLine[]} lines what goes into the Buchungsstapel
 * @property {{ tx: Rec, other: Rec }[]} transferSides bookings left out: the other side of a transfer line
 * @property {Map<string, string>} numbers receipt id → its number
 * @property {{ receiptId: string, number: string }[]} newNumbers numbers given in this export
 * @property {Rec[]} receipts the receipts that go into the ZIP (with a file, released)
 * @property {import('./statement.js').Statement[]} statements one per account with a booking in the month
 * @property {{ unassigned: Rec[], noLedger: Rec[], noBankAccount: Rec[], missingReceipt: Rec[], unlinkedReceipts: Rec[], unverified: Rec[] }} checks
 * @property {boolean} blocked
 */

/** @param {Rec} a @param {Rec} b */
const byDate = (a, b) =>
	a.bookedOn === b.bookedOn ? (a.id < b.id ? -1 : 1) : a.bookedOn < b.bookedOn ? -1 : 1;

/**
 * Whether a booking is an own transfer: confirmed on 1360, or – not yet
 * confirmed – classified as one. A person who confirmed another account
 * (say 1800, a private withdrawal) decided otherwise.
 *
 * @param {Rec} tx
 * @param {Record<string, Classification>} classifications
 */
function isTransfer(tx, classifications) {
	return isBookingConfirmed(tx)
		? String(tx.booking.account) === TRANSFER_ACCOUNT
		: classifications[tx.id]?.kind === 'own-transfer';
}

/**
 * The other side of an own transfer in the books: the counter-booking the
 * classification found, or the one booking on another account with the
 * opposite amount within a few days that is a transfer too.
 *
 * @param {Rec} tx
 * @param {Rec[]} transactions all of them, every month
 * @param {Record<string, Classification>} classifications
 * @returns {Rec | null}
 */
export function transferCounterpart(tx, transactions, classifications) {
	if (!isTransfer(tx, classifications)) return null;
	const named = classifications[tx.id]?.counterBookingId;
	if (named) {
		const found = transactions.find((o) => o.id === named && !o.deleted);
		if (found) return found;
	}
	const day = dayNumber(tx.bookedOn);
	if (day === null) return null;
	const candidates = transactions.filter((o) => {
		const d = dayNumber(o.bookedOn);
		return (
			!o.deleted &&
			o.id !== tx.id &&
			o.accountId !== tx.accountId &&
			o.amountCents === -tx.amountCents &&
			(o.currency ?? 'EUR') === (tx.currency ?? 'EUR') &&
			d !== null &&
			Math.abs(d - day) <= MIRROR_DAYS &&
			isTransfer(o, classifications)
		);
	});
	return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Of a transfer's two sides, the one that is exported: the lower ledger
 * account, and on a tie the older record.
 *
 * @param {{ tx: Rec, ledger: string }} a
 * @param {{ tx: Rec, ledger: string }} b
 */
function exportsSide(a, b) {
	const x = Number(a.ledger);
	const y = Number(b.ledger);
	return x !== y ? x < y : a.tx.id < b.tx.id;
}

/**
 * Receipt numbers for the month: the ones given before are kept, new ones
 * continue after the highest number of this month.
 *
 * @param {string} month YYYY-MM
 * @param {Rec[]} ordered receipts in the order they are numbered
 * @param {Rec[]} allReceipts to find the numbers already given
 */
export function numberReceipts(month, ordered, allReceipts) {
	let highest = 0;
	for (const r of allReceipts) {
		const m = RECEIPT_NUMBER.exec(String(r.exportNumber ?? ''));
		if (m && m[1] === month) highest = Math.max(highest, Number(m[2]));
	}
	/** @type {Map<string, string>} */
	const numbers = new Map();
	/** @type {{ receiptId: string, number: string }[]} */
	const fresh = [];
	for (const r of ordered) {
		if (numbers.has(r.id)) continue;
		if (RECEIPT_NUMBER.test(String(r.exportNumber ?? ''))) {
			numbers.set(r.id, String(r.exportNumber));
			continue;
		}
		const number = `${month}-${String(++highest).padStart(3, '0')}`;
		numbers.set(r.id, number);
		fresh.push({ receiptId: r.id, number });
	}
	return { numbers, fresh };
}

/**
 * What the Buchungstext says: the receipt's vendor, else the counterparty,
 * else the purpose. A crypto movement adds what moved (`… 0,015 BTC`), in
 * front of the 60-character cut, so the quantity is never the part cut off.
 *
 * @param {Rec} tx
 * @param {Rec | null} receipt
 */
export function bookingText(tx, receipt) {
	const vendor = receipt ? receiptVendor(/** @type {any} */ (receipt)) : '';
	const base =
		vendor && vendor !== '—'
			? vendor
			: String(tx.counterparty ?? '').trim() || String(tx.purpose ?? '').trim();
	const quantity = quantityText(tx).replace(/\u00a0/g, ' ');
	if (!quantity) return base;
	const room = 60 - quantity.length - 1;
	return base ? `${base.slice(0, Math.max(room, 0)).trim()} ${quantity}` : quantity;
}

/**
 * @param {object} params
 * @param {string} params.month YYYY-MM
 * @param {Rec[]} params.transactions
 * @param {Rec[]} params.accounts
 * @param {Rec[]} params.receipts
 * @param {Rec[]} params.matches
 * @param {Record<string, any>} params.classifications
 * @returns {MonthPlan}
 */
export function planMonth({ month, transactions, accounts, receipts, matches, classifications }) {
	const live = transactions.filter((t) => !t.deleted);
	const bookings = live.filter((t) => String(t.bookedOn ?? '').slice(0, 7) === month).sort(byDate);
	const accountOf = (/** @type {Rec} */ tx) => accounts.find((a) => a.id === tx.accountId) ?? null;
	const receiptOf = (/** @type {string} */ id) =>
		receipts.find((r) => r.id === id && !r.deleted) ?? null;
	const linkedOf = (/** @type {Rec} */ tx) =>
		matchesOfTx(tx.id, matches).flatMap((m) => {
			const r = receiptOf(m.receiptId);
			return r ? [{ receipt: r, match: m }] : [];
		});

	// Receipts in booking order, numbered.
	const ordered = bookings.flatMap((tx) => linkedOf(tx).map((x) => x.receipt));
	const { numbers, fresh } = numberReceipts(month, ordered, receipts);

	/** @type {Map<string, string>} */
	const receiptNumbers = new Map();
	for (const tx of bookings) {
		const first = linkedOf(tx)[0];
		const n = first ? numbers.get(first.receipt.id) : undefined;
		if (n) receiptNumbers.set(tx.id, n);
	}
	const statements = monthStatements({
		month,
		accounts,
		transactions: live,
		classifications,
		receiptNumbers
	});
	const statementOf = new Map(statements.map((s) => [s.account.id, s.number]));

	/** @type {PlannedLine[]} */
	const lines = [];
	/** @type {{ tx: Rec, other: Rec }[]} */
	const transferSides = [];
	for (const tx of bookings) {
		if (!isBookingConfirmed(tx)) continue;
		const bank = accountOf(tx);
		const ledger = ledgerOf(bank);
		if (!ledger) continue;
		const linked = linkedOf(tx);
		const first = linked[0] ?? null;
		const other = transferCounterpart(tx, live, classifications);
		const otherLedger = other ? ledgerOf(accountOf(other)) : null;
		if (other && otherLedger && otherLedger !== ledger) {
			if (!exportsSide({ tx, ledger }, { tx: other, ledger: otherLedger })) {
				transferSides.push({ tx, other });
				continue;
			}
		}
		const transferLine = Boolean(other && otherLedger && otherLedger !== ledger);
		lines.push({
			tx,
			bank,
			receipts: linked.map((x) => x.receipt),
			match: first?.match ?? null,
			transferWith: transferLine ? other : null,
			line: {
				amountCents: Number(tx.amountCents ?? 0),
				currency: String(tx.currency ?? 'EUR'),
				account: ledger,
				contra: transferLine ? /** @type {string} */ (otherLedger) : String(tx.booking.account),
				taxKey: transferLine ? '' : String(tx.booking.taxKey ?? ''),
				date: String(tx.bookedOn),
				receiptNumber: first
					? (numbers.get(first.receipt.id) ?? '')
					: (statementOf.get(String(tx.accountId)) ?? ''),
				text: bookingText(tx, first?.receipt ?? null)
			}
		});
	}

	const monthReceipts = receipts.filter(
		(r) => !r.deleted && String(receiptDate(/** @type {any} */ (r)) ?? '').slice(0, 7) === month
	);
	const activeLinked = new Set(matches.filter((m) => isActive(m)).map((m) => m.receiptId));
	const usedBanks = [...new Set(bookings.map((t) => t.accountId).filter(Boolean))];
	const checks = {
		unassigned: bookings.filter((t) => !isBookingConfirmed(t)),
		noLedger: usedBanks
			.map((id) => accounts.find((a) => a.id === id) ?? null)
			.filter((a) => a && !ledgerOf(a))
			.map((a) => /** @type {Rec} */ (a)),
		noBankAccount: bookings.filter((t) => !accountOf(t)),
		missingReceipt: bookings.filter((t) => !isTxCovered(/** @type {any} */ (t), classifications)),
		unlinkedReceipts: monthReceipts.filter(
			(r) => !activeLinked.has(r.id) && r.status !== 'ignoriert' && !needsConfirmation(r)
		),
		unverified: monthReceipts.filter((r) => needsConfirmation(r) && r.status !== 'ignoriert')
	};
	const zipReceipts = [...new Map(ordered.map((r) => [r.id, r])).values()].filter(
		(r) => r.fileCid && !needsConfirmation(r)
	);
	return {
		month,
		bookings,
		lines,
		transferSides,
		numbers,
		newNumbers: fresh,
		receipts: zipReceipts,
		statements,
		checks,
		blocked:
			bookings.length === 0 ||
			checks.unassigned.length > 0 ||
			checks.noLedger.length > 0 ||
			checks.noBankAccount.length > 0
	};
}
