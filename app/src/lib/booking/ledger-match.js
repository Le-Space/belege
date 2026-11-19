// The ledger account (Sachkonto) of a bank, exchange or wallet account, read
// off the person's own chart of accounts (chart.js) by its name: a chart that
// has "1310 Kraken BTC" names the account of "Kraken BTC". Taken over only
// when it is unambiguous – one chart account for one account of the books,
// and that chart account for no other – since a wrong number goes into the
// DATEV export unseen. Without a match nothing is guessed for an account that
// exists; a new wallet is offered the next free number beside the other
// wallets' (suggestWalletLedger, walletLedgerCandidates). Pure.

import { ledgerLength } from './chart.js';
import { isAccountNumber } from './skr03.js';

/** @typedef {import('./chart.js').ChartAccount} ChartAccount */

/** Words that say "an account" and nothing about which. */
const GENERIC = new Set(['konto', 'kto', 'nr', 'no', 'account', 'acct', 'wallet']);

/**
 * What a bank calls the product, which says nothing of the bank: an account
 * named only so is not looked up by its name ("Kontokorrent" stands in the
 * name of many a chart account that is no bank account at all).
 */
const PRODUCT = new Set([
	'kontokorrent',
	'kontokorrentkonto',
	'giro',
	'girokonto',
	'geschaeftskonto',
	'geschaeftsgirokonto',
	'firmenkonto',
	'tagesgeld',
	'tagesgeldkonto',
	'sparkonto',
	'main',
	'current',
	'business',
	'checking',
	'savings'
]);

/**
 * An asset's ticker and its name are one word: a chart says "Kraken Bitcoin"
 * where the account is "Kraken BTC". Each line is one asset, as compared
 * (lower case, umlauts spelled out).
 */
const SAME_ASSET = [
	['eur', 'euro'],
	['usd', 'dollar'],
	['btc', 'xbt', 'bitcoin'],
	// Not "ethereum": that is the chain, which other assets live on too.
	['eth', 'ether'],
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

/** Words of a bank's name that many banks share, or that say only what kind of firm it is. */
const BANK_GENERIC = new Set([
	'bank',
	'banque',
	'ag',
	'eg',
	'sa',
	'se',
	'nv',
	'uab',
	'ltd',
	'plc',
	'gmbh',
	'inc',
	'europe',
	'europa',
	'business',
	'payments',
	'de',
	'und'
]);

/**
 * The word a bank is known by: the first of its name that is not shared by
 * banks in general ("GLS" of "GLS Gemeinschaftsbank eG", "Revolut" of
 * "Revolut Bank UAB"). '' when the account's record names no bank.
 *
 * @param {unknown} bank
 */
export const bankWord = (bank) => nameWords(bank).find((w) => !BANK_GENERIC.has(w)) ?? '';

/**
 * The chart accounts whose name fits an account of the books: one that names
 * the IBAN's last four digits, else those that hold every word of the
 * account's own name, else those that name its bank.
 *
 * @param {{ name?: unknown, ibanLast4?: unknown, bank?: unknown }} account
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
	const says = words.some((w) => !PRODUCT.has(w));
	const byName = says ? candidates.filter((c) => words.every((w) => c.words.has(w))) : [];
	if (byName.length) return byName.map((c) => c.account);
	const bank = bankWord(account.bank);
	return bank ? candidates.filter((c) => c.words.has(bank)).map((c) => c.account) : [];
}

/**
 * A wallet's name, as its asset accounts carry it before the asset
 * ("Projekt Nord · ETH (Ethereum)"); '' for an account that is no wallet's.
 *
 * @param {{ name?: unknown, kind?: unknown }} account
 */
const walletOf = (account) =>
	account.kind === 'wallet' && String(account.name ?? '').includes(' · ')
		? String(account.name).split(' · ')[0].trim()
		: '';

/**
 * The words that say which asset on which chain a wallet's account holds:
 * the asset, and the chain where the name gives it in brackets. Empty for an
 * account that is no wallet's, or names no asset.
 *
 * @param {{ name?: unknown, kind?: unknown, asset?: unknown }} account
 * @returns {string[]}
 */
function assetWords(account) {
	if (account.kind !== 'wallet') return [];
	const asset = nameWords(account.asset);
	if (!asset.length) return [];
	const chain = /\(([^)]*)\)\s*$/.exec(String(account.name ?? ''))?.[1] ?? '';
	return [...new Set([...asset, ...nameWords(chain)])];
}

/**
 * What the chart calls each wallet, read off the accounts already found: the
 * words every one of a wallet's chart accounts has beyond its asset and chain.
 *
 * @param {{ id: string, name?: unknown, kind?: unknown, asset?: unknown }[]} accounts
 * @param {Map<string, ChartAccount>} found
 * @returns {Map<string, string[]>} wallet name → the chart's words for it
 */
function holderWords(accounts, found) {
	/** @type {Map<string, string[]>} */
	const out = new Map();
	for (const a of accounts) {
		const wallet = walletOf(a);
		const match = found.get(a.id);
		if (!wallet || !match) continue;
		const own = new Set(assetWords(a));
		const rest = nameWords(match.name).filter((w) => !own.has(w) && !GENERIC.has(w));
		const before = out.get(wallet);
		out.set(wallet, before ? before.filter((w) => rest.includes(w)) : [...new Set(rest)]);
	}
	return out;
}

/**
 * The chart accounts worth offering for an account that got none by itself:
 * the free ones that share the most words with its name and its bank, best
 * first. For the person to pick from – nothing here is taken over.
 *
 * @param {{ id: string, name?: unknown, bank?: unknown, kind?: unknown, asset?: unknown }} account
 * @param {{ id: string, ledgerAccount?: unknown, deleted?: boolean }[]} accounts every account of the books
 * @param {{ accounts: ChartAccount[] } | null | undefined} chart
 * @param {number} [limit]
 * @returns {ChartAccount[]}
 */
export function chartCandidates(account, accounts, chart, limit = 4) {
	const numbered = accounts
		.filter((a) => !a.deleted && a.id !== account.id)
		.map((a) => String(a.ledgerAccount ?? ''))
		.filter((n) => isAccountNumber(n));
	const used = new Set(numbered);
	const asset = assetWords(account);
	const words = new Set(
		[...nameWords(account.name), bankWord(account.bank)].filter(
			(w) => w && !GENERIC.has(w) && !PRODUCT.has(w)
		)
	);
	if (!words.size) return [];
	// Bank, exchange and wallet accounts sit together in a chart: with several
	// numbered already, an account far from all of them is none of that kind.
	const near = nearNumbered(numbered);
	return (
		ledgerAccounts(chart)
			.filter((c) => !used.has(c.account.number) && near(c.account.number))
			// A wallet's account holds one asset: a chart account of another is not it.
			.filter((c) => !asset.length || nameWords(account.asset).every((w) => c.words.has(w)))
			.map((c) => ({
				account: c.account,
				shared:
					[...words].filter((w) => c.words.has(w)).length +
					// Asset and chain weigh more than a word of the wallet's name.
					2 * asset.filter((w) => c.words.has(w)).length
			}))
			.filter((c) => c.shared > 0)
			.sort((a, b) => b.shared - a.shared || (a.account.number < b.account.number ? -1 : 1))
			.slice(0, limit)
			.map((c) => c.account)
	);
}

/**
 * Whether a number lies among the ledger accounts already given, a hundred
 * to either side; everything does while fewer than two are given.
 *
 * @param {string[]} numbered
 * @returns {(number: string) => boolean}
 */
function nearNumbered(numbered) {
	if (numbered.length < 2) return () => true;
	const values = numbered.map(Number);
	const low = Math.min(...values) - 100;
	const high = Math.max(...values) + 100;
	const length = numbered[0].length;
	return (number) => number.length === length && Number(number) >= low && Number(number) <= high;
}

/**
 * The ledger accounts the chart names for the accounts that have none yet:
 * account id → chart account. An account with several fitting chart accounts
 * gets none; neither do two accounts that fit the same one, nor an account
 * whose only fit is already another account's ledger account.
 *
 * @param {{ id: string, name?: unknown, ibanLast4?: unknown, bank?: unknown, kind?: unknown, asset?: unknown, ledgerAccount?: unknown, deleted?: boolean }[]} accounts
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
	const open = () =>
		live.filter((a) => !isAccountNumber(String(a.ledgerAccount ?? '')) && !out.has(a.id));

	/**
	 * One round: every open account names the free chart accounts that fit it;
	 * a chart account that exactly one account names alone goes to it.
	 *
	 * @param {(a: (typeof live)[number], free: typeof candidates) => ChartAccount[]} fits
	 */
	const round = (fits) => {
		const free = candidates.filter((c) => !taken.has(c.account.number));
		/** @type {Map<string, { ids: string[], account: ChartAccount }>} */
		const claims = new Map();
		for (const a of open()) {
			const found = fits(a, free);
			if (found.length !== 1) continue;
			const claim = claims.get(found[0].number) ?? { ids: [], account: found[0] };
			claim.ids.push(a.id);
			claims.set(found[0].number, claim);
		}
		for (const [number, claim] of claims) {
			if (claim.ids.length !== 1) continue;
			out.set(claim.ids[0], claim.account);
			taken.add(number);
		}
	};

	// 1. By the account's whole name, the IBAN's digits or its bank.
	round((a, free) => fitting(a, free));
	// 2. A wallet's asset account by its asset and chain alone: the chart may
	//    call the wallet otherwise ("Ledger - ALEPH (Ethereum)" for the wallet
	//    the books call by another name), but names one such account only.
	round((a, free) => {
		const need = assetWords(a);
		return need.length
			? free.filter((c) => need.every((w) => c.words.has(w))).map((c) => c.account)
			: [];
	});
	// 3. What rounds 1 and 2 found tells what the chart calls each wallet: the
	//    words its chart accounts share beyond asset and chain. The wallet's
	//    other assets are then looked up under that name.
	const holders = holderWords(live, out);
	round((a, free) => {
		const need = assetWords(a);
		const holder = holders.get(walletOf(a));
		if (!need.length || !holder?.length) return [];
		return free
			.filter((c) => [...need, ...holder].every((w) => c.words.has(w)))
			.map((c) => c.account);
	});
	return out;
}

/**
 * A ledger account for a wallet that is being added: the chart account that
 * names it (by the wallet's own name, its address, else by its chain), when
 * exactly one does and nothing uses it yet; else the next free number after
 * the ledger accounts the other wallets have – on the wallet itself or on its
 * accounts – one the bookkeeping has to open first when the chart does not
 * have it. Null when there is nothing to go by.
 *
 * When the chart has several accounts that fit, none is picked: they come
 * back as `candidates` (walletLedgerCandidates), for the person to choose.
 *
 * @param {object} p
 * @param {string} [p.name] the wallet's name, when it has one
 * @param {string} [p.address] its address or account id (`name.near`): a chart may name the account by it
 * @param {{ name?: string, shortName?: string, nativeSymbol?: string } | null | undefined} p.chain
 * @param {{ ledgerAccount?: string }[]} p.wallets the wallets already kept
 * @param {{ ledgerAccount?: unknown, deleted?: boolean, kind?: unknown }[]} p.accounts every account of the books
 * @param {{ accounts: ChartAccount[] } | null | undefined} p.chart
 * @returns {{ number: string, name: string, source: 'chart' | 'next', inChart: boolean } | null}
 */
export function suggestWalletLedger({ name = '', address = '', chain, wallets, accounts, chart }) {
	const { free, used } = freeLedgerAccounts({ wallets, accounts, chart });
	for (const words of walletLabels({ name, address, chain })) {
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
	// The numbers wallets have so far: on the wallet, or on its accounts (one per asset).
	const ofWallets = [...wallets, ...accounts.filter((a) => !a.deleted && a.kind === 'wallet')]
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
 * The chart's free accounts that fit a wallet being added, when more than one
 * does and so none is picked for it (suggestWalletLedger): by the most telling
 * label that has any – the name, the address, then the chain.
 *
 * @param {Parameters<typeof suggestWalletLedger>[0]} p
 * @param {number} [limit]
 * @returns {ChartAccount[]}
 */
export function walletLedgerCandidates(
	{ name = '', address = '', chain, wallets, accounts, chart },
	limit = 6
) {
	const { free } = freeLedgerAccounts({ wallets, accounts, chart });
	for (const words of walletLabels({ name, address, chain })) {
		const fits = free.filter((c) => words.every((w) => c.words.has(w)));
		if (fits.length === 1) return [];
		if (fits.length > 1) return fits.slice(0, limit).map((c) => c.account);
	}
	return [];
}

/**
 * What a wallet may be called in a chart, most telling first, as words.
 *
 * @param {{ name?: string, address?: string, chain: { name?: string, shortName?: string, nativeSymbol?: string } | null | undefined }} p
 * @returns {string[][]}
 */
function walletLabels({ name = '', address = '', chain }) {
	return [name, address, chain?.name, chain?.shortName, chain?.nativeSymbol]
		.map((label) => nameWords(label).filter((w) => !GENERIC.has(w)))
		.filter((words) => words.length);
}

/**
 * The chart's ledger accounts nothing in the books uses yet, and the numbers in use.
 *
 * @param {{ wallets: { ledgerAccount?: string }[], accounts: { ledgerAccount?: unknown, deleted?: boolean }[], chart: { accounts: ChartAccount[] } | null | undefined }} p
 */
function freeLedgerAccounts({ wallets, accounts, chart }) {
	const used = new Set(
		[...wallets, ...accounts.filter((a) => !a.deleted)]
			.map((x) => String(x.ledgerAccount ?? ''))
			.filter((n) => isAccountNumber(n))
	);
	return { used, free: ledgerAccounts(chart).filter((c) => !used.has(c.account.number)) };
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
