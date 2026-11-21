// The chart of the wallets' balances in euros (#908): what each wallet held
// at the end of each day of the last two months, at the day's rate, one line
// per chain – or per account, where a chain is opened. Pure: the page
// (WalletValueChart.svelte) gets the rates and draws.
//
// The balance of a day comes from the bookings the sync holds (each asset's
// quantity, running), anchored at the balance the source reports (`balance`,
// `balanceOn` on the account); where the source gave none, from the bookings
// alone. The value of a day is quantity × the day's rate: the rate a booking
// of that day was valued with, else the day's market rate through the bridge
// (a listed asset's days in one call for the whole period, a token's by its
// contract day by day).
// A day without a rate leaves the asset out and says so; only an asset the
// books themselves never value at a market rate (a token priced by its pool,
// a rate typed by hand) is valued with the rate of its last booking, and the
// page says that as well.

import { openingBefore, sumValues, valueSeries } from '@le-space/charts';
import { fromUnits, sum } from '@le-space/ledger';

/** @typedef {import('./wallet-sync.js').Wallet} Wallet */
/** @typedef {{ key: string, account: string, group: string, asset: string, symbol: string, decimals: number, contract?: string, opening: string, movements: { date: string, amount: string }[] }} Holding `asset` is the key its rates go by */
/** @typedef {{ rates: Map<string, { day: string, rate: string }[]>, ownOnly: Set<string> }} BookRates per asset key its rates, oldest first; `ownOnly`: assets never valued at a market rate */

/** Where a rate is the books' own and no market's (assets/valuation.js). */
const OWN_SOURCES = new Set(['dex', 'manual', 'migration']);

/** The colours a line can have, in the order of @le-space/charts. */
const COLORS = /** @type {const} */ (['s1', 's2', 's3', 's4']);

/**
 * The last two months up to today, both ends included.
 *
 * @param {string} today YYYY-MM-DD
 * @param {number} [months]
 * @returns {{ from: string, to: string }}
 */
export function chartPeriod(today, months = 2) {
	const [y, m, d] = today.split('-').map(Number);
	const first = new Date(Date.UTC(y, m - 1 - months, 1));
	const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
	// The same day two months ago, or that month's last one; the period starts the day after.
	first.setUTCDate(Math.min(d, last) + 1);
	return { from: first.toISOString().slice(0, 10), to: today };
}

/**
 * A token by its contract has its rates by chain and contract: two tokens of
 * one symbol are not one asset.
 *
 * @param {Record<string, any>} account
 */
const rateKey = (account) =>
	account.tokenContract
		? `${account.asset}@${account.source}:${String(account.tokenContract).toLowerCase()}`
		: String(account.asset);

/**
 * What each wallet holds, asset by asset: the quantity before the period and
 * what moved since, as decimals.
 *
 * @param {object} p
 * @param {Wallet[]} p.wallets
 * @param {Record<string, any>[]} p.accounts
 * @param {Record<string, any>[]} p.transactions
 * @param {string} p.from YYYY-MM-DD
 * @returns {Holding[]}
 */
export function walletHoldings({ wallets, accounts, transactions, from }) {
	/** @type {Map<string, { date: string, amount: string }[]>} */
	const moved = new Map();
	const wanted = new Map(
		accounts
			.filter((a) => a.kind === 'wallet' && !a.deleted && Number.isInteger(a.decimals) && a.asset)
			.map((a) => [a.id, a])
	);
	for (const tx of transactions) {
		const account = wanted.get(tx.accountId);
		if (!account || tx.deleted) continue;
		if (typeof tx.quantity !== 'string' || !/^-?\d+$/.test(tx.quantity)) continue;
		if (!/^\d{4}-\d{2}-\d{2}/.test(String(tx.bookedOn))) continue;
		const list = moved.get(account.id) ?? [];
		list.push({ date: tx.bookedOn.slice(0, 10), amount: fromUnits(tx.quantity, account.decimals) });
		moved.set(account.id, list);
	}
	/** @type {Holding[]} */
	const out = [];
	for (const wallet of wallets) {
		const own = [...wanted.values()]
			.filter((a) => a.source === wallet.chain && a.walletAddress === wallet.address)
			.sort((a, b) => (String(a.asset) < String(b.asset) ? -1 : 1));
		for (const a of own) {
			const movements = moved.get(a.id) ?? [];
			const anchored =
				typeof a.balance === 'string' &&
				/^-?\d+(\.\d+)?$/.test(a.balance) &&
				/^\d{4}-\d{2}-\d{2}/.test(String(a.balanceOn));
			out.push({
				key: a.id,
				account: wallet.id,
				group: wallet.chain,
				asset: rateKey(a),
				symbol: String(a.asset),
				decimals: a.decimals,
				...(a.tokenContract ? { contract: String(a.tokenContract).toLowerCase() } : {}),
				opening: anchored
					? openingBefore({ balance: a.balance, on: a.balanceOn, movements, from })
					: sum(movements.filter((m) => m.date < from).map((m) => m.amount)),
				movements
			});
		}
	}
	return out;
}

/**
 * The rates the books already use: per asset and day, what a booking of that
 * day was valued with (the last one of the day).
 *
 * @param {Holding[]} holdings
 * @param {Record<string, any>[]} transactions
 * @returns {BookRates}
 */
export function bookRates(holdings, transactions) {
	const keyOf = new Map(holdings.map((h) => [h.key, h.asset]));
	/** @type {Map<string, Map<string, string>>} */
	const per = new Map();
	/** @type {Map<string, boolean>} */
	const own = new Map();
	const sorted = transactions
		.filter((tx) => keyOf.has(tx.accountId))
		.sort((a, b) => (String(a.bookedAt ?? a.bookedOn) < String(b.bookedAt ?? b.bookedOn) ? -1 : 1));
	for (const tx of sorted) {
		const key = keyOf.get(tx.accountId);
		const rate = tx.valuation?.rate;
		if (!key || tx.deleted || typeof rate !== 'string' || !/^\d+(\.\d+)?$/.test(rate)) continue;
		if (!/^\d{4}-\d{2}-\d{2}/.test(String(tx.bookedOn))) continue;
		if (!per.has(key)) per.set(key, new Map());
		per.get(key)?.set(tx.bookedOn.slice(0, 10), rate);
		own.set(key, (own.get(key) ?? true) && OWN_SOURCES.has(tx.valuation.source));
	}
	return {
		rates: new Map(
			[...per].map(([key, days]) => [
				key,
				[...days].map(([day, rate]) => ({ day, rate })).sort((a, b) => (a.day < b.day ? -1 : 1))
			])
		),
		ownOnly: new Set([...own].filter(([, only]) => only).map(([key]) => key))
	};
}

/**
 * The rate of an asset on a day, and which assets were valued with the rate
 * of an earlier booking because the books have no market rate for them
 * (`carried`).
 *
 * @param {object} p
 * @param {BookRates} p.books
 * @param {Map<string, string>} p.fetched `<asset key>@<day>` → EUR per unit, from the bridge
 * @returns {{ rate: (asset: string, day: string) => string | null, carried: Set<string> }}
 */
export function rateSource({ books, fetched }) {
	/** @type {Set<string>} */
	const carried = new Set();
	return {
		carried,
		rate(asset, day) {
			const own = books.rates.get(asset) ?? [];
			const sameDay = own.find((r) => r.day === day);
			if (sameDay) return sameDay.rate;
			const market = fetched.get(`${asset}@${day}`);
			if (market) return market;
			if (!books.ownOnly.has(asset)) return null;
			const before = own.filter((r) => r.day < day).at(-1);
			if (!before) return null;
			carried.add(asset);
			return before.rate;
		}
	};
}

/**
 * The rates to ask the bridge for: every day an asset was held on and the
 * books have no rate of, the newest first, asset by asset in turn – so each
 * line grows from today backwards. Not for an asset the books value by
 * themselves, and not what is there already.
 *
 * @param {object} p
 * @param {Holding[]} p.holdings
 * @param {BookRates} p.books
 * @param {Map<string, string>} [p.fetched]
 * @param {string} p.from
 * @param {string} p.to
 * @returns {{ key: string, symbol: string, day: string, contract?: string, chain?: string }[]}
 */
export function neededRates({ holdings, books, fetched = new Map(), from, to }) {
	const bare = valueSeries({
		holdings,
		from,
		to,
		rate: (asset, day) =>
			books.rates.get(asset)?.find((r) => r.day === day)?.rate ?? fetched.get(`${asset}@${day}`)
	});
	const meta = new Map(holdings.map((h) => [h.asset, h]));
	const asked = bare.missing.filter((m) => !books.ownOnly.has(m.asset));
	const perAsset = asked.map(({ asset, buckets }) => {
		const h = /** @type {Holding} */ (meta.get(asset));
		return [...buckets].reverse().map((day) => ({
			key: asset,
			symbol: h.symbol,
			day,
			...(h.contract ? { contract: h.contract, chain: h.group } : {})
		}));
	});
	const out = [];
	for (let i = 0; perAsset.some((list) => i < list.length); i++)
		for (const list of perAsset) if (i < list.length) out.push(list[i]);
	return out;
}

/**
 * @typedef {object} ChartLine
 * @property {string} key `chain:<id>` or `account:<wallet id>`
 * @property {'chain' | 'account'} kind
 * @property {string} chain
 * @property {(string | null)[]} values what is visible of it, per day
 * @property {string[][]} missing per day, the assets left out for want of a rate
 * @property {boolean} visible
 * @property {'s1' | 's2' | 's3' | 's4' | 'other'} color stays with the line, whatever else is hidden
 */

/**
 * @typedef {object} ChartModel
 * @property {string[]} buckets
 * @property {{ chain: string, accounts: { key: string, wallet: string, visible: boolean }[], visible: boolean, open: boolean }[]} chains
 *   what the checkboxes show: every chain, its accounts where it has several
 * @property {ChartLine[]} lines one per chain, or per account of an opened chain; the largest first
 * @property {(string | null)[] | null} rest the visible lines beyond the fourth, as one; null: none
 * @property {(string | null)[]} total everything visible together
 * @property {string[][]} missing per day, the assets missing in what is visible
 * @property {{ symbol: string, quantities: string[] }[]} quantities per asset, what the visible accounts held each day
 */

/** @param {(string | null)[]} values the last value there is, as a number */
const lastValue = (values) => Number(values.findLast((v) => v !== null) ?? 0);

/**
 * The lines of the chart from the series: which there are, which are
 * visible, and their colours. A colour goes by the line's rank among all
 * lines, hidden ones included, so hiding one never repaints another.
 *
 * @param {object} p
 * @param {import('@le-space/charts').ValueSeries} p.series
 * @param {Holding[]} p.holdings
 * @param {Set<string>} p.hidden keys of chains and accounts whose checkbox is off
 * @param {Set<string>} p.open chains shown account by account
 * @returns {ChartModel}
 */
export function chartModel({ series, holdings, hidden, open }) {
	const n = series.buckets.length;
	const chains = series.groups.map((g) => {
		const accounts = series.accounts.filter((a) => a.group === g.key);
		const visible = !hidden.has(`chain:${g.key}`);
		return {
			chain: g.key,
			visible,
			open: accounts.length > 1 && open.has(g.key),
			accounts: accounts.map((a) => ({
				key: `account:${a.key}`,
				wallet: a.key,
				line: a,
				visible: visible && !hidden.has(`account:${a.key}`)
			}))
		};
	});
	/** @type {(ChartLine & { rank: number })[]} */
	const lines = [];
	for (const c of chains) {
		const whole = /** @type {import('@le-space/charts').ValueLine} */ (
			series.groups.find((g) => g.key === c.chain)
		);
		if (c.open) {
			for (const a of c.accounts)
				lines.push({
					key: a.key,
					kind: 'account',
					chain: c.chain,
					values: a.line.values,
					missing: a.line.missing,
					visible: a.visible,
					color: 'other',
					rank: lastValue(a.line.values)
				});
			continue;
		}
		const shown = c.accounts.filter((a) => a.visible);
		lines.push({
			key: `chain:${c.chain}`,
			kind: 'chain',
			chain: c.chain,
			values: sumValues(
				shown.map((a) => a.line.values),
				n
			),
			missing: series.buckets.map((_, i) => [...new Set(shown.flatMap((a) => a.line.missing[i]))]),
			visible: c.visible && shown.length > 0,
			color: 'other',
			// By the whole chain, so an account's checkbox does not move the chain's colour.
			rank: lastValue(whole.values)
		});
	}
	lines.sort((a, b) => b.rank - a.rank || (a.key < b.key ? -1 : 1));
	lines.forEach((l, i) => (l.color = COLORS[i] ?? 'other'));
	const visible = lines.filter((l) => l.visible);
	const rest = visible.filter((l) => l.color === 'other');
	const shownAccounts = new Set(
		chains.flatMap((c) => c.accounts.filter((a) => a.visible).map((a) => a.wallet))
	);
	/** @type {Map<string, string[][]>} */
	const perSymbol = new Map();
	for (const h of series.holdings) {
		if (!shownAccounts.has(h.account)) continue;
		const symbol = holdings.find((x) => x.key === h.key)?.symbol ?? h.asset;
		perSymbol.set(symbol, [...(perSymbol.get(symbol) ?? []), h.quantities]);
	}
	return {
		buckets: series.buckets,
		chains: chains.map((c) => ({
			chain: c.chain,
			visible: c.visible,
			open: c.open,
			accounts: c.accounts.map(({ key, wallet, visible }) => ({ key, wallet, visible }))
		})),
		lines: lines.map(({ key, kind, chain, values, missing, visible, color }) => ({
			key,
			kind,
			chain,
			values,
			missing,
			visible,
			color
		})),
		rest: rest.length
			? sumValues(
					rest.map((l) => l.values),
					n
				)
			: null,
		total: sumValues(
			visible.map((l) => l.values),
			n
		),
		missing: series.buckets.map((_, i) => [...new Set(visible.flatMap((l) => l.missing[i]))]),
		quantities: [...perSymbol]
			.map(([symbol, rows]) => ({
				symbol,
				quantities: series.buckets.map((_, i) => sum(rows.map((r) => r[i])))
			}))
			.sort((a, b) => (a.symbol < b.symbol ? -1 : 1))
	};
}

/** The longest period the bridge answers in one call (`rates.range`; the rate service caps it, packages/rates/src/rates.js MAX_RANGE_DAYS). */
export const MAX_SPAN_DAYS = 100;

/** @param {string} day @param {number} n */
const addDays = (day, n) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/**
 * @typedef {{ key: string, symbol: string, day: string, contract?: string, chain?: string }} RateNeed
 * @typedef {{ key: string, symbol: string, from: string, to: string, needs: RateNeed[] }} RateSpan
 *   the days of one asset to ask for in one call, from the first needed to the last
 */

/**
 * The needed rates as periods, one per listed asset – the bridge answers a
 * period in one call – and what stays day by day: a token by its contract.
 * A period longer than the bridge takes is cut.
 *
 * @param {RateNeed[]} needs
 * @param {number} [maxDays]
 * @returns {{ spans: RateSpan[], single: RateNeed[] }}
 */
export function rateSpans(needs, maxDays = MAX_SPAN_DAYS) {
	/** @type {Map<string, RateNeed[]>} */
	const perAsset = new Map();
	/** @type {RateNeed[]} */
	const single = [];
	for (const need of needs) {
		if (need.contract) single.push(need);
		else perAsset.set(need.key, [...(perAsset.get(need.key) ?? []), need]);
	}
	/** @type {RateSpan[]} */
	const spans = [];
	for (const [key, list] of perAsset) {
		const sorted = [...list].sort((a, b) => (a.day < b.day ? -1 : 1));
		for (const need of sorted) {
			const last = spans.at(-1);
			if (last?.key === key && need.day <= addDays(last.from, maxDays - 1)) {
				last.to = need.day;
				last.needs.push(need);
			} else {
				spans.push({ key, symbol: need.symbol, from: need.day, to: need.day, needs: [need] });
			}
		}
	}
	return { spans, single };
}

/** A bridge older than the command for a period (bridge/client.js: 404, `BRIDGE_OUTDATED`). @param {any} error */
const unknownToBridge = (error) => error?.code === 'BRIDGE_OUTDATED' || error?.status === 404;

const RATE = /^\d+(\.\d+)?$/;

/**
 * Asks for rates and hands each over as it arrives: a listed asset's days in
 * one call for the whole period (`getRange`), a token by its contract day by
 * day (`getRate`), a few calls at a time. A day the period's answer has no
 * rate for stays without one. A bridge that does not know the call for a
 * period is asked day by day, as before. An asset the bridge has no rate for
 * three times day by day, and never had one, is not asked for again in this
 * run: its days stay without a rate.
 *
 * @param {object} p
 * @param {RateNeed[]} p.needs
 * @param {(need: { symbol: string, day: string, contract?: string, chain?: string }) => Promise<{ rate: string }>} p.getRate
 * @param {(span: { symbol: string, from: string, to: string }) => Promise<{ rates: { date: string, rate: string }[] }>} [p.getRange]
 *   without it, everything goes day by day
 * @param {(key: string, day: string, rate: string) => void} p.onRate
 * @param {(done: number, count: number) => void} [p.onProgress]
 * @param {() => boolean} [p.stopped] true: stop asking (the page was left)
 * @param {number} [p.parallel]
 * @returns {Promise<{ failed: number }>} lookups without a rate
 */
export async function loadRates({
	needs,
	getRate,
	getRange,
	onRate,
	onProgress,
	stopped = () => false,
	parallel = 2
}) {
	/** @type {Map<string, { ok: number, failed: number }>} */
	const tally = new Map();
	/** @type {Set<string>} */
	const givenUp = new Set();
	let done = 0;
	let failed = 0;
	const { spans, single } = getRange ? rateSpans(needs) : { spans: [], single: needs };
	/** What goes day by day: the tokens, and every asset of a bridge without the call for a period. */
	const byDay = [...single];
	let rangeKnown = true;
	let nextSpan = 0;
	const spanWorker = async () => {
		while (nextSpan < spans.length && !stopped()) {
			const span = spans[nextSpan++];
			if (!rangeKnown) {
				byDay.push(...span.needs);
				continue;
			}
			/** @type {Map<string, string>} */
			const got = new Map();
			try {
				const answer = await /** @type {NonNullable<typeof getRange>} */ (getRange)(span);
				for (const r of Array.isArray(answer?.rates) ? answer.rates : []) {
					if (typeof r?.date === 'string' && typeof r.rate === 'string' && RATE.test(r.rate))
						got.set(r.date, r.rate);
				}
			} catch (error) {
				if (unknownToBridge(error)) {
					rangeKnown = false;
					byDay.push(...span.needs);
					continue;
				}
			}
			for (const need of span.needs) {
				const rate = got.get(need.day);
				if (rate) onRate(need.key, need.day, rate);
				else failed++;
			}
			done += span.needs.length;
			onProgress?.(done, needs.length);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, parallel) }, spanWorker));

	let next = 0;
	const worker = async () => {
		while (next < byDay.length && !stopped()) {
			const need = byDay[next++];
			const count = tally.get(need.key) ?? { ok: 0, failed: 0 };
			tally.set(need.key, count);
			if (givenUp.has(need.key)) {
				failed++;
			} else {
				try {
					const answer = await getRate(need);
					if (typeof answer?.rate !== 'string' || !RATE.test(answer.rate))
						throw new Error('no rate');
					count.ok++;
					onRate(need.key, need.day, answer.rate);
				} catch {
					failed++;
					if (++count.failed >= 3 && !count.ok) givenUp.add(need.key);
				}
			}
			onProgress?.(++done, needs.length);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
	return { failed };
}
