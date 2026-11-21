// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bookings → series: what a chart shows, as figures. Pure calculation, in
// decimal strings (@le-space/ledger), so the figures of a chart are the
// figures of the table beside it, and can go into an API's answer as they
// are. A period is cut into buckets: its days, or its months.

import { multiply, normalize, sum } from '@le-space/ledger';

/** @typedef {'day' | 'month'} By */

/** @param {string} date YYYY-MM-DD */
const utc = (date) => {
	const [y, m, d] = date.slice(0, 10).split('-').map(Number);
	return Date.UTC(y, m - 1, d);
};

/**
 * Every bucket of a period, both ends included: `2026-08-30`, `2026-08-31`,
 * `2026-09-01` by day; `2026-08`, `2026-09` by month.
 *
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @param {By} [by]
 * @returns {string[]}
 */
export function buckets(from, to, by = 'day') {
	/** @type {string[]} */
	const out = [];
	if (!(utc(from) <= utc(to))) return out;
	if (by === 'month') {
		let [y, m] = from.split('-').map(Number);
		const end = to.slice(0, 7);
		for (;;) {
			const key = `${y}-${String(m).padStart(2, '0')}`;
			out.push(key);
			if (key >= end) return out;
			if (++m > 12) {
				m = 1;
				y++;
			}
		}
	}
	for (let t = utc(from); t <= utc(to); t += 86_400_000)
		out.push(new Date(t).toISOString().slice(0, 10));
	return out;
}

/** The bucket a date falls into. @param {string} date @param {By} by */
export const bucketOf = (date, by) => date.slice(0, by === 'month' ? 7 : 10);

/** Days while a period is short enough to tell them apart, months beyond. @param {string} from @param {string} to @param {number} [maxDays] @returns {By} */
export const granularity = (from, to, maxDays = 92) =>
	(utc(to) - utc(from)) / 86_400_000 + 1 > maxDays ? 'month' : 'day';

/**
 * @typedef {object} BalanceSeries
 * @property {By} by
 * @property {string} opening the balance before the period
 * @property {{ bucket: string, value: string }[]} points the balance at the end of each bucket
 */

/**
 * A balance over a period: the opening balance plus every movement up to the
 * end of each bucket. Movements outside the period do not count.
 *
 * @param {object} p
 * @param {string} p.opening decimal
 * @param {{ date: string, amount: string }[]} p.movements signed decimals
 * @param {string} p.from YYYY-MM-DD
 * @param {string} p.to YYYY-MM-DD
 * @param {By} [p.by]
 * @returns {BalanceSeries}
 */
export function balanceSeries({ opening, movements, from, to, by = 'day' }) {
	const keys = buckets(from, to, by);
	/** @type {Map<string, string[]>} */
	const per = new Map(keys.map((k) => [k, []]));
	for (const m of movements) {
		const d = m.date.slice(0, 10);
		if (d >= from && d <= to) per.get(bucketOf(d, by))?.push(m.amount);
	}
	let balance = normalize(opening);
	return {
		by,
		opening: balance,
		points: keys.map((bucket) => {
			balance = sum([balance, .../** @type {string[]} */ (per.get(bucket))]);
			return { bucket, value: balance };
		})
	};
}

/**
 * @typedef {object} SumSeries
 * @property {By} by
 * @property {string[]} buckets
 * @property {{ key: string, label: string, total: string, values: string[], others: boolean }[]} series
 *   one per kind, a value per bucket; the last one sums the kinds beyond `max`, when there are any
 */

/** The key of the series that sums what is beyond `max`. */
export const OTHERS = 'others';

/**
 * Sums per bucket and kind: what was consumed each day, by resource. The
 * `max` kinds with the largest sum keep a series of their own, in the order
 * they first appear; the rest is one series, `others`.
 *
 * @param {object} p
 * @param {{ date: string, amount: string, key: string, label?: string }[]} p.items
 * @param {string} p.from YYYY-MM-DD
 * @param {string} p.to YYYY-MM-DD
 * @param {By} [p.by]
 * @param {number} [p.max]
 * @param {string} [p.others] the label of the rest
 * @returns {SumSeries}
 */
export function sumSeries({ items, from, to, by = 'day', max = 4, others = OTHERS }) {
	const keys = buckets(from, to, by);
	const index = new Map(keys.map((k, i) => [k, i]));
	/** @type {Map<string, { label: string, cells: string[][] }>} */
	const kinds = new Map();
	for (const item of items) {
		const d = item.date.slice(0, 10);
		const i = d >= from && d <= to ? index.get(bucketOf(d, by)) : undefined;
		if (i === undefined) continue;
		let kind = kinds.get(item.key);
		if (!kind) {
			kind = { label: item.label ?? item.key, cells: keys.map(() => []) };
			kinds.set(item.key, kind);
		}
		kind.cells[i].push(item.amount);
	}
	const all = [...kinds].map(([key, k], first) => {
		const values = k.cells.map((c) => sum(c));
		return { key, label: k.label, total: sum(values), values, first, others: false };
	});
	// The largest keep their own series; a tie goes to the one seen first.
	const kept = new Set(
		[...all]
			.sort((a, b) => Number(b.total) - Number(a.total) || a.first - b.first)
			.slice(0, max)
			.map((s) => s.key)
	);
	const rest = all.filter((s) => !kept.has(s.key));
	const series = all
		.filter((s) => kept.has(s.key))
		.map(({ key, label, total, values }) => ({ key, label, total, values, others: false }));
	if (rest.length) {
		const values = keys.map((_, i) => sum(rest.map((s) => s.values[i])));
		series.push({ key: OTHERS, label: others, total: sum(values), values, others: true });
	}
	return { by, buckets: keys, series };
}

/**
 * The balance before a period, from a balance known for the end of one day
 * (what a source reports: an account's balance and its date) and the
 * movements: back from the anchor where it lies in or after the period,
 * forward where it lies before.
 *
 * @param {object} p
 * @param {string} p.balance decimal, at the end of `on`
 * @param {string} p.on YYYY-MM-DD
 * @param {{ date: string, amount: string }[]} p.movements signed decimals
 * @param {string} p.from YYYY-MM-DD, the first day of the period
 * @returns {string}
 */
export function openingBefore({ balance, on, movements, from }) {
	const day = on.slice(0, 10);
	/** @type {string[]} */
	const back = [];
	/** @type {string[]} */
	const forward = [];
	for (const m of movements) {
		const d = m.date.slice(0, 10);
		if (d >= from && d <= day) back.push(m.amount);
		else if (d > day && d < from) forward.push(m.amount);
	}
	return sum([balance, ...forward, ...back.map(negate)]);
}

/** @param {string} amount */
const negate = (amount) => (amount.startsWith('-') ? amount.slice(1) : `-${amount}`);

/** @param {string} amount */
const isZero = (amount) => /^-?0*(\.0*)?$/.test(amount);

/**
 * What was valued of a row of parts: their sum; null where something was
 * held and none of it has a value – a gap, not a zero.
 *
 * @param {(string | null)[]} parts
 * @returns {string | null}
 */
const valued = (parts) => {
	const known = /** @type {string[]} */ (parts.filter((p) => p !== null));
	return known.length < parts.length && known.every(isZero) ? null : sum(known);
};

/**
 * Value series summed bucket by bucket: the lines a reader left visible as
 * one. A bucket is null only where every series has a gap there.
 *
 * @param {(string | null)[][]} rows a value per bucket each
 * @param {number} length the number of buckets
 * @returns {(string | null)[]}
 */
export function sumValues(rows, length) {
	return Array.from({ length }, (_, i) => {
		const parts = rows.map((r) => r[i] ?? null);
		return parts.length ? valued(parts) : '0';
	});
}

/**
 * @typedef {object} ValueLine
 * @property {string} key
 * @property {(string | null)[]} values per bucket, in the currency of the rates, two decimals;
 *   null: something was held and none of it had a rate
 * @property {string[][]} missing per bucket, the assets held without a rate: they are not in the value
 */

/**
 * @typedef {object} ValueSeries
 * @property {By} by
 * @property {string[]} buckets
 * @property {{ key: string, account: string, group: string, asset: string, quantities: string[], values: (string | null)[] }[]} holdings
 *   per bucket what was held (the asset's own unit) and what it was worth; null: no rate
 * @property {(ValueLine & { group: string })[]} accounts the holdings of an account summed, in the order they first appear
 * @property {ValueLine[]} groups the accounts of a group (a chain) summed
 * @property {{ asset: string, buckets: string[] }[]} missing per asset, the buckets it was held in and had no rate for
 */

/**
 * Holdings at their value: for each bucket the quantity held at its end times
 * the bucket's rate, per holding, summed per account and per group. A
 * holding without a rate for a bucket is left out of that bucket's sums and
 * named in `missing`; nothing is carried from another day. Nothing held needs
 * no rate.
 *
 * @param {object} p
 * @param {{ key: string, account: string, group: string, asset: string, opening: string, movements: { date: string, amount: string }[] }[]} p.holdings
 *   one asset in one account: its quantity before the period and what moved, as decimals
 * @param {(asset: string, bucket: string) => string | null | undefined} p.rate the value of one unit; null or undefined: not known
 * @param {string} p.from YYYY-MM-DD
 * @param {string} p.to YYYY-MM-DD
 * @param {By} [p.by]
 * @returns {ValueSeries}
 */
export function valueSeries({ holdings, rate, from, to, by = 'day' }) {
	const keys = buckets(from, to, by);
	/** @type {Map<string, Set<string>>} */
	const gaps = new Map();
	const held = holdings.map((h) => {
		const quantities = balanceSeries({ ...h, from, to, by }).points.map((p) => p.value);
		const values = quantities.map((q, i) => {
			if (isZero(q)) return '0';
			const r = rate(h.asset, keys[i]);
			if (typeof r === 'string' && /^\d+(\.\d+)?$/.test(r)) return multiply(q, r, 2);
			if (!gaps.has(h.asset)) gaps.set(h.asset, new Set());
			gaps.get(h.asset)?.add(keys[i]);
			return null;
		});
		return { key: h.key, account: h.account, group: h.group, asset: h.asset, quantities, values };
	});
	/** @param {typeof held} parts @returns {Pick<ValueLine, 'values' | 'missing'>} */
	const line = (parts) => ({
		values: keys.map((_, i) => valued(parts.map((h) => h.values[i]))),
		missing: keys.map((_, i) => [
			...new Set(parts.filter((h) => h.values[i] === null).map((h) => h.asset))
		])
	});
	/** @param {(h: (typeof held)[number]) => string} of */
	const per = (of) => {
		/** @type {Map<string, typeof held>} */
		const m = new Map();
		for (const h of held) m.set(of(h), [...(m.get(of(h)) ?? []), h]);
		return m;
	};
	return {
		by,
		buckets: keys,
		holdings: held,
		accounts: [...per((h) => `${h.group}\u0000${h.account}`).values()].map((parts) => ({
			key: parts[0].account,
			group: parts[0].group,
			...line(parts)
		})),
		groups: [...per((h) => h.group)].map(([key, parts]) => ({ key, ...line(parts) })),
		missing: [...gaps].map(([asset, set]) => ({ asset, buckets: keys.filter((k) => set.has(k)) }))
	};
}
