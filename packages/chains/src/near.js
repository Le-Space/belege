// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads what an own NEAR account paid and received in a period, from the
// NearBlocks API (v3), and maps it to ledger entries (@eigenbeleg/ledger-core).
//
//   /v3/accounts/<id>/txns     transactions the account signed or received:
//                              native NEAR sent or received, and the gas fee of
//                              every transaction the account signed
//   /v3/accounts/<id>/ft-txns  NEP-141 token movements (USDC, USDT, …), exact
//                              per event
//
// Every amount NearBlocks gives here is an integer string in base units, so
// nothing passes through a float. What is not read yet (and said so in the
// README): NEAR that reaches the account inside another transaction's inner
// receipts – a staking pool paying out a withdrawal, say.
//
// Powered by NearBlocks.io APIs.
//
// Moved from Le-Space/eigenbeleg-agent packages/chain-near at e56769a
// (Le-Space/eigenbeleg-agent#6). Changed here: the endpoints can be handed in
// (`endpoints: { api, rpc, explorer }`, e.g. behind a proxy), and the
// pipeline's `block` descriptor stays in Eigenbeleg.

import { entry, fromUnits, fromUtf8, sortEntries, toBase64, toUnits, utf8 } from '@le-space/ledger';

export const NETWORKS = {
	mainnet: {
		api: 'https://api.nearblocks.io',
		explorer: 'https://nearblocks.io/txns/',
		rpc: 'https://archival-rpc.mainnet.fastnear.com'
	},
	testnet: {
		api: 'https://api-testnet.nearblocks.io',
		explorer: 'https://testnet.nearblocks.io/txns/',
		rpc: 'https://archival-rpc.testnet.fastnear.com'
	}
};

export const NEAR_DECIMALS = 24;
/** Who receives a NEAR fee: the protocol burns it; no one issues an invoice. */
export const NETWORK_COUNTERPARTY = { address: 'near', label: 'NEAR-Netzwerk' };

/**
 * The network's endpoints, with the caller's own in place of any.
 *
 * @param {string} network
 * @param {Partial<{ api: string, rpc: string, explorer: string }>} [own]
 */
export function endpointsOf(network, own = {}) {
	const net = NETWORKS[/** @type {keyof typeof NETWORKS} */ (network)];
	if (!net) throw new Error(`unknown network ${network}`);
	return { ...net, ...own };
}

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A NEAR account id (named or 64-hex implicit). @param {string} id */
export function isAccountId(id) {
	return typeof id === 'string' && ACCOUNT_ID.test(id);
}

/**
 * Tokens with a trusted market price, by contract. Anything else an account
 * holds is listed in the CSV but never valued: airdropped spam tokens are
 * common on NEAR.
 */
export const TOKENS = {
	mainnet: {
		'17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
			symbol: 'USDC',
			priceAs: 'USDC',
			decimals: 6
		},
		'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near': {
			symbol: 'USDC.e',
			priceAs: 'USDC',
			decimals: 6
		},
		'usdt.tether-token.near': { symbol: 'USDT', priceAs: 'USDT', decimals: 6 },
		'wrap.near': { symbol: 'wNEAR', priceAs: 'NEAR', decimals: 24 }
	},
	testnet: {
		'3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af': {
			symbol: 'USDC',
			priceAs: 'USDC',
			decimals: 6
		},
		'usdc.fakes.testnet': { symbol: 'USDC.e', priceAs: 'USDC', decimals: 6 },
		'wrap.testnet': { symbol: 'wNEAR', priceAs: 'NEAR', decimals: 24 }
	}
};

/** Methods whose attached NEAR is not a payment for something but a token or storage mechanic. */
const FT_METHODS = new Set([
	'ft_transfer',
	'ft_transfer_call',
	'mt_transfer',
	'mt_transfer_call',
	'nft_transfer',
	'nft_transfer_call'
]);
const STORAGE_METHODS = new Set(['storage_deposit']);
const STAKE_METHODS = new Set(['deposit_and_stake', 'deposit', 'stake']);

/** ISO date → nanosecond timestamp string. @param {string} iso */
const ns = (iso) => (BigInt(new Date(iso).getTime()) * 1_000_000n).toString();
/** nanosecond string → ISO. @param {string} t */
const iso = (t) => new Date(Number(BigInt(t) / 1_000_000n)).toISOString();

/**
 * Walks a NearBlocks v3 list newest first, from just before `to` back to `from`.
 *
 * @param {object} p
 * @param {string} p.url without query
 * @param {string} p.fromTs ns, inclusive
 * @param {string} p.toTs ns, exclusive
 * @param {typeof fetch} p.fetch
 * @param {Record<string,string>} p.headers
 * @param {number} p.maxPages
 * @param {boolean} [p.partial] stop at maxPages instead of failing (fixtures only)
 */
async function walk({ url, fromTs, toTs, fetch, headers, maxPages, partial = false }) {
	/** @type {any[]} */
	const rows = [];
	let next = '';
	for (let page = 0; page < maxPages; page++) {
		const q = new URLSearchParams({ limit: '25', before_ts: toTs });
		if (next) q.set('next', next);
		const body = await getJson(fetch, `${url}?${q}`, headers);
		const data = Array.isArray(body?.data) ? body.data : [];
		let older = false;
		for (const row of data) {
			const t = String(row.block_timestamp ?? row.block?.block_timestamp ?? '0');
			if (BigInt(t) < BigInt(fromTs)) {
				older = true;
				break;
			}
			rows.push(row);
		}
		next = body?.meta?.next_page ?? '';
		if (older || !next || data.length === 0) return rows;
	}
	if (partial) return rows;
	throw new Error(`more than ${maxPages} pages of history in the period; narrow it`);
}

/** @param {typeof fetch} fetch @param {string} url @param {Record<string,string>} headers */
async function getJson(fetch, url, headers) {
	for (let attempt = 0; ; attempt++) {
		/** @type {Response} */
		let res;
		try {
			res = await fetch(url, { headers });
		} catch (e) {
			// In a browser a 429 without CORS headers, or a dropped connection, is a TypeError.
			if (!(e instanceof TypeError) || attempt >= 4) throw e;
			await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
			continue;
		}
		if ((res.status === 429 || res.status >= 500) && attempt < 4) {
			await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
			continue;
		}
		if (!res.ok) throw new Error(`NearBlocks answered ${res.status} for ${new URL(url).pathname}`);
		return res.json();
	}
}

/**
 * The raw NearBlocks rows for an account and period, as a fixture keeps them.
 *
 * @param {object} p
 * @param {string} p.account
 * @param {'mainnet' | 'testnet'} [p.network]
 * @param {string} p.from YYYY-MM-DD, inclusive
 * @param {string} p.to YYYY-MM-DD, inclusive
 * @param {typeof fetch} [p.fetch]
 * @param {string} [p.apiKey] a NearBlocks key, for its higher rate limit
 * @param {number} [p.maxPages]
 * @param {boolean} [p.partial]
 * @param {Partial<{ api: string, rpc: string, explorer: string }>} [p.endpoints] instead of the network's own
 */
export async function fetchRaw({
	account,
	network = 'mainnet',
	from,
	to,
	fetch = globalThis.fetch,
	apiKey,
	maxPages = 40,
	partial = false,
	endpoints
}) {
	if (!isAccountId(account)) throw new Error('not a NEAR account id');
	const net = endpointsOf(network, endpoints);
	const fromTs = ns(`${from}T00:00:00Z`);
	const end = new Date(`${to}T00:00:00Z`);
	end.setUTCDate(end.getUTCDate() + 1);
	const toTs = ns(end.toISOString());
	/** @type {Record<string,string>} */
	const headers = { accept: 'application/json' };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const base = `${net.api}/v3/accounts/${encodeURIComponent(account)}`;
	const txns = await walk({ url: `${base}/txns`, fromTs, toTs, fetch, headers, maxPages, partial });
	const ftTxns = await walk({
		url: `${base}/ft-txns`,
		fromTs,
		toTs,
		fetch,
		headers,
		maxPages,
		partial
	});
	return { account, network, from, to, txns, ftTxns, explorer: net.explorer };
}

/**
 * Ledger entries from the raw rows.
 *
 * @param {{ account: string, network: 'mainnet' | 'testnet', txns: any[], ftTxns: any[], explorer?: string }} raw
 * @returns {import('@le-space/ledger').LedgerEntry[]}
 */
export function mapRaw({
	account,
	network,
	txns,
	ftTxns,
	explorer = endpointsOf(network).explorer
}) {
	/** @type {import('@le-space/ledger').LedgerEntry[]} */
	const out = [];
	const seen = new Set();
	for (const t of txns) {
		const hash = String(t.transaction_hash);
		if (seen.has(hash)) continue;
		seen.add(hash);
		const time = iso(String(t.block_timestamp ?? t.block?.block_timestamp));
		const height = Number(t.block?.block_height ?? 0);
		const success = t.outcomes?.status !== false;
		const signer = String(t.signer_account_id ?? '');
		const receiver = String(t.receiver_account_id ?? '');
		const deposit = BigInt(String(t.actions_agg?.deposit ?? '0'));
		const actions = Array.isArray(t.actions) ? t.actions : [];
		const methods = actions.map((/** @type {any} */ a) => a.method).filter(Boolean);
		const method = methods[0] ?? '';
		const common = {
			chain: 'near',
			network,
			account,
			hash,
			height,
			time,
			contract: 'native',
			asset: 'NEAR',
			priceAs: 'NEAR',
			decimals: NEAR_DECIMALS,
			explorerUrl: explorer + hash
		};

		if (signer === account) {
			const fee = BigInt(String(t.outcomes_agg?.transaction_fee ?? '0'));
			if (fee > 0n)
				out.push(
					entry({
						...common,
						id: `near:${account}:${hash}:fee`,
						type: 'fee',
						kind: 'fee',
						amount: fromUnits(-fee, NEAR_DECIMALS),
						counterparty: NETWORK_COUNTERPARTY.address,
						counterpartyLabel: NETWORK_COUNTERPARTY.label,
						method,
						memo: '',
						// A failed transaction still burns its gas.
						success: true
					})
				);
			// A failed transaction gives its deposit back; the 1 yoctoNEAR a token
			// transfer must attach is no payment.
			const tokenMechanic =
				deposit === 1n && methods.some((/** @type {string} */ m) => FT_METHODS.has(m));
			if (deposit > 0n && success && receiver !== account && !tokenMechanic) {
				out.push(
					entry({
						...common,
						id: `near:${account}:${hash}:deposit`,
						type: 'sent',
						kind: kindOf(actions, methods),
						amount: fromUnits(-deposit, NEAR_DECIMALS),
						counterparty: receiver,
						counterpartyLabel: '',
						method,
						memo: '',
						success
					})
				);
			}
		} else if (receiver === account && deposit > 1n && success) {
			// 1 yoctoNEAR is a token transfer's security deposit passing through
			// (a relayed meta transaction hands it on to the token contract), no payment.
			out.push(
				entry({
					...common,
					id: `near:${account}:${hash}:deposit`,
					type: 'received',
					kind: 'transfer',
					amount: fromUnits(deposit, NEAR_DECIMALS),
					counterparty: signer,
					counterpartyLabel: '',
					method,
					memo: '',
					success
				})
			);
		}
	}
	for (const f of ftTxns) {
		if (String(f.affected_account_id) !== account) continue;
		const delta = BigInt(String(f.delta_amount ?? '0'));
		if (delta === 0n) continue;
		const hash = String(f.transaction_hash);
		const meta = f.meta ?? f.ft ?? {};
		const contract = String(f.contract_account_id ?? meta.contract ?? '');
		const listed =
			/** @type {Record<string, {symbol: string, priceAs: string, decimals: number}>} */ (
				TOKENS[network]
			)[contract];
		// A listed token's decimals are ours; an unlisted one's come from the
		// indexer and, where it has none, the token is skipped: a wrong scale
		// would turn 1.5 into 1,500,000.
		const decimals = listed?.decimals ?? (Number.isInteger(meta.decimals) ? meta.decimals : NaN);
		if (!Number.isInteger(decimals)) continue;
		out.push(
			entry({
				id: `near:${account}:${hash}:ft:${f.receipt_id ?? ''}:${f.event_index ?? ''}`,
				chain: 'near',
				network,
				account,
				hash,
				height: Number(f.block?.block_height ?? 0),
				time: iso(String(f.block_timestamp ?? f.block?.block_timestamp)),
				type: delta < 0n ? 'sent' : 'received',
				kind: 'transfer',
				asset: listed?.symbol ?? String(meta.symbol ?? contract),
				priceAs: listed?.priceAs ?? '',
				contract,
				decimals,
				amount: fromUnits(delta, decimals),
				counterparty: String(f.involved_account_id ?? ''),
				counterpartyLabel: '',
				method: String(f.cause ?? '').toLowerCase(),
				memo: '',
				success: f.outcomes?.status !== false,
				explorerUrl: explorer + hash
			})
		);
	}
	return sortEntries(out);
}

/** @param {any[]} actions @param {string[]} methods */
function kindOf(actions, methods) {
	if (methods.some((m) => STORAGE_METHODS.has(m))) return 'storage';
	if (methods.some((m) => STAKE_METHODS.has(m))) return 'stake';
	if (actions.some((a) => a.action === 'FUNCTION_CALL')) return 'call';
	return 'transfer';
}

/**
 * Ledger entries for an account and period.
 *
 * @param {Parameters<typeof fetchRaw>[0]} p
 */
export async function readNear(p) {
	return storageKept(mapRaw(await fetchRaw(p)), p);
}

/**
 * A storage deposit attaches more than the contract keeps, or the account
 * was registered already: the contract sends the rest back in an inner
 * receipt. The entry becomes what was kept; one fully refunded goes.
 * Read from an archival RPC (EXPERIMENTAL_tx_status); if that cannot be
 * read, the whole read fails rather than overstate a payment.
 *
 * @param {import('@le-space/ledger').LedgerEntry[]} entries
 * @param {{ network?: 'mainnet' | 'testnet', fetch?: typeof fetch, endpoints?: Partial<{ rpc: string }> }} p
 */
export async function storageKept(
	entries,
	{ network = 'mainnet', fetch = globalThis.fetch, endpoints }
) {
	const out = [];
	for (const e of entries) {
		if (e.kind !== 'storage' || e.type !== 'sent') {
			out.push(e);
			continue;
		}
		const res = await fetch(endpointsOf(network, endpoints).rpc, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'EXPERIMENTAL_tx_status',
				params: { tx_hash: e.hash, sender_account_id: e.account, wait_until: 'NONE' }
			})
		});
		const body = res.ok ? await res.json() : null;
		const receipts = body?.result?.receipts;
		if (!Array.isArray(receipts))
			throw new Error(`NEAR RPC could not tell what the storage deposit in ${e.hash} kept`);
		let refund = 0n;
		for (const r of receipts) {
			if (r.predecessor_id !== e.counterparty || r.receiver_id !== e.account) continue;
			for (const a of r.receipt?.Action?.actions ?? [])
				if (a?.Transfer?.deposit) refund += BigInt(a.Transfer.deposit);
		}
		const kept = -toUnits(e.amount, NEAR_DECIMALS) - refund;
		if (kept <= 0n) continue;
		out.push(refund ? entry({ ...e, amount: fromUnits(-kept, NEAR_DECIMALS) }) : e);
	}
	return out;
}

/** @param {typeof fetch} fetch @param {string} url @param {string} method @param {any} params */
async function rpc(fetch, url, method, params, { tries = 4, wait = 1000 } = {}) {
	/** @type {Response | null} */
	let res = null;
	// A rate limit (429) or a hiccup (5xx) is asked again, a little later each time. In a
	// browser such an answer often comes without CORS headers and so shows up as a failed
	// fetch (TypeError); that is retried the same way.
	for (let attempt = 0; ; attempt++) {
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
			});
			if ((res.status === 429 || res.status >= 500) && attempt < tries) {
				await new Promise((r) => setTimeout(r, wait * 2 ** attempt));
				continue;
			}
			break;
		} catch (e) {
			if (!(e instanceof TypeError) || attempt >= tries) throw e;
			await new Promise((r) => setTimeout(r, wait * 2 ** attempt));
		}
	}
	const body = res.ok ? await res.json() : null;
	if (!body || body.error) {
		const e = new Error(
			`NEAR RPC ${method}: ${String(body?.error?.cause?.name ?? body?.error?.message ?? res.status)}`
		);
		/** @type {any} */ (e).cause = body?.error?.cause?.name;
		throw e;
	}
	return body.result;
}

/**
 * The last block before a moment (archival RPC): interpolated from block
 * times, then stepped to the exact one. Heights without a block are skipped.
 *
 * @param {{ network?: 'mainnet' | 'testnet', before: string, fetch?: typeof fetch, endpoints?: Partial<{ rpc: string }> }} p before: ISO
 * @returns {Promise<{ height: number, time: string }>}
 */
export async function blockBefore({
	network = 'mainnet',
	before,
	fetch = globalThis.fetch,
	endpoints
}) {
	const url = endpointsOf(network, endpoints).rpc;
	const target = BigInt(Date.parse(before)) * 1_000_000n;
	/** @type {Map<number, bigint | null>} */
	const seen = new Map();
	const ts = async (/** @type {number} */ h) => {
		if (!seen.has(h)) {
			try {
				seen.set(h, BigInt((await rpc(fetch, url, 'block', { block_id: h })).header.timestamp));
			} catch (e) {
				if (/** @type {any} */ (e).cause !== 'UNKNOWN_BLOCK') throw e;
				seen.set(h, null);
			}
		}
		return seen.get(h) ?? null;
	};
	/** The nearest existing block at or below h. */
	const at = async (/** @type {number} */ h) => {
		for (let i = 0; i < 50; i++) {
			const t = await ts(h - i);
			if (t !== null) return { h: h - i, t };
		}
		throw new Error(`no block near height ${h}`);
	};
	const head = (await rpc(fetch, url, 'block', { finality: 'final' })).header;
	let hi = { h: Number(head.height), t: BigInt(head.timestamp) };
	if (target >= hi.t) throw new Error('the moment has not passed on chain yet');
	let lo = await at(Math.max(1, hi.h - 200_000));
	// widen until lo is before the target
	while (lo.t >= target) {
		const span = hi.h - lo.h;
		hi = lo;
		lo = await at(Math.max(1, lo.h - span * 4));
		if (lo.h <= 1 && lo.t >= target) throw new Error('the moment is before the chain began');
	}
	// interpolation search, then bisection
	for (let i = 0; i < 60 && hi.h - lo.h > 1; i++) {
		const guess =
			i < 8
				? lo.h + Number(((target - lo.t) * BigInt(hi.h - lo.h)) / (hi.t - lo.t))
				: Math.floor((lo.h + hi.h) / 2);
		const mid = await at(Math.min(hi.h - 1, Math.max(lo.h + 1, guess)));
		if (mid.h <= lo.h) break;
		if (mid.t < target) lo = mid;
		else hi = mid;
	}
	return { height: lo.h, time: new Date(Number(lo.t / 1_000_000n)).toISOString() };
}

/**
 * What an account held just before a moment: NEAR (liquid plus staked by a
 * validator) and the listed tokens asked for. From the archival RPC.
 *
 * @param {{ account: string, network?: 'mainnet' | 'testnet', before: string, contracts?: string[], fetch?: typeof fetch, endpoints?: Partial<{ rpc: string }> }} p
 * @returns {Promise<{ height: number, time: string, balances: Record<string, { asset: string, amount: string }> }>}
 */
export async function balancesBefore({
	account,
	network = 'mainnet',
	before,
	contracts = [],
	fetch = globalThis.fetch,
	endpoints
}) {
	if (!isAccountId(account)) throw new Error('not a NEAR account id');
	const url = endpointsOf(network, endpoints).rpc;
	const block = await blockBefore({ network, before, fetch, endpoints });
	/** @type {Record<string, { asset: string, amount: string }>} */
	const balances = {};
	try {
		const a = await rpc(fetch, url, 'query', {
			request_type: 'view_account',
			block_id: block.height,
			account_id: account
		});
		balances.native = {
			asset: 'NEAR',
			amount: fromUnits(BigInt(a.amount) + BigInt(a.locked ?? '0'), NEAR_DECIMALS)
		};
	} catch (e) {
		// The account did not exist yet.
		if (!/UNKNOWN_ACCOUNT/.test(String(/** @type {any} */ (e).cause))) throw e;
		balances.native = { asset: 'NEAR', amount: '0' };
	}
	const listed = /** @type {Record<string, { symbol: string, decimals: number }>} */ (
		TOKENS[network]
	);
	for (const c of contracts) {
		const t = listed[c];
		if (!t) continue;
		let units = 0n;
		try {
			const r = await rpc(fetch, url, 'query', {
				request_type: 'call_function',
				block_id: block.height,
				account_id: c,
				method_name: 'ft_balance_of',
				args_base64: toBase64(utf8(JSON.stringify({ account_id: account })))
			});
			units = BigInt(JSON.parse(fromUtf8(Uint8Array.from(r.result))));
		} catch {
			units = 0n; // not registered with the token yet
		}
		balances[c] = { asset: t.symbol, amount: fromUnits(units, t.decimals) };
	}
	return { ...block, balances };
}

/** `{ native: { asset: 'NEAR', amount } … }` → `{ NEAR: amount … }`. @param {Record<string, { asset: string, amount: string }>} b */
const bySymbol = (b) => Object.fromEntries(Object.values(b).map((x) => [x.asset, x.amount]));

/**
 * What a Kontoauszug needs for one account and period: its bookings, and its
 * balances before the first and after the last day, read from the archival
 * RPC – so the statement can check that opening balance plus bookings is the
 * closing balance.
 *
 * @param {Parameters<typeof fetchRaw>[0]} p
 */
export async function statementNear(p) {
	const network = p.network ?? 'mainnet';
	const fetch = p.fetch ?? globalThis.fetch;
	const entries = await readNear(p);
	const contracts = [
		...new Set(entries.filter((e) => e.contract !== 'native' && e.priceAs).map((e) => e.contract))
	];
	const end = new Date(`${p.to}T00:00:00Z`);
	end.setUTCDate(end.getUTCDate() + 1);
	const opening = await balancesBefore({
		account: p.account,
		network,
		before: `${p.from}T00:00:00Z`,
		contracts,
		fetch,
		endpoints: p.endpoints
	});
	const closing = await balancesBefore({
		account: p.account,
		network,
		before: end.toISOString(),
		contracts,
		fetch,
		endpoints: p.endpoints
	});
	return {
		entries,
		opening: bySymbol(opening.balances),
		closing: bySymbol(closing.balances),
		method: /** @type {'archive'} */ ('archive'),
		at: {
			opening: { height: opening.height, time: opening.time },
			closing: { height: closing.height, time: closing.time }
		}
	};
}

/** A public account that signs transactions every day (Aurora's relayer, fees only): the live check reads it. */
export const PROBE_ACCOUNT = 'relay.aurora';

/**
 * Checks the block against live data: one page of yesterday's history of a
 * busy public account must map to valid entries.
 *
 * @param {{ fetch?: typeof fetch, apiKey?: string, day?: string }} [o] day: YYYY-MM-DD, yesterday when not given
 */
export async function probe({
	fetch = globalThis.fetch,
	apiKey,
	day = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
} = {}) {
	const raw = await fetchRaw({
		account: PROBE_ACCOUNT,
		network: 'mainnet',
		from: day,
		to: day,
		fetch,
		apiKey,
		maxPages: 1,
		partial: true
	});
	const entries = mapRaw(raw);
	if (entries.length === 0)
		throw new Error(`no entries for ${PROBE_ACCOUNT} on ${day}: the data source may have changed`);
	return { sample: `${PROBE_ACCOUNT} on ${day}`, entries: entries.length };
}
