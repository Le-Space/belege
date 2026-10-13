// A wallet's balance at the start and the end of each month, from its
// source (#287, step 3), for the monthly statement (export/statement.js):
//
//   explorer  the explorer's own balance after each change (Blockscout's
//             coin balance history, the native coin of an EVM chain).
//             Independent of the transactions: it carries what they lack,
//             a rollup's L1 data fee say.
//   history   the source's own list of movements, summed from nothing – only
//             where the whole history was read and its sum is exactly the
//             balance the source reports today. A history that misses
//             something (a fee the API does not list, a pruned node) does not
//             add up, and gives none: the statement then stays "errechnet".
//
// Either way the figure does not come from Belege's bookings: a booking left
// out (a rate not found) or deleted shows as a gap in its month. Pure;
// quantities in the asset's smallest units, as strings.

import { toUnits } from '../assets/quantity.js';

/**
 * @typedef {{ opening: string, closing: string, source: 'explorer' | 'history' }} SourceMonthBalance
 */

/** `2026-03-20T09:00:00Z` → `2026-03`. @param {string} time */
const monthOf = (time) => String(time).slice(0, 7);

/** The months from one to another, both included. @param {string} from @param {string} to */
function monthsBetween(from, to) {
	const out = [];
	let [y, m] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	while (y < ty || (y === ty && m <= tm)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

/**
 * Month balances from points of a running balance: each month's closing is
 * the value of its last point, or the month before's; its opening the month
 * before's closing – 0 before the first point, which an explorer's history
 * starts with.
 *
 * @param {{ time: string, value: string }[]} points oldest first, value in units
 * @param {string} until YYYY-MM, the last month to give
 * @param {'explorer' | 'history'} source
 * @returns {Record<string, SourceMonthBalance>}
 */
export function monthsFromPoints(points, until, source) {
	/** @type {Record<string, SourceMonthBalance>} */
	const out = {};
	const valid = points.filter((p) => /^-?\d+$/.test(p.value) && /^\d{4}-\d{2}/.test(p.time));
	if (!valid.length) return out;
	/** @type {Map<string, string>} */
	const lastOf = new Map();
	for (const p of valid) lastOf.set(monthOf(p.time), p.value);
	let balance = '0';
	for (const month of monthsBetween(monthOf(valid[0].time), until)) {
		const opening = balance;
		balance = lastOf.get(month) ?? balance;
		out[month] = { opening, closing: balance, source };
	}
	return out;
}

/**
 * From the explorer's running balance of the native coin.
 *
 * @param {{ asset: string, decimals: number, points: { time: string, value: string }[] }[] | undefined} balanceHistory
 * @param {string} asset
 * @param {string} until YYYY-MM
 * @returns {Record<string, SourceMonthBalance> | null}
 */
export function explorerMonthBalances(balanceHistory, asset, until) {
	const h = (balanceHistory ?? []).find((b) => b.asset === asset);
	if (!h || !h.points.length) return null;
	return monthsFromPoints(h.points, until, 'explorer');
}

/**
 * From the source's own list of movements of one asset, summed from nothing:
 * only where that sum is the balance the source reports today.
 *
 * @param {import('../bridge/client.js').WalletEntry[]} entries oldest first
 * @param {string} asset
 * @param {number} decimals
 * @param {string | null} balance the source's balance today, as a decimal; null: not known
 * @param {string} until YYYY-MM
 * @returns {Record<string, SourceMonthBalance> | null}
 */
export function historyMonthBalances(entries, asset, decimals, balance, until) {
	if (balance === null || balance === undefined) return null;
	// What moved: a fee always (a failed transaction pays its gas), anything else only when it went through.
	const moved = entries.filter(
		(e) => e.asset === asset && (e.type === 'fee' || e.success !== false)
	);
	let sum = 0n;
	/** @type {{ time: string, value: string }[]} */
	const points = [];
	for (const e of [...moved].sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
		sum += BigInt(toUnits(String(e.amount), decimals));
		points.push({ time: e.time || `${e.date}T00:00:00Z`, value: sum.toString() });
	}
	if (sum !== BigInt(toUnits(String(balance), decimals))) return null;
	return monthsFromPoints(points, until, 'history');
}
