// Integrationen → Eigene Wallets as a list grouped by chain (#1019): which
// group a wallet is in, the order of the groups, what the search finds, a
// balance rounded for the row and the name of the service an endpoint is.
// Layout only: nothing here reads, writes or books anything.

import { fromUnits, groupDigits, separators } from '../assets/quantity.js';
import { intlLocale, t } from '../i18n/index.js';

/**
 * @typedef {'error' | 'gap' | null} WalletProblem
 *   `error`: the last sync failed; `gap`: the bookings do not add up to the balance
 */

/**
 * @typedef {object} WalletGroup
 * @property {string} chain
 * @property {import('./wallet-sync.js').Wallet[]} wallets those the search finds, in the list's order
 * @property {number} total how many wallets the chain has, found or not
 * @property {number} errors wallets whose last sync failed
 * @property {number} gaps wallets whose bookings miss their balance
 */

/**
 * @typedef {object} RowContext what the card gives every row
 * @property {boolean} busy a sync is running
 * @property {string} verlaufAbruf the Verlauf's group of what a sync replaced
 * @property {(w: import('./wallet-sync.js').Wallet) => boolean} imported read from an export (Monero), not synced
 * @property {(w: import('./wallet-sync.js').Wallet) => boolean} readByAlchemy
 * @property {(w: import('./wallet-sync.js').Wallet) => boolean} alchemyInternal
 * @property {(w: import('./wallet-sync.js').Wallet) => { name: string, label: string, url: string, own: boolean }[]} endpointsOf
 * @property {(w: import('./wallet-sync.js').Wallet) => string | null} addressLink
 * @property {(w: import('./wallet-sync.js').Wallet) => string} explorerName
 * @property {(w: import('./wallet-sync.js').Wallet) => { account: Record<string, any>, balance: string, rounded: string, gap: { booked: bigint, gap: bigint } | null }[]} accountsOf
 * @property {(w: import('./wallet-sync.js').Wallet) => import('./wallet-groups.js').WalletProblem} problemOf
 * @property {(w: import('./wallet-sync.js').Wallet) => Promise<void>} sync
 * @property {(w: import('./wallet-sync.js').Wallet, file: File | undefined) => Promise<void>} importHistory
 * @property {(w: import('./wallet-sync.js').Wallet) => Promise<void>} remove
 * @property {(w: import('./wallet-sync.js').Wallet, meta: { name: string, ledgerAccounts: Record<string, string>, costCentre: string }) => Promise<void>} saveMeta
 */
/**
 * The wallets as groups
, one per chain: chains with a problem first (a
 * failed sync before a balance gap), then by what they are worth – the
 * order of the chart's colours – and by name where there is no value.
 *
 * @param {object} p
 * @param {import('./wallet-sync.js').Wallet[]} p.wallets
 * @param {(wallet: import('./wallet-sync.js').Wallet) => WalletProblem} p.problem
 * @param {(wallet: import('./wallet-sync.js').Wallet) => boolean} [p.found] what the search finds; all where not given
 * @param {Map<string, string | null>} [p.values] chain → its value in euros, a decimal
 * @param {(chain: string) => string} [p.name] a chain's name, for the order by name
 * @returns {WalletGroup[]}
 */
export function groupWallets({
	wallets,
	problem,
	found = () => true,
	values = new Map(),
	name = (c) => c
}) {
	/** @type {Map<string, WalletGroup>} */
	const groups = new Map();
	for (const w of wallets) {
		const g = groups.get(w.chain) ?? {
			chain: w.chain,
			wallets: [],
			total: 0,
			errors: 0,
			gaps: 0
		};
		g.total++;
		const p = problem(w);
		if (p === 'error') g.errors++;
		else if (p === 'gap') g.gaps++;
		if (found(w)) g.wallets.push(w);
		groups.set(w.chain, g);
	}
	const rank = (/** @type {WalletGroup} */ g) => (g.errors ? 0 : g.gaps ? 1 : 2);
	const worth = (/** @type {string} */ chain) => Number(values.get(chain) ?? -1);
	return [...groups.values()]
		.filter((g) => g.wallets.length)
		.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				worth(b.chain) - worth(a.chain) ||
				name(a.chain).localeCompare(name(b.chain))
		);
}

/**
 * Whether a wallet is found by the search: its name, address, chain or one
 * of its assets contains the text, case aside. An empty search finds all.
 *
 * @param {string} query
 * @param {{ name?: string, address: string, chainName?: string, assets?: string[] }} wallet
 */
export function walletMatches(query, wallet) {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [wallet.name ?? '', wallet.address, wallet.chainName ?? '', ...(wallet.assets ?? [])].some(
		(s) => s.toLowerCase().includes(q)
	);
}

/** The fraction digits a balance shows at most in the row; the details show all. */
export const ROW_DECIMALS = 4;

/**
 * A balance for the row: at most four fraction digits, rounded half up; one
 * below 1 with four significant digits; one below 0.0001 as "< 0,0001".
 * Trailing zeros go. The exact figure is the details' and the tooltip's.
 *
 * @param {string} units smallest units
 * @param {number} decimals
 * @param {string} [symbol]
 * @param {{ locale?: string }} [options]
 */
export function roundedQuantity(units, decimals, symbol = '', { locale = intlLocale() } = {}) {
	const plain = fromUnits(units, decimals);
	const negative = plain.startsWith('-');
	const [int, frac = ''] = plain.replace(/^-/, '').split('.');
	const sep = separators(locale);
	const tail = symbol ? `\u00a0${symbol}` : '';
	let digits = ROW_DECIMALS;
	if (int === '0' && frac) {
		const lead = frac.length - frac.replace(/^0+/, '').length;
		if (lead >= ROW_DECIMALS) return `${negative ? '> -' : '< '}0${sep.decimal}0001${tail}`;
		digits = Math.max(ROW_DECIMALS, lead + 4);
	}
	// Round half up on the digits, as integers: no floating point.
	const scale = 10n ** BigInt(frac.length);
	const whole = BigInt(int) * scale + BigInt(frac || '0');
	const keep = 10n ** BigInt(Math.max(0, frac.length - digits));
	const rounded = frac.length > digits ? (whole + keep / 2n) / keep : whole;
	const shown = Math.min(digits, frac.length);
	const text = rounded.toString().padStart(shown + 1, '0');
	const i = text.slice(0, text.length - shown);
	const f = text.slice(text.length - shown).replace(/0+$/, '');
	const sign = negative && (i !== '0' || f) ? '-' : '';
	return `${sign}${groupDigits(i, locale)}${f ? `${sep.decimal}${f}` : ''}${tail}`;
}

/**
 * The service behind a chain's API endpoint, by the chain's kind: the API's
 * format, which an own endpoint must speak too. Not every `api` is Blockscout.
 *
 * @param {string | undefined} kind a chain's kind (chains.js)
 * @returns {'blockscout' | 'esplora' | 'filfox' | 'nearblocks' | null}
 */
export function apiService(kind) {
	if (kind === 'evm') return 'blockscout';
	if (kind === 'bitcoin') return 'esplora';
	if (kind === 'filecoin') return 'filfox';
	if (kind === 'near') return 'nearblocks';
	return null;
}

/**
 * An endpoint's label, by its name and the chain's kind: `API (Filfox)` for
 * Filecoin, `API (Esplora, mempool.space)` for Bitcoin, `RPC`, `REST` …
 *
 * @param {string} name `api`, `rpc`, `rest`, `indexer`
 * @param {string | undefined} kind
 */
export function endpointLabel(name, kind) {
	const service = name === 'api' ? apiService(kind) : null;
	return service
		? t(`integrationen.wallets.endpoint.apiService.${service}`)
		: t(`integrationen.wallets.endpoint.${name}`);
}

/**
 * When a wallet was last synchronised, in words for the row: within the hour,
 * hours ago, yesterday, days ago; after a month, the date.
 *
 * @param {string | undefined} at an ISO time
 * @param {number} [now] ms
 * @returns {{ key: 'never' | 'now' | 'hours' | 'yesterday' | 'days' | 'date', count?: number, date?: string }}
 */
export function syncedAgo(at, now = Date.now()) {
	const then = at ? Date.parse(at) : NaN;
	if (!Number.isFinite(then)) return { key: 'never' };
	const hours = Math.floor((now - then) / 3600_000);
	if (hours < 1) return { key: 'now' };
	if (hours < 24) return { key: 'hours', count: hours };
	if (hours < 48) return { key: 'yesterday' };
	const days = Math.floor(hours / 24);
	if (days <= 30) return { key: 'days', count: days };
	return { key: 'date', date: /** @type {string} */ (at).slice(0, 10) };
}

/** The tabs of the page, the first the one shown when none was chosen. */
export const WALLET_TABS = /** @type {const} */ (['wallets', 'overview', 'statements']);
const TAB_KEY = 'belege.walletsTab';

/**
 * The tab this browser showed last: a convenience of the device, no data of
 * the books, so in localStorage.
 *
 * @param {Pick<Storage, 'getItem'> | undefined} [storage]
 * @returns {(typeof WALLET_TABS)[number]}
 */
export function rememberedTab(storage = globalThis.localStorage) {
	try {
		const kept = storage?.getItem(TAB_KEY);
		return WALLET_TABS.find((t) => t === kept) ?? WALLET_TABS[0];
	} catch {
		return WALLET_TABS[0];
	}
}

/**
 * @param {string} tab
 * @param {Pick<Storage, 'setItem'> | undefined} [storage]
 */
export function rememberTab(tab, storage = globalThis.localStorage) {
	try {
		storage?.setItem(TAB_KEY, tab);
	} catch {
		// No storage: the choice holds until the page is left.
	}
}
