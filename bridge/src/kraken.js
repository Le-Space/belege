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
// Private calls go out one at a time. Kraken wants every call of a key to
// arrive with a higher nonce than the one before; two sent at once (the app
// asks for balances and the ledger together) can overtake each other, and the
// later-arriving lower nonce is refused with `EAPI:Invalid nonce`.
//
// A deposit or withdrawal also gets its transfer reference: the txid Kraken
// reports in DepositStatus / WithdrawStatus under the same refid – the
// on-chain transaction hash for crypto, the bank's reference for euros. That
// lets the app pair a withdrawal with the wallet that received it. If the key
// may not read those lists (Funds → Query), entries have none, and the
// ledger says so (`transferRefs: 'refused'`, with Kraken's error code).
//
// Transport, signature and Kraken's error codes come from ccxt (#265), through
// its raw endpoints (`privatePostLedgers`, …): the answers are Kraken's own,
// so ids, paging and everything below stay exactly as before. ccxt is loaded
// on the first call – it is large, and most bridges never ask Kraken. Its
// nonce keeps this module's unit, microseconds (ms × 1000): Kraken remembers
// the highest nonce a key has sent, and ccxt's default (milliseconds) would be
// lower than every nonce this bridge ever sent – `EAPI:Invalid nonce` for good.
// ccxt's own throttle is off; the pauses here are the ones Kraken asks for.
//
// What leaves this module is normalised: Kraken's asset codes (`XXBT`,
// `ZEUR`, `DOT.S`) become a symbol (`BTC`, `EUR`, `DOT`) and a wallet
// (`spot`, or `earn` for staked and earning balances); amounts stay decimal
// strings with the asset's decimals, as Kraken sends them.
//
// Every ledger entry also carries `balance`: the asset's balance on Kraken
// after it (amount and fee). It is kept, with Kraken's own asset code, so the
// monthly statement can take an account's balance at a month's end from
// Kraken instead of working it back from today (#287).

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
 * @property {string} transferMethod how Kraken names its network (`Filecoin`, `Ether (Arbitrum One)`), '' when none
 * @property {string} balance the asset's balance after this entry, decimal; '' when Kraken gave none
 * @property {string} code Kraken's asset code (`XXBT`, `DOT.S`): which balance `balance` is
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
		transferRef: '',
		transferMethod: '',
		balance: /^\d+(\.\d+)?$/.test(String(raw.balance ?? '')) ? String(raw.balance) : '',
		code: String(raw.asset ?? '')
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
	/** The private calls, one after the other (see above). */
	/** @type {Promise<unknown>} */
	let queue = Promise.resolve();
	/** @type {Record<string, KrakenAssetInfo> | null} */
	let assetCache = null;
	/** @type {{ key: string, exchange: any } | null} */
	let current = null;

	/**
	 * ccxt's Kraken for these credentials, made once (again when the key changes).
	 *
	 * @param {{ key: string, secret: string } | null} credentials null for the public endpoints
	 */
	async function exchangeFor(credentials) {
		const key = credentials?.key ?? '';
		if (current && (current.key === key || !credentials)) return current.exchange;
		const { default: ccxt } = await import('ccxt');
		const exchange = new ccxt.kraken({
			apiKey: credentials?.key,
			secret: credentials?.secret,
			enableRateLimit: false,
			timeout: 30_000
		});
		exchange.urls.api = { ...exchange.urls.api, public: base, private: base };
		// Microseconds, as this bridge has always sent them (see above).
		exchange.nonce = () => now() * 1000;
		if (f !== fetch) exchange.fetchImplementation = f;
		current = { key, exchange };
		return exchange;
	}

	/**
	 * A ccxt error as this module's: Kraken's own error text, never more.
	 *
	 * @param {any} error
	 * @param {any} ccxt the library, for its error classes
	 */
	function asKrakenError(error, ccxt) {
		if (error instanceof KrakenError) return error;
		const body = /^kraken (\{.*\})$/s.exec(String(error?.message ?? ''))?.[1];
		/** @type {string} */
		let first = '';
		try {
			first = String(JSON.parse(body ?? '{}')?.error?.[0] ?? '');
		} catch {
			first = '';
		}
		if (error instanceof ccxt.RateLimitExceeded || error instanceof ccxt.DDoSProtection) {
			return new KrakenError(first || 'Rate limit exceeded', 'KRAKEN_RATE_LIMIT', 429);
		}
		if (error instanceof ccxt.AuthenticationError) {
			return new KrakenError(
				`Kraken refused the API key (${first || 'authentication'}); run pnpm setup:kraken`,
				'KRAKEN_AUTH'
			);
		}
		if (error instanceof ccxt.NetworkError && !first) {
			return new KrakenError('Kraken is not reachable', 'KRAKEN_UNREACHABLE');
		}
		return new KrakenError(`Kraken: ${first || 'unexpected answer'}`, 'KRAKEN_ERROR');
	}

	/**
	 * One call through ccxt; Kraken's `result`.
	 *
	 * @param {string} name ccxt's raw method, e.g. privatePostLedgers
	 * @param {Record<string, string>} params
	 * @param {{ key: string, secret: string } | null} credentials
	 */
	async function call(name, params, credentials) {
		const exchange = await exchangeFor(credentials);
		const { default: ccxt } = await import('ccxt');
		try {
			const body = await exchange[name](params);
			return body?.result;
		} catch (error) {
			throw asKrakenError(error, ccxt);
		}
	}

	/** @returns {Promise<Record<string, KrakenAssetInfo>>} */
	async function assets() {
		if (!assetCache) assetCache = await call('publicGetAssets', {}, null);
		return /** @type {Record<string, KrakenAssetInfo>} */ (assetCache);
	}

	/**
	 * @param {string} method e.g. Balance
	 * @param {Record<string, string>} [params]
	 */
	function privateCall(method, params = {}) {
		const run = queue.then(() => privateCallNow(method, params));
		queue = run.catch(() => {});
		return run;
	}

	/**
	 * @param {string} method
	 * @param {Record<string, string>} params
	 */
	async function privateCallNow(method, params) {
		const credentials = await getCredentials();
		for (let attempt = 0; ; attempt++) {
			try {
				return await call(`privatePost${method}`, params, credentials);
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
	 * refid → txid and network name of deposits and withdrawals since `start`, paged by cursor,
	 * and whether Kraken gave them: `refused` with its error (no values in it)
	 * when a list was refused, e.g. for a key without Funds → Query.
	 *
	 * @param {string} start unix seconds
	 * @returns {Promise<{ refs: Map<string, { txid: string, method: string }>, status: 'ok' | 'refused', reason: string }>}
	 */
	async function transferRefs(start) {
		/** @type {Map<string, { txid: string, method: string }>} */
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
					if (t?.refid && typeof t.txid === 'string' && t.txid) {
						// The network, as Kraken names it: tells the chain of the hash (#215).
						const raw = typeof t.network === 'string' && t.network ? t.network : t.method;
						const method =
							typeof raw === 'string' && /^[\w\s().,/+-]{1,60}$/.test(raw) ? raw.trim() : '';
						refs.set(String(t.refid), { txid: t.txid, method });
					}
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
				if (e.type === 'deposit' || e.type === 'withdrawal') {
					const ref = refs.get(e.refid);
					e.transferRef = ref?.txid ?? '';
					e.transferMethod = ref?.method ?? '';
				}
			}
			const sorted = [...entries.values()].sort((a, b) =>
				a.time === b.time ? (a.id < b.id ? -1 : 1) : a.time < b.time ? -1 : 1
			);
			return { entries: sorted, transferRefs: status, transferRefsReason: reason };
		}
	};
}
