// Network fees in the payment list: one row per wallet and month (#1043).
//
// A wallet that signs many transactions – a deployment recreated every few
// minutes – gets one booking per fee, each a fraction of a cent. The list
// shows them as one group per wallet, month and asset, from two fees on; the
// group expands to the single fees and confirms all of them with one
// "Übernehmen" (actions.js `confirmFeeGroup`).
//
// The grouping is `@le-space/ledger`'s (shared with Eigenbeleg's statement);
// this file turns the books' records into ledger entries and adds what only
// the books know: which fees have a confirmed account, on which accounts,
// and which the usage statement covers. Computed on every render from the
// records as they are, never stored: fees confirmed one by one before show
// up in their group without a migration.

import { groupNetworkFees } from '@le-space/ledger/fee-groups';
import { isNetworkFee } from './fee-rule.js';
import { isBookingConfirmed } from './suggest.js';

/** @typedef {Record<string, any> & { id: string, bookedOn: string }} Tx */

/**
 * @typedef {object} FeeGroupItem
 * @property {'fee-group'} kind
 * @property {string} id `fee-group:<key>`, stable while the group's wallet, month and asset are
 * @property {string} key
 * @property {string} source the wallet's chain (the records' `source`)
 * @property {string} accountId the wallet's account
 * @property {string} month YYYY-MM
 * @property {string} bookedOn the newest fee's day: where the group sits in the day list
 * @property {string} asset
 * @property {number | undefined} decimals
 * @property {string} quantity the sum in the asset's smallest unit, like a record's `quantity`
 * @property {number} amountCents the sum in cents, from the records
 * @property {string} currency
 * @property {Tx[]} fees oldest first
 * @property {Tx[]} open the fees without a confirmed account
 * @property {'all' | 'some' | 'none'} booking how many have a confirmed account
 * @property {{ account: string, count: number }[]} accounts the confirmed accounts, most used first
 * @property {'all' | 'some' | 'none'} cover how many a receipt covers (the usage statement)
 * @property {number} covered the fees a receipt covers
 * @property {string} first the oldest fee's day
 * @property {string} last the newest fee's day
 */

/** @param {unknown} x @returns {x is FeeGroupItem} */
export const isFeeGroup = (x) =>
	Boolean(x) && typeof x === 'object' && /** @type {any} */ (x).kind === 'fee-group';

/**
 * A fee that pays for something of its own – a NEAR storage deposit, a swap's
 * cost in a transaction of its own (`partOf`, `enables`, #968) – follows that
 * thing's booking and stays a row of its own.
 *
 * @param {Tx} tx
 */
const groupable = (tx) =>
	isNetworkFee(tx) &&
	!tx.storageDeposit &&
	tx.partOf == null &&
	tx.enables == null &&
	/^\d{4}-\d{2}-\d{2}$/.test(String(tx.bookedOn ?? ''));

/**
 * The books' fee record as a ledger entry. The amount is the record's
 * `quantity` in the asset's smallest unit, so the sum stays one too; the date
 * is the booking day the books show.
 *
 * @param {Tx} tx
 */
const asEntry = (tx) => ({
	id: tx.id,
	chain: String(tx.source ?? ''),
	network: '',
	account: String(tx.accountId ?? ''),
	time: String(tx.bookedAt ?? `${tx.bookedOn}T00:00:00.000Z`),
	date: String(tx.bookedOn),
	type: /** @type {const} */ ('fee'),
	kind: /** @type {const} */ ('fee'),
	asset: String(tx.asset ?? ''),
	amount: /^-?\d+$/.test(String(tx.quantity ?? '')) ? String(tx.quantity) : '0'
});

/** @param {number} n @param {number} of @returns {'all' | 'some' | 'none'} */
const share = (n, of) => (n === of ? 'all' : n === 0 ? 'none' : 'some');

/**
 * The list with every wallet's network fees of a month folded into one group,
 * where there are at least `min`; everything else as it was.
 *
 * @template {Tx} T
 * @param {T[]} txs
 * @param {object} [options]
 * @param {(tx: T) => boolean} [options.covered] whether a receipt covers the booking
 * @param {number} [options.min]
 * @returns {(T | FeeGroupItem)[]}
 */
export function withFeeGroups(txs, { covered = () => false, min = 2 } = {}) {
	const fees = txs.filter(groupable);
	if (fees.length < min) return txs;
	const byId = new Map(fees.map((tx) => [tx.id, tx]));
	const groups = groupNetworkFees(fees.map(asEntry), { min });
	if (!groups.length) return txs;
	/** @type {Set<string>} */
	const grouped = new Set();
	/** @type {FeeGroupItem[]} */
	const items = [];
	for (const g of groups) {
		const members = /** @type {T[]} */ (g.ids.map((id) => byId.get(id)).filter(Boolean));
		for (const tx of members) grouped.add(tx.id);
		const open = members.filter((tx) => !isBookingConfirmed(tx));
		/** @type {Map<string, number>} */
		const accounts = new Map();
		for (const tx of members) {
			if (!isBookingConfirmed(tx)) continue;
			const a = String(tx.booking.account);
			accounts.set(a, (accounts.get(a) ?? 0) + 1);
		}
		const days = members.map((tx) => String(tx.bookedOn)).sort();
		const coveredCount = members.filter((tx) => covered(tx)).length;
		items.push({
			kind: 'fee-group',
			id: `fee-group:${g.key}`,
			key: g.key,
			source: g.chain,
			accountId: g.account,
			month: g.month,
			bookedOn: days[days.length - 1],
			asset: g.asset,
			decimals: members.find((tx) => Number.isInteger(tx.decimals))?.decimals,
			quantity: g.amount,
			amountCents: members.reduce((n, tx) => n + (Number(tx.amountCents) || 0), 0),
			currency: String(members[0].currency ?? 'EUR'),
			fees: members,
			open,
			booking: share(members.length - open.length, members.length),
			accounts: [...accounts]
				.map(([account, count]) => ({ account, count }))
				.sort((a, b) => b.count - a.count || a.account.localeCompare(b.account)),
			cover: share(coveredCount, members.length),
			covered: coveredCount,
			first: days[0],
			last: days[days.length - 1]
		});
	}
	return [...txs.filter((tx) => !grouped.has(tx.id)), ...items];
}

/**
 * Whether an item has its account: a group when every fee has one.
 *
 * @param {Tx | FeeGroupItem} item
 * @param {(tx: Tx) => boolean} confirmed
 */
export const itemConfirmed = (item, confirmed) =>
	isFeeGroup(item) ? item.booking === 'all' : confirmed(item);

/**
 * Whether an item has its receipt: a group when every fee is covered.
 *
 * @param {Tx | FeeGroupItem} item
 * @param {(tx: Tx) => boolean} covered
 */
export const itemCovered = (item, covered) =>
	isFeeGroup(item) ? item.cover === 'all' : covered(item);

/**
 * Whether the search finds an item: a group by its own words (the network
 * fees, its wallet, its asset) or by any of its fees.
 *
 * @param {Tx | FeeGroupItem} item
 * @param {string} query
 * @param {(tx: Tx, query: string) => boolean} matches the search for one booking
 * @param {string[]} words what the group is called: "Netzwerkgebühren", the wallet's name
 */
export function itemMatches(item, query, matches, words = []) {
	if (!isFeeGroup(item)) return matches(item, query);
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if ([...words, item.asset].some((w) => String(w).toLowerCase().includes(q))) return true;
	return item.fees.some((tx) => matches(tx, query));
}
