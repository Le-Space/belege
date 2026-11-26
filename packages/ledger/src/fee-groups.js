// SPDX-License-Identifier: AGPL-3.0-or-later
// A wallet's network fees, grouped: one group per wallet, month and asset.
//
// A wallet that signs many transactions pays a fee for each – a deployment
// recreated every few minutes gives dozens a day, each a fraction of a cent.
// A payment list, a Kontoauszug or an Eigenbeleg shows them as one line per
// wallet and month; the single fees stay in the group (`ids`). The grouping is
// computed from the entries every time, never stored.

import { multiply, sum } from './decimal.js';

/** @typedef {import('./index.js').LedgerEntry} LedgerEntry */

/**
 * @typedef {object} FeeGroup
 * @property {string} key `<chain>|<network>|<account>|<month>|<asset>`
 * @property {string} chain
 * @property {string} network
 * @property {string} account the own address that paid
 * @property {string} month YYYY-MM, from the entries' `date`
 * @property {string} asset
 * @property {number} count
 * @property {string} amount the sum in the asset, a negative decimal
 * @property {string | null} eur the sum in EUR, rounded to cents (trailing zeros dropped); null without a rate for every fee
 * @property {number} eurMissing fees `rate` had no rate for
 * @property {string[]} ids the entries' ids, oldest first
 * @property {string} first the oldest fee's time, ISO 8601
 * @property {string} last the newest fee's time, ISO 8601
 */

/** The places one fee is valued at before the sum is rounded to cents. */
const FEE_PLACES = 6;

/**
 * Whether an entry is a network fee: what the chain charged for a transaction.
 * A NEAR storage deposit or the yoctoNEAR a token transfer attaches is type
 * `fee` too, but carries a `purpose`: those are no network fee.
 *
 * @param {Partial<LedgerEntry> | null | undefined} e
 */
export const isNetworkFeeEntry = (e) =>
	Boolean(e) && e?.type === 'fee' && e?.kind === 'fee' && !e?.purpose;

/**
 * Network fees grouped by wallet and month (and asset: a wallet whose fees
 * come in two denoms gets two groups). Fewer than `min` fees of one wallet in
 * one month stay ungrouped. A failed transaction's fee counts: the chain
 * charged it.
 *
 * @param {Iterable<Partial<LedgerEntry>>} entries plain ledger entries; what is no network fee is left out
 * @param {object} [options]
 * @param {'wallet-month'} [options.by] the only grouping so far
 * @param {number} [options.min] the fewest fees that make a group (default 2)
 * @param {(e: Partial<LedgerEntry>) => string | null | undefined} [options.rate] EUR per unit of the entry's asset, a decimal
 * @returns {FeeGroup[]} newest month first; inside a month by wallet, then asset
 */
export function groupNetworkFees(entries, { by = 'wallet-month', min = 2, rate } = {}) {
	if (by !== 'wallet-month') throw new Error(`groupNetworkFees: unknown grouping ${by}`);
	/** @type {Map<string, Partial<LedgerEntry>[]>} */
	const groups = new Map();
	for (const e of entries) {
		if (!isNetworkFeeEntry(e)) continue;
		const month = String(e.date ?? e.time ?? '').slice(0, 7);
		if (!/^\d{4}-\d{2}$/.test(month)) continue;
		const key = [e.chain ?? '', e.network ?? '', e.account ?? '', month, e.asset ?? ''].join('|');
		const list = groups.get(key);
		if (list) list.push(e);
		else groups.set(key, [e]);
	}
	/** @type {FeeGroup[]} */
	const out = [];
	for (const [key, list] of groups) {
		if (list.length < Math.max(1, min)) continue;
		list.sort(
			(a, b) =>
				String(a.time ?? '').localeCompare(String(b.time ?? '')) ||
				String(a.id ?? '').localeCompare(String(b.id ?? ''))
		);
		const [chain, network, account, month, asset] = key.split('|');
		let missing = 0;
		/** @type {string[]} */
		const values = [];
		for (const e of list) {
			const r = rate ? rate(e) : null;
			if (r == null || r === '' || !/^-?\d+(\.\d+)?$/.test(String(r))) missing++;
			else values.push(multiply(String(e.amount ?? '0'), String(r), FEE_PLACES));
		}
		out.push({
			key,
			chain,
			network,
			account,
			month,
			asset,
			count: list.length,
			amount: sum(list.map((e) => String(e.amount ?? '0'))),
			eur: rate && !missing ? multiply(sum(values), '1', 2) : null,
			eurMissing: rate ? missing : list.length,
			ids: list.map((e) => String(e.id ?? '')),
			first: String(list[0].time ?? ''),
			last: String(list[list.length - 1].time ?? '')
		});
	}
	return out.sort(
		(a, b) =>
			b.month.localeCompare(a.month) ||
			a.chain.localeCompare(b.chain) ||
			a.account.localeCompare(b.account) ||
			a.asset.localeCompare(b.asset)
	);
}
