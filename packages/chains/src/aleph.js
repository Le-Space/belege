// SPDX-License-Identifier: AGPL-3.0-or-later
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
// reference rate – the rule is @le-space/rates' (aleph-credits.js).
//
// Aleph is no blockchain: the credits live in Aleph's own network, keyed by
// the account's Ethereum address. `alephEntries` gives a statement's lines as
// @le-space/ledger entries (`chain: 'aleph'`): purchases and transfers in,
// transfers out, and a day's consumption per resource as `usage`. The ALEPH
// token itself is an ERC-20 on Ethereum and Base, read by the EVM reader.
//
// In a browser: Aleph's API answers with CORS headers for the origins that
// read it (checked 2026-11-06 for eigenbelege.le-space.de), so no proxy.
//
// Aleph keys accounts by their EIP-55 checksummed address: asked in lower
// case, it answers a balance of 0 and no history. Every address is
// checksummed before it is asked about.
//
// Times are UTC; the month is the UTC month. The log gets counts, never an
// address.

import { entry, multiply, normalize, sortEntries } from '@le-space/ledger';
import {
	ALEPH_LIST_PRICE_USD,
	alephCreditPrice,
	alephCreditsInEur,
	plain
} from '@le-space/rates/aleph-credits';
import { createJsonFetcher, WalletError } from './http.js';
import { toChecksumAddress } from './evm-address.js';
import { txUrl } from './explorer.js';

export const ALEPH_API = 'https://api2.aleph.im';
/** Aleph's list price, USD per credit (@le-space/rates). */
export const LIST_PRICE_USD = ALEPH_LIST_PRICE_USD;
/** Where an Aleph message (an instance, a program, a purchase) can be looked at. */
export const ALEPH_EXPLORER = 'https://explorer.aleph.cloud/address/ETH/';
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
	const priceOn = alephCreditPrice(
		purchases.map((p) => ({ time: String(p?.message_timestamp), price: p?.price }))
	);

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
			usdPerCredit: priceOn(date).usdPerCredit,
			priceSource: priceOn(date).source,
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
					// A window without rows: Aleph answers 404 in plain text (the same
					// address without the window answers 200) – an empty page, as the
					// balance's 404 is nothing there.
					const body = await getJson(
						`${base}/credit_history?page=${page}&pagination=${PER_PAGE}${query}`
					).catch((/** @type {any} */ e) => {
						if (e?.httpStatus === 404) return { credit_history: [], pagination_total: 0 };
						throw e;
					});
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
							: Math.round(Number(alephCreditsInEur(line.credits, line.usdPerCredit, rate)) * 100);
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

/** A credit amount as a decimal string. @param {number} credits */
const credits = (credits) => plain(credits);

/**
 * A statement's lines as ledger entries, seen from the account: purchases and
 * transfers in (`received`), transfers out (`sent`), and each day's
 * consumption per resource (`sent`, kind `usage`, with the USD price per
 * credit it is valued at). Asset `ALEPH-CREDIT`, no market price.
 *
 * @param {Awaited<ReturnType<ReturnType<typeof createAlephClient>['statement']>>} statement
 * @returns {import('@le-space/ledger').LedgerEntry[]}
 */
export function alephEntries(statement) {
	const { address, topUps, transfersOut, usage, resources } = statement;
	const common = {
		chain: 'aleph',
		network: 'mainnet',
		account: address,
		height: 0,
		asset: 'ALEPH-CREDIT',
		contract: 'native',
		decimals: 0,
		method: '',
		memo: '',
		success: true,
		priceAs: ''
	};
	const explorerUrl = `${ALEPH_EXPLORER}${address}`;
	const out = [
		...topUps.map((t, i) =>
			entry({
				...common,
				id: `aleph:${address}:in:${t.time}:${i}`,
				hash: t.txHash ?? '',
				time: t.time,
				type: 'received',
				kind: 'transfer',
				amount: credits(t.credits),
				counterparty: t.how === 'purchase' ? 'aleph' : t.from,
				counterpartyLabel:
					t.how === 'purchase'
						? `Aleph Cloud (Kauf${t.token ? ` mit ${t.token}` : ''}${t.chain ? ` auf ${t.chain}` : ''})`
						: '',
				explorerUrl,
				...(t.price
					? { unitPrice: { currency: 'USD', amount: plain(t.price), source: 'purchase' } }
					: {})
			})
		),
		...transfersOut.map((t, i) =>
			entry({
				...common,
				id: `aleph:${address}:out:${t.time}:${i}`,
				hash: '',
				time: t.time,
				type: 'sent',
				kind: 'transfer',
				amount: `-${credits(t.credits)}`,
				counterparty: t.to,
				counterpartyLabel: '',
				explorerUrl
			})
		),
		...usage.map((u) => {
			const what = u.resource ? resources?.[u.resource] : null;
			return entry({
				...common,
				id: `aleph:${address}:usage:${u.date}:${u.kind}:${u.resource ?? ''}`,
				hash: u.resource ?? '',
				time: `${u.date}T00:00:00Z`,
				type: 'sent',
				kind: 'usage',
				amount: `-${credits(u.credits)}`,
				counterparty: 'aleph',
				counterpartyLabel: `Aleph Cloud (${what?.name || u.kind})`,
				memo: `${u.entries} Abrechnungen`,
				explorerUrl,
				unitPrice: { currency: 'USD', amount: u.usdPerCredit, source: u.priceSource }
			});
		})
	];
	return sortEntries(out);
}

/**
 * Aleph's name for the chain a purchase was paid on → the explorer's transaction
 * link there. The same templates as the registry's `ethereum` and `base`
 * (the test checks); spelled out here so that `/aleph` bundles without the
 * registry.
 */
export const PURCHASE_EXPLORERS = /** @type {Record<string, import('./explorer.js').Explorer>} */ ({
	ETH: {
		name: 'Etherscan',
		tx: 'https://etherscan.io/tx/{tx}',
		address: 'https://etherscan.io/address/{address}'
	},
	BASE: {
		name: 'Basescan',
		tx: 'https://basescan.org/tx/{tx}',
		address: 'https://basescan.org/address/{address}'
	}
});

/**
 * The payments behind a month's credit purchases: one `sent` entry per
 * purchase, in USD (credits × the purchase's USD price per credit), of kind
 * `swap` – a token for credits; the ledger has no `purchase` kind. The token
 * amount paid is not in Aleph's data; it is checked through the paying
 * transaction's hash, whose explorer link is on the chain it was paid on
 * (Ethereum or Base), else Aleph's explorer page of the account. The credits
 * bought stay the `received` row of `alephEntries`, with the same hash, so an
 * Eigenbeleg shows both sides.
 *
 * @param {Awaited<ReturnType<ReturnType<typeof createAlephClient>['statement']>>} statement
 * @param {{ explorers?: Record<string, import('./explorer.js').Explorer> }} [o] by Aleph's chain code (`ETH`, `BASE`)
 * @returns {import('@le-space/ledger').LedgerEntry[]}
 */
export function purchaseEntries(statement, { explorers = PURCHASE_EXPLORERS } = {}) {
	const { address, topUps } = statement;
	return topUps
		.filter((t) => t.how === 'purchase' && t.price)
		.map((t, i) => {
			const explorer = t.chain ? explorers[t.chain.toUpperCase()] : undefined;
			return entry({
				id: `aleph:${address}:purchase:${t.time}:${i}`,
				chain: 'aleph',
				network: 'mainnet',
				account: address,
				hash: t.txHash ?? '',
				height: 0,
				time: t.time,
				type: 'sent',
				kind: 'swap',
				asset: 'USD',
				contract: 'native',
				decimals: 6,
				amount: `-${normalize(multiply(credits(t.credits), /** @type {string} */ (t.price), 8))}`,
				counterparty: 'aleph',
				method: '',
				counterpartyLabel: `Aleph Cloud (Kauf von ${credits(t.credits)} Credits${t.token ? ` mit ${t.token}` : ''}${t.chain ? ` auf ${t.chain}` : ''})`,
				memo: `${credits(t.credits)} Credits × ${t.price} USD`,
				success: true,
				explorerUrl:
					explorer && t.txHash ? txUrl(explorer, t.txHash) : `${ALEPH_EXPLORER}${address}`,
				priceAs: 'USD'
			});
		});
}
