// The ledger account (Sachkonto) of a bank, exchange or wallet account, read
// off the person's own chart of accounts (chart.js) by its name: a chart that
// has "1310 Kraken BTC" names the account of "Kraken BTC". Taken over only
// when it is unambiguous – one chart account for one account of the books,
// and that chart account for no other – since a wrong number goes into the
// DATEV export unseen. Without a match nothing is guessed for an account that
// exists; a new wallet is offered the next free number beside the other
// wallets' (suggestWalletLedger). Pure.

import { ledgerLength } from './chart.js';
import { isAccountNumber } from './skr03.js';

/** @typedef {import('./chart.js').ChartAccount} ChartAccount */

/** Words that say "an account" and nothing about which. */
const GENERIC = new Set(['konto', 'kto', 'nr', 'no', 'account', 'acct']);

/**
 * An asset's ticker and its name are one word: a chart says "Kraken Bitcoin"
 * where the account is "Kraken BTC". Each line is one asset, as compared
 * (lower case, umlauts spelled out).
 */
const SAME_ASSET = [
	['eur', 'euro'],
	['usd', 'dollar'],
	['btc', 'xbt', 'bitcoin'],
	['eth', 'ether', 'ethereum'],
	['fil', 'filecoin'],
	['xmr', 'monero'],
	['akt', 'akash'],
	['atom', 'cosmos'],
	['dot', 'polkadot'],
	['sol', 'solana'],
	['ada', 'cardano'],
	['ltc', 'litecoin'],
	['doge', 'dogecoin'],
	['xrp', 'ripple'],
	['usdt', 'tether'],
	['matic', 'pol', 'polygon'],
	['arb', 'arbitrum'],
	['op', 'optimism']
];
/** @type {Map<string, string>} every spelling → the first of its line */
const ASSET_WORD = new Map(SAME_ASSET.flatMap((line) => line.map((w) => [w, line[0]])));

/**
 * A name as compared: its words of letters and digits, lower case, umlauts
 * as written or spelled out alike.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function nameWords(text) {
	return String(text ?? '')
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 2)
		.map((w) => ASSET_WORD.get(w) ?? w);
}

/** The chart's ledger accounts (not its longer personal accounts), with their words. @param {{ accounts: ChartAccount[] } | null | undefined} chart */
function ledgerAccounts(chart) {
	const accounts = chart?.accounts ?? [];
	const length = ledgerLength(accounts);
	return accounts
		.filter((a) => a.number.length === length)
		.map((a) => ({ account: a, words: new Set(nameWords(a.name)) }));
}

/**
 * The chart accounts whose name fits an account of the books: one that names
 * the IBAN's last four digits, else those that hold every word of the
 * account's own name.
 *
 * @param {{ name?: unknown, ibanLast4?: unknown }} account
 * @param {ReturnType<typeof ledgerAccounts>} candidates
 * @returns {ChartAccount[]}
 */
function fitting(account, candidates) {
	const last4 = String(account.ibanLast4 ?? '');
	if (/^\d{4}$/.test(last4)) {
		const byIban = candidates.filter((c) => c.words.has(last4));
		if (byIban.length) return byIban.map((c) => c.account);
	}
	const words = nameWords(account.name).filter((w) => !GENERIC.has(w));
	if (!words.length) return [];
	return candidates.filter((c) => words.every((w) => c.words.has(w))).map((c) => c.account);
}

/**
 * The ledger accounts the chart names for the accounts that have none yet:
 * account id → chart account. An account with several fitting chart accounts
 * gets none; neither do two accounts that fit the same one, nor an account
 * whose only fit is already another account's ledger account.
 *
 * @param {{ id: string, name?: unknown, ibanLast4?: unknown, ledgerAccount?: unknown, deleted?: boolean }[]} accounts
 * @param {{ accounts: ChartAccount[] } | null | undefined} chart
 * @returns {Map<string, ChartAccount>}
 */
export function ledgersFromChart(accounts, chart) {
	/** @type {Map<string, ChartAccount>} */
	const out = new Map();
	const candidates = ledgerAccounts(chart);
	if (!candidates.length) return out;
	const live = accounts.filter((a) => !a.deleted);
	const taken = new Set(
		live.map((a) => String(a.ledgerAccount ?? '')).filter((n) => isAccountNumber(n))
	);
	/** @type {Map<string, string[]>} chart number → the accounts it alone fits */
	const claims = new Map();
	/** @type {Map<string, ChartAccount>} */
	const byNumber = new Map();
	for (const a of live) {
		if (isAccountNumber(String(a.ledgerAccount ?? ''))) continue;
		const fits = fitting(a, candidates);
		if (fits.length !== 1 || taken.has(fits[0].number)) continue;
		byNumber.set(fits[0].number, fits[0]);
		claims.set(fits[0].number, [...(claims.get(fits[0].number) ?? []), a.id]);
	}
	for (const [number, ids] of claims) {
		if (ids.length === 1) out.set(ids[0], /** @type {ChartAccount} */ (byNumber.get(number)));
	}
	return out;
}

/**
 * A ledger account for a wallet that is being added: the chart account that
 * names it (by the wallet's own name, else by its chain), when exactly one
 * does and nothing uses it yet; else the next free number after the other
 * wallets' ledger accounts – one the bookkeeping has to open first when the
 * chart does not have it. Null when there is nothing to go by.
 *
 * @param {object} p
 * @param {string} [p.name] the wallet's name, when it has one
 * @param {{ name?: string, shortName?: string, nativeSymbol?: string } | null | undefined} p.chain
 * @param {{ ledgerAccount?: string }[]} p.wallets the wallets already kept
 * @param {{ ledgerAccount?: unknown, deleted?: boolean }[]} p.accounts every account of the books
 * @param {{ accounts: ChartAccount[] } | null | undefined} p.chart
 * @returns {{ number: string, name: string, source: 'chart' | 'next', inChart: boolean } | null}
 */
export function suggestWalletLedger({ name = '', chain, wallets, accounts, chart }) {
	const used = new Set(
		[...wallets, ...accounts.filter((a) => !a.deleted)]
			.map((x) => String(x.ledgerAccount ?? ''))
			.filter((n) => isAccountNumber(n))
	);
	const candidates = ledgerAccounts(chart);
	const free = candidates.filter((c) => !used.has(c.account.number));
	for (const label of [name, chain?.name, chain?.shortName, chain?.nativeSymbol]) {
		const words = nameWords(label).filter((w) => !GENERIC.has(w));
		if (!words.length) continue;
		const fits = free.filter((c) => words.every((w) => c.words.has(w)));
		if (fits.length === 1) {
			return {
				number: fits[0].account.number,
				name: fits[0].account.name,
				source: 'chart',
				inChart: true
			};
		}
	}
	const ofWallets = wallets
		.map((w) => String(w.ledgerAccount ?? ''))
		.filter((n) => isAccountNumber(n));
	if (!ofWallets.length) return null;
	const length = ofWallets[0].length;
	const inChart = new Map((chart?.accounts ?? []).map((a) => [a.number, a.name]));
	let next = Math.max(...ofWallets.filter((n) => n.length === length).map(Number)) + 1;
	// A number the chart gives to something else, or that is in use, is not free.
	for (let i = 0; i < 200 && (used.has(String(next)) || inChart.has(String(next))); i++) next++;
	const number = String(next).padStart(length, '0');
	if (number.length !== length || used.has(number) || inChart.has(number)) return null;
	return { number, name: '', source: 'next', inChart: false };
}

/**
 * Give every account that has no ledger account the one the chart names for
 * it (ledgersFromChart), in the books, and say which.
 *
 * @param {{ accounts: import('../store/repository.js').Collection }} store
 * @param {{ accounts: ChartAccount[] } | null | undefined} chart
 * @returns {Promise<{ id: string, number: string, name: string }[]>} what was taken over
 */
export async function takeLedgersFromChart(store, chart) {
	const accounts = await store.accounts.list();
	const found = ledgersFromChart(/** @type {any[]} */ (accounts), chart);
	/** @type {{ id: string, number: string, name: string }[]} */
	const taken = [];
	for (const a of accounts) {
		const match = found.get(a.id);
		if (!match) continue;
		await store.accounts.put({ ...a, ledgerAccount: match.number });
		taken.push({ id: a.id, number: match.number, name: match.name });
	}
	return taken;
}
