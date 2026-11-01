// A crypto-ledger file (schema/crypto-ledger.v1.schema.json) into the books,
// the way back of crypto-ledger.js (issue #267): from another tool, or from
// Belege itself on another device.
//
// The file is checked against the schema's rules here, by hand – the app
// carries no schema validator; crypto-ledger-import.spec.js holds both to the
// same examples and the same refusals. Then every movement is booked as the
// source it names would book it:
//
//   a wallet          on a chain Belege knows (by its CAIP-2 id): one account
//                     per address and asset, the chain's id as its source –
//                     the account a sync of that wallet uses, so a later sync
//                     and the import know each other's bookings by their ids
//   a Kraken account  `kraken`, `kraken/earn`: the accounts Kraken's sync uses
//
// A chain or exchange Belege does not read yet is left out and named in the
// result (issues #265, #266). Values come from the file as they are, with
// their rate and its source; a movement without one is kept, its euro amount
// open ("Kurs fehlt"), as a sync keeps it.
//
// The import only adds. A movement whose id the account already has – from a
// sync, an earlier import, or deleted by hand – is skipped, never rewritten:
// a sync knows more than the file (a swap's sides, the purpose it wrote), and
// a person's confirmation stays. Importing the same file twice adds nothing.

import { recordEvent } from '../activity/events.js';
import { importTransactions } from '../bank/import.js';
import { toUnits } from '../assets/quantity.js';
import { accountKey, accountName, describeEntry } from '../exchanges/kraken-sync.js';
import { describeWalletEntry, shortHash } from '../wallets/wallet-sync.js';
import {
	WALLET_CHAINS,
	normalizeAddress,
	safeExplorerUrl,
	walletAccountName
} from '../wallets/chains.js';
import { FORMAT, VERSION } from './crypto-ledger.js';

/** A file larger than this is refused before it is parsed. */
export const MAX_BYTES = 50 * 1024 * 1024;

/** @typedef {Record<string, any>} Rec */

const KINDS = new Set(['transfer', 'trade', 'swap', 'fee', 'reward', 'stake', 'mining']);
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const CAIP19 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}$/;
const SYMBOL = /^[A-Z0-9.]{1,12}$/;

/** RFC 3339 date-time, as JSON Schema's `format: date-time`. @param {unknown} v */
const isDateTime = (v) =>
	typeof v === 'string' &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(v) &&
	Number.isFinite(Date.parse(v));

/** A real calendar day `YYYY-MM-DD`. @param {unknown} v */
const isDate = (v) =>
	typeof v === 'string' &&
	/^\d{4}-\d{2}-\d{2}$/.test(v) &&
	new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const isText = (/** @type {unknown} */ v) => typeof v === 'string' && v.length > 0;
const isObject = (/** @type {unknown} */ v) =>
	v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {Rec} obj
 * @param {readonly string[]} allowed
 * @param {string} path
 * @param {string[]} out
 */
function onlyKnown(obj, allowed, path, out) {
	for (const k of Object.keys(obj)) {
		if (!allowed.includes(k)) out.push(`${path}: unknown field "${k}"`);
	}
}

/**
 * What is wrong with a parsed file, by the schema's rules plus two the schema
 * can only describe: every movement's account is one of the file's, and an
 * amount has no more decimals than its asset. Empty: nothing.
 *
 * @param {unknown} doc
 * @returns {string[]}
 */
export function checkCryptoLedger(doc) {
	/** @type {string[]} */
	const out = [];
	if (!isObject(doc)) return ['not a JSON object'];
	const d = /** @type {Rec} */ (doc);
	onlyKnown(
		d,
		['format', 'version', 'createdAt', 'generator', 'currency', 'accounts', 'movements'],
		'file',
		out
	);
	if (d.format !== FORMAT) out.push(`file: format must be "${FORMAT}"`);
	if (d.version !== VERSION) out.push(`file: version must be ${VERSION}`);
	if (!isDateTime(d.createdAt)) out.push('file: createdAt is no date-time');
	if ('generator' in d && typeof d.generator !== 'string') out.push('file: generator is no text');
	if (typeof d.currency !== 'string' || !/^[A-Z]{3}$/.test(d.currency)) {
		out.push('file: currency is no currency code');
	}
	if (!Array.isArray(d.accounts)) out.push('file: accounts is no list');
	if (!Array.isArray(d.movements)) out.push('file: movements is no list');
	if (out.length) return out;

	/** @type {Map<string, number>} */
	const ids = new Map();
	d.accounts.forEach((/** @type {unknown} */ a, /** @type {number} */ i) => {
		const path = `accounts[${i}]`;
		if (!isObject(a)) return out.push(`${path}: not an object`);
		const acc = /** @type {Rec} */ (a);
		onlyKnown(acc, ['id', 'type', 'name', 'chain', 'address', 'exchange'], path, out);
		if (!isText(acc.id)) out.push(`${path}: id missing`);
		else if (ids.has(acc.id)) out.push(`${path}: id "${acc.id}" twice`);
		else ids.set(acc.id, i);
		if (typeof acc.name !== 'string') out.push(`${path}: name missing`);
		if (acc.type === 'wallet') {
			if (typeof acc.chain !== 'string' || !CAIP2.test(acc.chain)) {
				out.push(`${path}: chain is no CAIP-2 id`);
			}
			if (!isText(acc.address)) out.push(`${path}: address missing`);
			if ('exchange' in acc) out.push(`${path}: a wallet names no exchange`);
		} else if (acc.type === 'exchange') {
			if (typeof acc.exchange !== 'string' || !/^[a-z0-9]+$/.test(acc.exchange)) {
				out.push(`${path}: exchange missing`);
			}
			if ('chain' in acc || 'address' in acc) {
				out.push(`${path}: an exchange account has no chain or address`);
			}
		} else out.push(`${path}: type must be wallet or exchange`);
	});

	d.movements.forEach((/** @type {unknown} */ m, /** @type {number} */ i) => {
		const path = `movements[${i}]`;
		if (!isObject(m)) return out.push(`${path}: not an object`);
		const mv = /** @type {Rec} */ (m);
		onlyKnown(
			mv,
			[
				'id',
				'account',
				'time',
				'date',
				'kind',
				'asset',
				'amount',
				'value',
				'txHash',
				'ref',
				'network',
				'counterparty',
				'memo',
				'sourceType',
				'explorerUrl'
			],
			path,
			out
		);
		if (!isText(mv.id)) out.push(`${path}: id missing`);
		if (!isText(mv.account)) out.push(`${path}: account missing`);
		else if (!ids.has(mv.account)) out.push(`${path}: account "${mv.account}" is not in the file`);
		if (!isDateTime(mv.time)) out.push(`${path}: time is no date-time`);
		if (!isDate(mv.date)) out.push(`${path}: date is no date`);
		if (!KINDS.has(mv.kind)) out.push(`${path}: kind "${mv.kind}" is unknown`);
		const asset = mv.asset;
		if (!isObject(asset)) out.push(`${path}: asset missing`);
		else {
			onlyKnown(asset, ['symbol', 'decimals', 'caip19'], `${path}.asset`, out);
			if (typeof asset.symbol !== 'string' || !SYMBOL.test(asset.symbol)) {
				out.push(`${path}.asset: symbol is no symbol`);
			}
			if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) {
				out.push(`${path}.asset: decimals out of range`);
			}
			if ('caip19' in asset && (typeof asset.caip19 !== 'string' || !CAIP19.test(asset.caip19))) {
				out.push(`${path}.asset: caip19 is no CAIP-19 id`);
			}
		}
		if (typeof mv.amount !== 'string' || !DECIMAL.test(mv.amount)) {
			out.push(`${path}: amount is no decimal text`);
		} else if (
			isObject(asset) &&
			Number.isInteger(asset.decimals) &&
			(mv.amount.split('.')[1] ?? '').length > asset.decimals
		) {
			out.push(`${path}: amount has more decimals than ${asset.symbol}`);
		}
		if (mv.value !== null) {
			const v = mv.value;
			if (!isObject(v)) out.push(`${path}: value is neither an object nor null`);
			else {
				onlyKnown(v, ['amount', 'rate', 'source', 'at', 'ref'], `${path}.value`, out);
				for (const k of ['amount', 'rate']) {
					if (typeof v[k] !== 'string' || !DECIMAL.test(v[k])) {
						out.push(`${path}.value: ${k} is no decimal text`);
					}
				}
				if (!isText(v.source)) out.push(`${path}.value: source missing`);
				if (!isDateTime(v.at)) out.push(`${path}.value: at is no date-time`);
				if ('ref' in v && typeof v.ref !== 'string') out.push(`${path}.value: ref is no text`);
			}
		}
		for (const k of ['txHash', 'ref', 'memo', 'sourceType']) {
			if (k in mv && !isText(mv[k])) out.push(`${path}: ${k} is empty or no text`);
		}
		if ('network' in mv && typeof mv.network !== 'string') out.push(`${path}: network is no text`);
		if ('counterparty' in mv) {
			const c = mv.counterparty;
			if (!isObject(c)) out.push(`${path}: counterparty is no object`);
			else {
				onlyKnown(c, ['address', 'name'], `${path}.counterparty`, out);
				for (const k of ['address', 'name']) {
					if (k in c && !isText(c[k])) out.push(`${path}.counterparty: ${k} is empty`);
				}
			}
		}
		if (
			'explorerUrl' in mv &&
			(typeof mv.explorerUrl !== 'string' || !mv.explorerUrl.startsWith('https://'))
		) {
			out.push(`${path}: explorerUrl is no https link`);
		}
	});
	return out;
}

/**
 * `-105.004` → -10500: a decimal amount in whole cents, half away from zero.
 *
 * @param {string} amount
 */
export function toCents(amount) {
	const negative = amount.startsWith('-');
	const [int, frac = ''] = amount.replace(/^-/, '').split('.');
	let cents = BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
	if ((frac[2] ?? '0') >= '5') cents += 1n;
	return Number(negative ? -cents : cents);
}

/**
 * Where a file account is booked in Belege, or why it is not.
 *
 * @param {Rec} a the file's account
 * @returns {{ kind: 'wallet', chain: import('../wallets/chains.js').WalletChain, address: string } | { kind: 'kraken', earn: boolean } | { skipped: string }}
 */
function targetOf(a) {
	if (a.type === 'wallet') {
		const chain = Object.values(WALLET_CHAINS).find((c) => c.caip2 === a.chain);
		if (!chain) return { skipped: `chain ${a.chain}` };
		try {
			return { kind: 'wallet', chain, address: normalizeAddress(chain, a.address) };
		} catch {
			return { skipped: `address ${a.address}` };
		}
	}
	if (a.exchange === 'kraken') return { kind: 'kraken', earn: a.id === 'kraken/earn' };
	return { skipped: `exchange ${a.exchange}` };
}

/**
 * The Belege account for one asset of a file account: the one there is, else
 * a new one as the source's sync would make it. An existing account is used
 * as it is – its decimals decide how a quantity is kept.
 *
 * @param {import('../store/repository.js').Collection} accounts
 * @param {NonNullable<ReturnType<typeof targetOf>>} target
 * @param {Rec} asset the movement's asset
 */
async function accountFor(accounts, target, asset) {
	if ('skipped' in target) throw new Error('no target');
	const symbol = asset.symbol;
	const input =
		target.kind === 'wallet'
			? {
					source: target.chain.id,
					sourceAccountId: `${target.address}:${symbol}`,
					ibanLast4: '',
					name: walletAccountName(target.chain, symbol, target.address),
					currency: 'EUR',
					kind: 'wallet',
					asset: symbol,
					decimals: asset.decimals,
					walletAddress: target.address,
					...(() => {
						// A token the chain's list does not name: kept by its contract, as a sync keeps it.
						const m = /\/erc20:(0x[0-9a-fA-F]{40})$/.exec(String(asset.caip19 ?? ''));
						const contract = m?.[1].toLowerCase();
						return target.chain.kind === 'evm' &&
							contract &&
							target.chain.tokens?.[symbol] !== contract
							? { tokenContract: contract }
							: {};
					})()
				}
			: {
					source: 'kraken',
					sourceAccountId: accountKey(symbol, target.earn ? 'earn' : 'spot'),
					ibanLast4: '',
					name: accountName(symbol, target.earn ? 'earn' : 'spot'),
					currency: 'EUR',
					kind: 'exchange',
					asset: symbol,
					decimals: asset.decimals
				};
	const [found] = await accounts.list({
		where: (/** @type {Rec} */ r) =>
			r.source === input.source && r.sourceAccountId === input.sourceAccountId
	});
	return found ?? (await accounts.put(input));
}

/**
 * One movement as the booking its source's sync would write.
 *
 * @param {Rec} m
 * @param {Rec} account the Belege account
 * @param {'wallet' | 'kraken'} kind
 * @param {string} currency the file's
 * @returns {import('../bank/import.js').IncomingTransaction}
 */
function incomingOf(m, account, kind, currency) {
	const base = {
		sourceId: m.id,
		date: m.date,
		bookedAt: m.time,
		valueDate: m.date,
		currency: 'EUR'
	};
	// An exchange's euro leg: euros, no quantity.
	if (m.asset.symbol === currency) {
		const label = kind === 'kraken' ? krakenLabel(m) : null;
		return {
			...base,
			amountCents: toCents(m.amount),
			counterpartyName: 'Kraken',
			purpose: `${label?.label ?? m.kind}${m.ref ? ` · Ref. ${m.ref}` : ''}`,
			bookingType: label?.label ?? '',
			movement: label?.movement ?? 'transfer',
			txRef: m.ref ?? '',
			...(m.sourceType ? { exchangeType: m.sourceType } : {})
		};
	}
	const decimals = Number.isInteger(account.decimals) ? account.decimals : m.asset.decimals;
	const crypto = {
		asset: m.asset.symbol,
		quantity: toUnits(m.amount, decimals),
		decimals,
		valuation: m.value
			? /** @type {import('../assets/valuation.js').Valuation} */ ({
					rate: m.value.rate,
					currency: 'EUR',
					source: m.value.source,
					at: m.value.at,
					...(m.value.ref ? { ref: m.value.ref } : {})
				})
			: null
	};
	const value = m.value
		? { amountCents: toCents(m.value.amount) }
		: // eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
			{ amountCents: 0, rateMissing: { reason: 'kein Kurs in der Datei' } };
	if (kind === 'kraken') {
		const { label, movement } = krakenLabel(m);
		return {
			...base,
			...value,
			counterpartyName: 'Kraken',
			purpose: `${label}${m.ref ? ` · Ref. ${m.ref}` : ''}`,
			bookingType: label,
			movement,
			txRef: m.ref ?? '',
			...(m.sourceType ? { exchangeType: m.sourceType } : {}),
			...(m.txHash ? { chainTxRef: m.txHash } : {}),
			...(m.txHash && m.network ? { chainMethod: m.network } : {}),
			crypto
		};
	}
	const entry = {
		type: m.kind === 'fee' ? 'fee' : m.amount.startsWith('-') ? 'sent' : 'received',
		kind: m.kind === 'trade' ? 'swap' : m.kind,
		success: true,
		counterparty: m.counterparty?.address ?? ''
	};
	const { label, movement } = describeWalletEntry(/** @type {any} */ (entry));
	const address = m.counterparty?.address ?? '';
	return {
		...base,
		...value,
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		counterpartyName: m.kind === 'fee' ? 'Netzwerkgebühr' : (m.counterparty?.name ?? address),
		...(address ? { counterpartyAddress: address } : {}),
		purpose: [label, m.memo ? `Memo: ${m.memo}` : '', m.txHash ? `Tx ${shortHash(m.txHash)}` : '']
			.filter(Boolean)
			.join(' · '),
		bookingType: label,
		movement,
		txRef: m.txHash ?? '',
		explorerUrl: safeExplorerUrl(m.explorerUrl) ?? '',
		crypto
	};
}

/**
 * Kraken's label for a movement: by the entry's own type where the file
 * keeps it (`withdrawal`, `earn/reward`), else by its kind and direction.
 *
 * @param {Rec} m
 * @returns {{ label: string, movement: 'transfer' | 'trade' | 'reward' | 'fee' }}
 */
function krakenLabel(m) {
	// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
	if (m.kind === 'fee') return { label: 'Gebühr', movement: 'fee' };
	const [type, subtype = ''] = m.sourceType
		? String(m.sourceType).split('/')
		: [
				m.kind === 'trade' || m.kind === 'swap'
					? 'trade'
					: m.kind === 'reward' || m.kind === 'stake'
						? 'staking'
						: m.amount.startsWith('-')
							? 'withdrawal'
							: 'deposit'
			];
	return describeEntry(/** @type {any} */ ({ type, subtype }));
}

/**
 * Import a crypto-ledger file.
 *
 * @param {object} params
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {string} params.text the file's content
 * @returns {Promise<{ accounts: { accountId: string, name: string, counts: { new: number, updated: number, skipped: number } }[], new: number, updated: number, skipped: number, unpriced: number, left: { account: string, reason: string, movements: number }[] }>}
 *   `left`: file accounts on a chain or exchange Belege does not read, with how many movements were left out
 */
export async function importCryptoLedger({ store, text }) {
	if (text.length > MAX_BYTES) throw new Error('The file is too large for a crypto-ledger file.');
	/** @type {unknown} */
	let doc;
	try {
		doc = JSON.parse(text.replace(/^\uFEFF/, ''));
	} catch {
		throw new Error('Not a crypto-ledger file: no JSON.');
	}
	const problems = checkCryptoLedger(doc);
	if (problems.length) {
		const more = problems.length > 5 ? ` (+${problems.length - 5})` : '';
		throw new Error(`Not a valid crypto-ledger file: ${problems.slice(0, 5).join('; ')}${more}`);
	}
	const ledger = /** @type {Rec} */ (doc);
	if (ledger.currency !== 'EUR') {
		throw new Error(`Belege books in EUR; this file is valued in ${ledger.currency}.`);
	}

	const targets = new Map(ledger.accounts.map((/** @type {Rec} */ a) => [a.id, targetOf(a)]));
	/** @type {Map<string, { account: Rec, kind: 'wallet' | 'kraken', incoming: any[] }>} */
	const byAccount = new Map();
	/** @type {Map<string, number>} */
	const leftCount = new Map();
	let unpriced = 0;
	for (const m of ledger.movements) {
		const target = targets.get(m.account);
		if (!target || 'skipped' in target) {
			leftCount.set(m.account, (leftCount.get(m.account) ?? 0) + 1);
			continue;
		}
		const account = await accountFor(store.accounts, target, m.asset);
		const entry = byAccount.get(account.id) ?? {
			account,
			kind: target.kind,
			incoming: /** @type {any[]} */ ([])
		};
		entry.incoming.push(incomingOf(m, account, target.kind, ledger.currency));
		if (m.value === null && m.asset.symbol !== ledger.currency) unpriced++;
		byAccount.set(account.id, entry);
	}

	/** @type {{ accountId: string, name: string, counts: { new: number, updated: number, skipped: number } }[]} */
	const results = [];
	for (const { account, kind, incoming } of byAccount.values()) {
		const known = new Set(
			(
				await store.transactions.list({
					includeDeleted: true,
					where: (/** @type {Rec} */ r) => r.accountId === account.id
				})
			).map((/** @type {Rec} */ r) => r.sourceId)
		);
		const fresh = incoming.filter((tx) => !known.has(tx.sourceId));
		const counts = await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: {
				id: account.id,
				source: account.source,
				fingerprintAccount: `${kind === 'kraken' ? 'kraken' : account.source}:${account.sourceAccountId}`
			},
			incoming: fresh
		});
		counts.skipped += incoming.length - fresh.length;
		results.push({ accountId: account.id, name: account.name, counts });
	}
	const sum = (/** @type {'new' | 'updated' | 'skipped'} */ k) =>
		results.reduce((n, r) => n + r.counts[k], 0);
	if (results.length) {
		await recordEvent(store.events, 'bank-sync', {
			source: 'crypto-ledger',
			accounts: results.length,
			accountIds: results.map((r) => r.accountId),
			new: sum('new'),
			updated: sum('updated'),
			skipped: sum('skipped')
		});
	}
	const left = ledger.accounts
		.filter((/** @type {Rec} */ a) => 'skipped' in /** @type {Rec} */ (targets.get(a.id)))
		.map((/** @type {Rec} */ a) => ({
			account: a.id,
			reason: /** @type {any} */ (targets.get(a.id)).skipped,
			movements: leftCount.get(a.id) ?? 0
		}));
	return {
		accounts: results,
		new: sum('new'),
		updated: sum('updated'),
		skipped: sum('skipped'),
		unpriced,
		left
	};
}
