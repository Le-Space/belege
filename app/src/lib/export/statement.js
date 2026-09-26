// The monthly statement of one account, as the export puts it into the ZIP
// (Kontoauszuege/…pdf): every booking of the month on that account, with
// quantity and rate for a crypto account, the month's totals and, where the
// account knows its balance, the balance at the start and the end.
//
// It is the receipt for what has no receipt of its own – bank and exchange
// fees, own transfers, staking rewards: their DATEV line carries the
// statement's number in Belegfeld 1 (plan.js). For a bank account it does not
// replace the bank's own statement; it lists what Belege holds.
//
// Pure: from the records the export already has. statement-pdf.js draws it.

import { accountLabel, displayPurpose } from '../bank/format.js';
import { ledgerOf } from '../booking/settings.js';
import { toUnits, valueCents } from '../assets/quantity.js';
import { hasQuantity } from '../assets/valuation.js';
import { coverageBadge } from '../matching/view.js';

/** What stands in the Beleg column for a booking without a receipt, by its kind. */
const STANDS_IN = /** @type {Record<string, string>} */ ({
	'own-transfer': 'Umbuchung',
	'bank-fee': 'Gebühr',
	'crypto-reward': 'Ertrag',
	loan: 'Darlehen',
	'rule-ignore': 'ignoriert',
	'rule-private': 'privat',
	'no-receipt': 'ohne Beleg'
});

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} StatementLine
 * @property {Rec} tx
 * @property {string} date YYYY-MM-DD
 * @property {string} text
 * @property {number} amountCents
 * @property {string | null} quantity signed units, crypto only
 * @property {number | null} decimals
 * @property {string | null} asset
 * @property {Rec | null} valuation
 * @property {string} receipt a receipt number, or what stands in for one
 */

/**
 * @typedef {object} Statement
 * @property {string} number `KA-2026-09-1210`: Belegfeld 1 for bookings without a receipt
 * @property {string} month
 * @property {Rec} account
 * @property {string} label
 * @property {string} ledger '' when none is set
 * @property {StatementLine[]} lines by date
 * @property {{ inCents: number, outCents: number, netCents: number, quantity: string | null }} totals
 * @property {{ opening: Balance, closing: Balance } | null} balances only when the account knows its balance
 */

/**
 * @typedef {object} Balance
 * @property {number} cents
 * @property {string | null} units crypto only
 */

/** `2026-09` → `2026-09-30` @param {string} month */
export function lastDay(month) {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The statement number of an account in a month: `KA-<month>-<ledger>`, or
 * the account's position when it has no ledger account yet.
 *
 * @param {string} month
 * @param {Rec} account
 * @param {number} index
 */
export function statementNumber(month, account, index) {
	const ledger = ledgerOf(account);
	return `KA-${month}-${/^\d{1,9}$/.test(String(ledger ?? '')) ? ledger : index + 1}`;
}

/** @param {Rec} tx */
function lineText(tx) {
	const parts = [String(tx.counterparty ?? '').trim(), displayPurpose(tx.purpose)].filter(Boolean);
	return [...new Set(parts)].join(' · ');
}

/**
 * @param {object} params
 * @param {string} params.month YYYY-MM
 * @param {Rec} params.account
 * @param {number} params.index the account's position among the month's accounts
 * @param {Rec[]} params.transactions all of them; the account's month is taken out
 * @param {Record<string, any>} params.classifications
 * @param {Map<string, string>} params.receiptNumbers transaction id → its first receipt's number
 * @returns {Statement}
 */
export function buildStatement({
	month,
	account,
	index,
	transactions,
	classifications,
	receiptNumbers
}) {
	const number = statementNumber(month, account, index);
	const own = transactions.filter((tx) => !tx.deleted && tx.accountId === account.id);
	const inMonth = own
		.filter((tx) => String(tx.bookedOn ?? '').slice(0, 7) === month)
		.sort((a, b) =>
			a.bookedOn === b.bookedOn ? (a.id < b.id ? -1 : 1) : a.bookedOn < b.bookedOn ? -1 : 1
		);

	/** @type {StatementLine[]} */
	const lines = inMonth.map((tx) => {
		const cover = coverageBadge(/** @type {any} */ (tx), classifications);
		const receipt = receiptNumbers.get(tx.id) ?? (cover ? STANDS_IN[cover] : null) ?? '—';
		const crypto = hasQuantity(tx);
		return {
			tx,
			date: String(tx.bookedOn),
			text: lineText(tx),
			amountCents: Number(tx.amountCents ?? 0),
			quantity: crypto ? String(tx.quantity) : null,
			decimals: crypto ? Number(tx.decimals) : null,
			asset: crypto ? String(tx.asset) : null,
			valuation: crypto ? (tx.valuation ?? null) : null,
			receipt
		};
	});

	const inCents = lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
	const outCents = lines.filter((l) => l.amountCents < 0).reduce((s, l) => s + l.amountCents, 0);
	const withQuantity = lines.filter((l) => l.quantity !== null);
	const quantity = withQuantity.length
		? withQuantity.reduce((s, l) => s + BigInt(/** @type {string} */ (l.quantity)), 0n).toString()
		: null;

	return {
		number,
		month,
		account,
		label: accountLabel(account),
		ledger: String(ledgerOf(account) ?? ''),
		lines,
		totals: { inCents, outCents, netCents: inCents + outCents, quantity },
		balances: balancesOf(account, own, month)
	};
}

/**
 * The balance at the start and the end of the month, worked back from the
 * balance the account reported last (`balance`, `balanceOn`, as the Kraken
 * sync keeps them): the end of the month is today's balance minus what was
 * booked after it. Only when that balance is from after the month.
 *
 * For a crypto account the quantity is exact; its euro value is what the
 * bookings were worth, so it is given for the quantity only. A euro account
 * gives cents.
 *
 * @param {Rec} account
 * @param {Rec[]} own the account's live transactions
 * @param {string} month
 * @returns {{ opening: Balance, closing: Balance } | null}
 */
export function balancesOf(account, own, month) {
	const end = lastDay(month);
	if (typeof account.balance !== 'string' || !Number.isInteger(account.decimals)) return null;
	if (!account.balanceOn || String(account.balanceOn) < end) return null;
	const decimals = /** @type {number} */ (account.decimals);
	let current;
	try {
		current = BigInt(toUnits(account.balance, decimals));
	} catch {
		return null;
	}
	const after = own.filter((tx) => String(tx.bookedOn ?? '') > end);
	const during = own.filter((tx) => String(tx.bookedOn ?? '').slice(0, 7) === month);

	if (account.asset && account.asset !== 'EUR') {
		const sum = (/** @type {Rec[]} */ txs) =>
			txs.reduce((s, tx) => s + (hasQuantity(tx) ? BigInt(tx.quantity) : 0n), 0n);
		const closing = current - sum(after);
		const opening = closing - sum(during);
		return {
			opening: { cents: 0, units: opening.toString() },
			closing: { cents: 0, units: closing.toString() }
		};
	}
	const sumCents = (/** @type {Rec[]} */ txs) =>
		txs.reduce((s, tx) => s + Number(tx.amountCents ?? 0), 0);
	const closing = valueCents(current.toString(), decimals, '1') - sumCents(after);
	return {
		opening: { cents: closing - sumCents(during), units: null },
		closing: { cents: closing, units: null }
	};
}

/**
 * The statements of a month: one for every account with a booking in it,
 * ordered by ledger account.
 *
 * @param {object} params
 * @param {string} params.month
 * @param {Rec[]} params.accounts
 * @param {Rec[]} params.transactions
 * @param {Record<string, any>} params.classifications
 * @param {Map<string, string>} params.receiptNumbers
 * @returns {Statement[]}
 */
export function monthStatements({
	month,
	accounts,
	transactions,
	classifications,
	receiptNumbers
}) {
	const used = new Set(
		transactions
			.filter((tx) => !tx.deleted && String(tx.bookedOn ?? '').slice(0, 7) === month)
			.map((tx) => tx.accountId)
	);
	const sorted = accounts
		.filter((a) => used.has(a.id) && !a.deleted)
		.sort((a, b) => {
			const la = String(ledgerOf(a) ?? '');
			const lb = String(ledgerOf(b) ?? '');
			return la === lb ? (a.name < b.name ? -1 : 1) : la < lb ? -1 : 1;
		});
	return sorted.map((account, index) =>
		buildStatement({ month, account, index, transactions, classifications, receiptNumbers })
	);
}
