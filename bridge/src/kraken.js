// Kraken, read only: the balances and the ledger of one Kraken account.
//
// The API key lives in the macOS keychain (service `belege-bridge`, account
// `kraken`), as JSON `{ key, secret }`, put there by `pnpm setup:kraken`. It
// needs the permissions "Query Funds" and "Query Ledger Entries", nothing else:
// Belege never trades, withdraws or deposits.
//
// The ledger is the one source: every trade, deposit, withdrawal, fee and
// staking reward is a ledger entry. Kraken hands it out newest first, 50
// entries a page, paged with `ofs` (not a cursor). The private endpoints
// share a rate counter; ledger pages are fetched one after the other with a
// pause, and a "Rate limit exceeded" waits and retries.
//
// A deposit or withdrawal also gets its transfer reference: the txid Kraken
// reports in DepositStatus / WithdrawStatus under the same refid – the
// on-chain transaction hash for crypto, the bank's reference for euros. That
// lets the app pair a withdrawal with the wallet that received it. If the key
// may not read those lists (Funds → Query), entries have none, and the
// ledger says so (`transferRefs: 'refused'`, with Kraken's error code).
//
// What leaves this module is normalised: Kraken's asset codes (`XXBT`,
// `ZEUR`, `DOT.S`) become a symbol (`BTC`, `EUR`, `DOT`) and a wallet
// (`spot`, or `earn` for staked and earning balances); amounts stay decimal
// strings with the asset's decimals, as Kraken sends them.

import { createHash, createHmac } from 'node:crypto';

/** Kraken's names for assets that have a common symbol. */
const ALIASES = /** @type {Record<string, string>} */ ({ XBT: 'BTC', XDG: 'DOGE', ETH2: 'ETH' });
/** Suffixes of balances that are staked or earning, not spot. */
const EARN_SUFFIX = /^(.+?)\.(S|M|B|F|P|HOLD)$/;

export class KrakenError extends Error {
	/** @param {string} message @param {string} code @param {number} [status] */
	constructor(message, code, status = 502) {
		super(message);
		this.name = 'KrakenError';
		this.code = code;
		this.status = status;
	}
}

/**
 * The keychain entry → `{ key, secret }`. Checks the shape, never prints the values.
 *
 * @param {string} stored JSON, as setup:kraken writes it
 */
export function parseKrakenCredentials(stored) {
	/** @type {any} */ let value;
	try {
		value = JSON.parse(stored);
	} catch {
		value = null;
	}
	const key = typeof value?.key === 'string' ? value.key.trim() : '';
	const secret = typeof value?.secret === 'string' ? value.secret.trim() : '';
	if (!key || !isKrakenSecret(secret)) {
		throw new KrakenError(
			'The Kraken key in the keychain is unusable; run pnpm setup:kraken',
			'KRAKEN_AUTH',
			503
		);
	}
	return { key, secret };
}

/** A Kraken private key: base64 of 64 bytes. @param {string} secret */
export function isKrakenSecret(secret) {
	return /^[A-Za-z0-9+/]+={0,2}$/.test(secret) && Buffer.from(secret, 'base64').length === 64;
}

/**
 * @typedef {object} KrakenAssetInfo
 * @property {string} altname
 * @property {number} decimals
 */

/**
 * `XXBT` → BTC/spot, `DOT.S` → DOT/earn, `ETH2.S` → ETH/earn, `ZEUR` → EUR/spot.
 *
 * @param {string} code as in a ledger entry or a balance
 * @param {Record<string, KrakenAssetInfo>} assets from /0/public/Assets
 * @returns {{ symbol: string, wallet: 'spot' | 'earn', decimals: number }}
 */
export function parseAsset(code, assets) {
	const suffix = EARN_SUFFIX.exec(code);
	const base = suffix ? suffix[1] : code;
	const info = assets[code] ?? assets[base];
	let name = assets[base]?.altname ?? base;
	if (!assets[base] && /^[XZ][A-Z]{3}$/.test(base)) name = base.slice(1);
	const symbol = ALIASES[name] ?? name;
	return {
		symbol,
		wallet: suffix || name === 'ETH2' ? 'earn' : 'spot',
		decimals: Number.isInteger(info?.decimals) ? info.decimals : 10
	};
}

/** Seconds since the epoch (Kraken, with fractions) → ISO 8601. @param {unknown} seconds */
const isoTime = (seconds) => new Date(Math.round(Number(seconds) * 1000)).toISOString();

/**
 * @typedef {object} LedgerEntry
 * @property {string} id the ledger id, unique
 * @property {string} refid shared by the entries of one trade or transfer
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {string} type deposit, withdrawal, trade, spend, receive, transfer, staking, earn, …
 * @property {string} subtype
 * @property {string} asset symbol
 * @property {'spot' | 'earn'} wallet
 * @property {string} amount signed decimal, before the fee
 * @property {string} fee decimal, charged on top (the balance moves by amount − fee)
 * @property {number} decimals
 * @property {string} transferRef the txid of a deposit or withdrawal, '' when none
 */

/**
 * @param {string} id
 * @param {any} raw
 * @param {Record<string, KrakenAssetInfo>} assets
 * @returns {LedgerEntry}
 */
export function normalizeLedgerEntry(id, raw, assets) {
	const { symbol, wallet, decimals } = parseAsset(String(raw.asset ?? ''), assets);
	const time = isoTime(raw.time);
	return {
		id,
		refid: String(raw.refid ?? ''),
		time,
		date: time.slice(0, 10),
		type: String(raw.type ?? ''),
		subtype: String(raw.subtype ?? ''),
		asset: symbol,
		wallet,
		amount: String(raw.amount ?? '0'),
		fee: String(raw.fee ?? '0'),
		decimals,
		transferRef: ''
	};
}

/**
 * @param {object} options
 * @param {() => Promise<{ key: string, secret: string }>} options.getCredentials
 * @param {string} [options.baseUrl] https://api.kraken.com; a loopback URL in tests
 * @param {typeof fetch} [options.fetch]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.pageDelayMs] pause between ledger pages
 * @param {() => number} [options.now] ms since the epoch, for the nonce
 */
export function createKrakenClient({
	getCredentials,
	baseUrl = 'https://api.kraken.com',
	fetch: f = fetch,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	pageDelayMs = 1500,
	now = () => Date.now()
}) {
	const base = baseUrl.replace(/\/+$/, '');
	let lastNonce = 0n;
	/** @type {Record<string, KrakenAssetInfo> | null} */
	let assetCache = null;

	/** @param {any} body */
	function check(body) {
		const errors = Array.isArray(body?.error) ? body.error.map(String) : [];
		if (!errors.length) return body.result;
		const first = errors[0];
		if (/Invalid key|Permission denied|Invalid signature/i.test(first)) {
			throw new KrakenError(
				`Kraken refused the API key (${first}); run pnpm setup:kraken`,
				'KRAKEN_AUTH'
			);
		}
		if (/Rate limit/i.test(first)) throw new KrakenError(first, 'KRAKEN_RATE_LIMIT', 429);
		throw new KrakenError(`Kraken: ${first}`, 'KRAKEN_ERROR');
	}

	/** @param {string} path @param {RequestInit} init */
	async function send(path, init) {
		let res;
		try {
			res = await f(`${base}${path}`, init);
		} catch {
			throw new KrakenError('Kraken is not reachable', 'KRAKEN_UNREACHABLE');
		}
		const body = await res.json().catch(() => null);
		if (!body) throw new KrakenError(`Kraken answered ${res.status} without JSON`, 'KRAKEN_ERROR');
		return check(body);
	}

	/** @returns {Promise<Record<string, KrakenAssetInfo>>} */
	async function assets() {
		if (!assetCache) assetCache = await send('/0/public/Assets', { method: 'GET' });
		return /** @type {Record<string, KrakenAssetInfo>} */ (assetCache);
	}

	/**
	 * @param {string} method e.g. Balance
	 * @param {Record<string, string>} [params]
	 */
	async function privateCall(method, params = {}) {
		const { key, secret } = await getCredentials();
		const path = `/0/private/${method}`;
		for (let attempt = 0; ; attempt++) {
			const stamp = BigInt(now()) * 1000n;
			lastNonce = stamp > lastNonce ? stamp : lastNonce + 1n;
			const nonce = lastNonce.toString();
			const body = new URLSearchParams({ nonce, ...params }).toString();
			const digest = createHash('sha256')
				.update(nonce + body)
				.digest();
			const sign = createHmac('sha512', Buffer.from(secret, 'base64'))
				.update(Buffer.concat([Buffer.from(path), digest]))
				.digest('base64');
			try {
				return await send(path, {
					method: 'POST',
					headers: {
						'API-Key': key,
						'API-Sign': sign,
						'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
					},
					body
				});
			} catch (error) {
				if (error instanceof KrakenError && error.code === 'KRAKEN_RATE_LIMIT' && attempt < 3) {
					await sleep(5000 * (attempt + 1));
					continue;
				}
				throw error;
			}
		}
	}

	/**
	 * refid → txid of deposits and withdrawals since `start`, paged by cursor,
	 * and whether Kraken gave them: `refused` with its error (no values in it)
	 * when a list was refused, e.g. for a key without Funds → Query.
	 *
	 * @param {string} start unix seconds
	 * @returns {Promise<{ refs: Map<string, string>, status: 'ok' | 'refused', reason: string }>}
	 */
	async function transferRefs(start) {
		/** @type {Map<string, string>} */
		const refs = new Map();
		let status = /** @type {'ok' | 'refused'} */ ('ok');
		let reason = '';
		for (const method of ['DepositStatus', 'WithdrawStatus']) {
			/** @type {string | boolean} */
			let cursor = true;
			for (let page = 0; cursor && page < 100; page++) {
				if (page > 0) await sleep(pageDelayMs);
				/** @type {any} */
				let result;
				try {
					result = await privateCall(method, { start, cursor: String(cursor) });
				} catch (error) {
					if (error instanceof KrakenError && error.code !== 'KRAKEN_RATE_LIMIT') {
						status = 'refused';
						reason ||= `${method}: ${error.message}`.slice(0, 160);
						break;
					}
					throw error;
				}
				const list = Array.isArray(result)
					? result
					: (result?.deposits ?? result?.withdrawals ?? []);
				for (const t of list) {
					if (t?.refid && typeof t.txid === 'string' && t.txid) refs.set(String(t.refid), t.txid);
				}
				cursor = Array.isArray(result) ? false : (result?.next_cursor ?? false);
			}
		}
		return { refs, status, reason };
	}

	return {
		/**
		 * Every non-zero balance: symbol, wallet, amount (decimal string), decimals.
		 *
		 * @returns {Promise<{ asset: string, wallet: 'spot' | 'earn', amount: string, decimals: number }[]>}
		 */
		async balances() {
			const known = await assets();
			const result = /** @type {Record<string, string>} */ (await privateCall('Balance'));
			return Object.entries(result ?? {})
				.filter(([, amount]) => Number(amount) !== 0)
				.map(([code, amount]) => {
					const { symbol, wallet, decimals } = parseAsset(code, known);
					return { asset: symbol, wallet, amount: String(amount), decimals };
				});
		},

		/**
		 * The ledger from the start of `since` (UTC) until now, oldest first.
		 *
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<{ entries: LedgerEntry[], transferRefs: 'ok' | 'refused', transferRefsReason: string }>}
		 *   `transferRefs`: whether Kraken gave the on-chain hashes of deposits and withdrawals
		 */
		async ledgers(since) {
			const known = await assets();
			const start = String(Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000) - 1);
			/** @type {Map<string, LedgerEntry>} */
			const entries = new Map();
			let ofs = 0;
			for (let page = 0; ; page++) {
				if (page > 0) await sleep(pageDelayMs);
				const result = /** @type {{ ledger?: Record<string, any>, count?: number }} */ (
					await privateCall('Ledgers', { start, ofs: String(ofs), type: 'all' })
				);
				const batch = Object.entries(result?.ledger ?? {});
				for (const [id, raw] of batch) entries.set(id, normalizeLedgerEntry(id, raw, known));
				ofs += batch.length;
				const count = Number(result?.count ?? 0);
				if (!batch.length || ofs >= count) break;
				if (page >= 1000) throw new KrakenError('Kraken ledger does not end', 'KRAKEN_ERROR');
			}
			const { refs, status, reason } = await transferRefs(String(Number(start) - 7 * 86400));
			for (const e of entries.values()) {
				if (e.type === 'deposit' || e.type === 'withdrawal')
					e.transferRef = refs.get(e.refid) ?? '';
			}
			const sorted = [...entries.values()].sort((a, b) =>
				a.time === b.time ? (a.id < b.id ? -1 : 1) : a.time < b.time ? -1 : 1
			);
			return { entries: sorted, transferRefs: status, transferRefsReason: reason };
		}
	};
}
