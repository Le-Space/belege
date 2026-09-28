// Aleph Cloud, read only: what an account's credits did in one month – the
// source of the monthly consumption statement (issue #113). No key, no
// signing, no transfer or forget: only the public API that the official
// client (aleph-im/aleph-rs, `aleph credit history|summary`) reads too.
//
//   GET /api/v0/addresses/<a>/balance                 `credit_balance` now
//   GET /api/v0/addresses/<a>/credit_history          one row per entry, newest
//       ?page=&pagination=&startDate=&endDate=        first; filters in Unix
//                                                     seconds, inclusive
//   GET /api/v0/addresses/<a>/credit_history/summary  net, in and out of a window
//
// A row with a positive amount brings credits in: a purchase (with its
// per-credit `price` in USD, token, chain and transaction hash) or a transfer
// from another account. A negative one takes them out: `credit_expense` is
// consumption, billed about hourly per kind of resource (`origin_ref`:
// `storage`, `execution`, …) with the number of resources and their size;
// anything else is a transfer out. Storage is billed as one line for all
// stores (`origin_ref: storage`, with their number and size); compute per
// resource: `origin` is the instance's or program's item hash, `origin_ref`
// the billing message. The statement lists consumption per day, storage in
// one line and each instance in its own, named from its message
// (`/api/v0/messages/<hash>`, `content.metadata.name`).
//
// Opening and closing balance: the balance now, less what came and went
// since the month began or ended (the summary endpoint), so they are exact
// and need no history before the month.
//
// Euro value (a choice for the tax adviser, documented on the statement):
// credits are priced in USD; a day's consumption is valued at the per-credit
// price of the last purchase on or before that day, or Aleph's list price of
// 1 USD per 1,000,000 credits when the account never bought any (credits
// moved in from another account), then converted at that day's ECB
// reference rate (rates.js).
//
// Aleph keys accounts by their EIP-55 checksummed address: asked in lower
// case, it answers a balance of 0 and no history. Every address is
// checksummed before it is asked about.
//
// Times are UTC; the month is the UTC month. The log gets counts, never an
// address.

import { createJsonFetcher, WalletError } from './chains/http.js';
import { toChecksumAddress } from './chains/evm.js';

export const ALEPH_API = 'https://api2.aleph.im';
/** Aleph's list price, USD per credit. */
export const LIST_PRICE_USD = '0.000001';
const PER_PAGE = 100;

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? NaN));

/**
 * `YYYY-MM` → its first and last second, Unix, UTC.
 *
 * @param {string} month
 */
export function monthWindow(month) {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
	if (!m) throw new WalletError('month must be YYYY-MM', 'ALEPH_MONTH', 400);
	const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 1000;
	const next = Date.UTC(Number(m[1]), Number(m[2]), 1) / 1000;
	return { start, end: next - 1, next };
}

/**
 * @typedef {object} TopUp
 * @property {string} time ISO
 * @property {number} credits
 * @property {number} bonus credits given on top
 * @property {'purchase' | 'transfer'} how
 * @property {string | null} price USD per credit, a purchase's
 * @property {string | null} token
 * @property {string | null} chain
 * @property {string | null} txHash the paying transaction
 * @property {string} from for a transfer, the account it came from ('' when not said)
 */

/**
 * @typedef {object} UsageLine one day's consumption of one kind of resource
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {string} kind `storage`, or `execution` for a billed instance or program
 * @property {string | null} resource the instance's item hash, for `execution`
 * @property {number} credits
 * @property {number} entries how many billing entries (about one an hour)
 * @property {number} resources the most resources billed at once that day
 * @property {number | null} sizeMib the largest size billed that day
 * @property {string} usdPerCredit
 * @property {'purchase' | 'list'} priceSource
 * @property {string | null} eurPerUsd the ECB rate of the day
 * @property {number | null} eurCents
 */

/**
 * The rows of one month → the statement's lines. Pure.
 *
 * @param {object} p
 * @param {any[]} p.rows credit_history rows of the month
 * @param {any[]} p.purchases every incoming row with a price, any time
 */
export function summarise({ rows, purchases }) {
	/** @type {TopUp[]} */
	const topUps = [];
	/** @type {{ time: string, credits: number, to: string }[]} */
	const transfersOut = [];
	/** @type {Map<string, UsageLine>} */
	const days = new Map();
	const priced = purchases
		.filter((p) => p?.price && Number(p.price) > 0)
		.map((p) => ({ time: String(p.message_timestamp), price: String(p.price) }))
		.sort((a, b) => (a.time < b.time ? -1 : 1));
	/** The per-credit price in force at the end of a day. @param {string} date */
	const priceOn = (date) => {
		let found = null;
		for (const p of priced) if (p.time.slice(0, 10) <= date) found = p.price;
		return found;
	};

	for (const r of rows) {
		const amount = num(r?.amount);
		const time = new Date(String(r?.message_timestamp)).toISOString();
		if (!Number.isFinite(amount) || amount === 0) continue;
		if (amount > 0) {
			const purchase = Boolean(r.price || r.tx_hash);
			topUps.push({
				time,
				credits: amount,
				bonus: num(r.bonus_amount) || 0,
				how: purchase ? 'purchase' : 'transfer',
				price: r.price ? String(r.price) : null,
				token: r.token ? String(r.token) : null,
				chain: r.chain ? String(r.chain) : null,
				txHash: r.tx_hash ? String(r.tx_hash) : null,
				from: purchase ? '' : String(r.origin ?? '')
			});
			continue;
		}
		if (r.payment_method !== 'credit_expense') {
			transfersOut.push({ time, credits: -amount, to: String(r.origin ?? '') });
			continue;
		}
		const date = time.slice(0, 10);
		const resource = /^[0-9a-f]{64}$/.test(String(r.origin ?? '')) ? String(r.origin) : null;
		const kind = resource ? 'execution' : String(r.origin_ref || 'other');
		const key = `${date} ${kind} ${resource ?? ''}`;
		const size = num(r.expense_size_mib);
		const line = days.get(key) ?? {
			date,
			kind,
			resource,
			credits: 0,
			entries: 0,
			resources: 0,
			sizeMib: null,
			usdPerCredit: priceOn(date) ?? LIST_PRICE_USD,
			priceSource: priceOn(date)
				? /** @type {const} */ ('purchase')
				: /** @type {const} */ ('list'),
			eurPerUsd: null,
			eurCents: null
		};
		line.credits += -amount;
		line.entries += 1;
		line.resources = Math.max(line.resources, num(r.expense_count) || 0);
		if (Number.isFinite(size)) line.sizeMib = Math.max(line.sizeMib ?? 0, size);
		days.set(key, line);
	}
	const usage = [...days.values()].sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			a.kind.localeCompare(b.kind) ||
			String(a.resource).localeCompare(String(b.resource))
	);
	topUps.sort((a, b) => a.time.localeCompare(b.time));
	transfersOut.sort((a, b) => a.time.localeCompare(b.time));
	return { topUps, transfersOut, usage };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.maxPages]
 * @param {{ rate: (asset: string, date: string) => Promise<{ rate: string, source: string }> } | null} [options.rates]
 * @param {() => Date} [options.now]
 */
export function createAlephClient({
	fetch: f = fetch,
	timeoutMs = 30_000,
	sleep,
	maxPages = 200,
	rates = null,
	now = () => new Date()
} = {}) {
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep });

	return {
		/**
		 * Which of these addresses are Aleph accounts: each one's credits now and
		 * how many credit entries it ever had. Read only; one balance and one
		 * summary request per address.
		 *
		 * @param {object} p
		 * @param {string[]} p.addresses 0x…, at most 50
		 * @param {string} [p.api] checked by the caller
		 */
		async accounts({ addresses, api = ALEPH_API }) {
			const unique = [...new Set(addresses.map((a) => String(a).toLowerCase()))];
			if (unique.length > 50) throw new WalletError('at most 50 addresses', 'ALEPH_TOO_MANY', 400);
			/** @type {{ address: string, credits: number, entries: number }[]} */
			const out = [];
			for (const lower of unique) {
				if (!/^0x[0-9a-f]{40}$/.test(lower)) {
					throw new WalletError('not an Aleph account address (0x + 40 hex)', 'ALEPH_ADDRESS', 400);
				}
				const address = toChecksumAddress(lower);
				const base = `${api}/api/v0/addresses/${address}`;
				const balance = await getJson(`${base}/balance`).catch((/** @type {any} */ e) => {
					// An address Aleph has never seen: 404, nothing there.
					if (e?.httpStatus === 404) return { credit_balance: 0 };
					throw e;
				});
				const summary = await getJson(`${base}/credit_history/summary`);
				out.push({
					address,
					credits: num(balance?.credit_balance) || 0,
					entries: num(summary?.entry_count) || 0
				});
			}
			return out;
		},

		/**
		 * @param {object} p
		 * @param {string} p.address 0x…
		 * @param {string} p.month YYYY-MM
		 * @param {string} [p.api] checked by the caller
		 */
		async statement({ address: given, month, api = ALEPH_API }) {
			if (!/^0x[0-9a-fA-F]{40}$/.test(given)) {
				throw new WalletError('not an Aleph account address (0x + 40 hex)', 'ALEPH_ADDRESS', 400);
			}
			const address = toChecksumAddress(given);
			const { start, end, next } = monthWindow(month);
			const nowSeconds = Math.floor(now().getTime() / 1000);
			if (start > nowSeconds) throw new WalletError('that month has not begun', 'ALEPH_MONTH', 400);
			const base = `${api}/api/v0/addresses/${address}`;

			const balance = await getJson(`${base}/balance`);
			const current = num(balance?.credit_balance);
			if (!Number.isFinite(current)) {
				throw new WalletError('Aleph answered the balance without credits', 'ALEPH_DATA');
			}
			/** What came and went from a moment on. @param {number} from */
			const netSince = async (from) => {
				if (from > nowSeconds) return 0;
				const s = await getJson(`${base}/credit_history/summary?startDate=${from}`);
				const net = num(s?.total_amount);
				if (!Number.isFinite(net)) {
					throw new WalletError('Aleph answered the summary without a total', 'ALEPH_DATA');
				}
				return net;
			};
			const opening = current - (await netSince(start));
			const closing = current - (await netSince(next));

			/** @param {string} query */
			const pages = async (query) => {
				/** @type {any[]} */
				const rows = [];
				for (let page = 1; ; page++) {
					if (page > maxPages) {
						throw new WalletError(
							`more than ${maxPages * PER_PAGE} credit entries; not read`,
							'ALEPH_TOO_MANY'
						);
					}
					const body = await getJson(
						`${base}/credit_history?page=${page}&pagination=${PER_PAGE}${query}`
					);
					const batch = Array.isArray(body?.credit_history) ? body.credit_history : null;
					if (!batch) throw new WalletError('Aleph answered without a history', 'ALEPH_DATA');
					rows.push(...batch);
					if (!batch.length || page * PER_PAGE >= num(body.pagination_total)) break;
				}
				return rows;
			};
			const rows = await pages(`&startDate=${start}&endDate=${end}`);
			// Prices of every purchase up to the month's end, to value its consumption.
			const purchases = (await pages(`&endDate=${end}&direction=incoming`)).filter((r) => r?.price);
			const { topUps, transfersOut, usage } = summarise({ rows, purchases });

			// What each billed resource is: its type and the name it was given.
			/** @type {Record<string, { type: string, name: string }>} */
			const resources = {};
			for (const hash of new Set(usage.map((u) => u.resource).filter((h) => h !== null))) {
				if (Object.keys(resources).length >= 50) break;
				const body = await getJson(`${api}/api/v0/messages/${hash}`).catch(() => null);
				const message = body?.message ?? body;
				resources[/** @type {string} */ (hash)] = {
					type: String(message?.type ?? ''),
					name: String(message?.content?.metadata?.name ?? '').slice(0, 80)
				};
			}

			/** @type {Map<string, string | null>} */
			const eurPerUsd = new Map();
			let rateSource = null;
			if (rates) {
				for (const line of usage) {
					if (!eurPerUsd.has(line.date)) {
						const r = await rates.rate('USD', line.date).catch(() => null);
						eurPerUsd.set(line.date, r?.rate ?? null);
						rateSource ??= r?.source ?? null;
					}
					const rate = eurPerUsd.get(line.date) ?? null;
					line.eurPerUsd = rate;
					line.eurCents =
						rate === null
							? null
							: Math.round(line.credits * Number(line.usdPerCredit) * Number(rate) * 100);
				}
			}

			const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);
			const totals = {
				topUps: sum(topUps.map((t) => t.credits)),
				transfersOut: sum(transfersOut.map((t) => t.credits)),
				usage: sum(usage.map((u) => u.credits)),
				eurCents: usage.every((u) => u.eurCents !== null)
					? sum(usage.map((u) => /** @type {number} */ (u.eurCents)))
					: null
			};
			return {
				address,
				month,
				from: new Date(start * 1000).toISOString(),
				until: new Date(end * 1000).toISOString(),
				opening,
				closing,
				topUps,
				transfersOut,
				usage,
				resources,
				totals,
				// opening + in − out = closing; a difference means entries the history did not list
				difference: opening + totals.topUps - totals.usage - totals.transfersOut - closing,
				rateSource,
				entries: rows.length
			};
		}
	};
}
