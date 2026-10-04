// "Kryptobewegungen": the crypto bookings – own wallets and exchange accounts –
// in the open crypto-ledger format (schema/crypto-ledger.v1.schema.json, MIT),
// as JSON or as CSV, so other tools can read what Belege read (issue #267).
//
// Written from the books, not from the sources: what is exported is what was
// booked, valued as it was booked. One account in the file per wallet (CAIP-10)
// or exchange account – Belege keeps one per asset, the file one per address –
// and one movement per booking, the fee apart as it is booked apart.

import { fromUnits } from '../assets/quantity.js';
import { walletChain } from '../wallets/chains.js';

export const FORMAT = 'crypto-ledger';
export const VERSION = 1;

/** @typedef {Record<string, any>} Rec */

/** How an exchange is named, by its ccxt id. */
const EXCHANGES = /** @type {Readonly<Record<string, string>>} */ (
	Object.freeze({ kraken: 'Kraken' })
);

/** Cents → `-105.00`. @param {number} cents */
const euros = (cents) => {
	const abs = Math.abs(Math.round(cents));
	return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/**
 * The file's account for a Belege account, or null for one that holds no crypto.
 *
 * @param {Rec} a
 * @param {Map<string, Rec>} wallets the wallet list (settings `wallets`) by `<chain>:<address>`
 * @returns {Rec | null}
 */
function ledgerAccount(a, wallets) {
	const chain = a.kind === 'wallet' ? walletChain(a.source) : null;
	if (chain && a.walletAddress) {
		const w = wallets.get(`${chain.id}:${a.walletAddress}`);
		return {
			id: `${chain.caip2}:${a.walletAddress}`,
			type: 'wallet',
			name: w?.name || `${chain.name} ···${String(a.walletAddress).slice(-6)}`,
			chain: chain.caip2,
			address: a.walletAddress
		};
	}
	if (a.kind === 'exchange' && /^[a-z0-9]+$/.test(String(a.source ?? ''))) {
		const earn = String(a.sourceAccountId ?? '').endsWith('.earn');
		const name = EXCHANGES[a.source] ?? a.source;
		return {
			id: earn ? `${a.source}/earn` : a.source,
			type: 'exchange',
			name: earn ? `${name} (Earn)` : name,
			exchange: a.source
		};
	}
	return null;
}

/**
 * A booking's asset as CAIP-19, where it is unambiguous: a wallet's native
 * asset by its SLIP-44 coin type, a token by its contract. An exchange's
 * assets are on no particular chain.
 *
 * @param {Rec} account the Belege account
 * @param {string} symbol
 */
function caip19(account, symbol) {
	const chain = account.kind === 'wallet' ? walletChain(account.source) : null;
	if (!chain) return null;
	const contract = account.tokenContract || chain.tokens?.[symbol];
	if (chain.kind === 'evm' && contract) return `${chain.caip2}/erc20:${contract}`;
	if (symbol === chain.nativeSymbol && chain.nativeSlip44 !== null) {
		return `${chain.caip2}/slip44:${chain.nativeSlip44}`;
	}
	return null;
}

/** @param {Rec} tx */
function kindOf(tx) {
	switch (tx.movement) {
		case 'trade':
			return tx.swap ? 'swap' : 'trade';
		case 'fee':
		case 'stake':
			return tx.movement;
		case 'reward':
			// The label as stored in the books (wallet-sync.js describeWalletEntry).
			return tx.bookingType === 'Mining-Ertrag' ? 'mining' : 'reward';
		default:
			return 'transfer';
	}
}

/** A wallet booking's memo, from its purpose (`<label> · Memo: <memo> · Tx <hash>`). @param {string} purpose */
const memoOf = (purpose) => /(?:^| · )Memo: (.*) · Tx \S+$/.exec(purpose)?.[1] ?? '';

/**
 * One booking as a movement of the file.
 *
 * @param {Rec} tx
 * @param {Rec} account the Belege account
 * @param {Rec} into the file's account
 * @param {string} currency
 */
function movement(tx, account, into, currency) {
	const kind = kindOf(tx);
	const time = typeof tx.bookedAt === 'string' ? tx.bookedAt : `${tx.bookedOn}T00:00:00Z`;
	/** @type {Rec} */
	let asset;
	/** @type {string} */
	let amount;
	/** @type {Rec | null} */
	let value = null;
	if (tx.asset && typeof tx.quantity === 'string' && Number.isInteger(tx.decimals)) {
		asset = { symbol: tx.asset, decimals: tx.decimals };
		const id = caip19(account, tx.asset);
		if (id) asset.caip19 = id;
		amount = fromUnits(tx.quantity, tx.decimals);
		if (tx.valuation && !tx.rateMissing) {
			value = {
				amount: euros(tx.amountCents),
				rate: tx.valuation.rate,
				source: tx.valuation.source,
				at: tx.valuation.at,
				...(tx.valuation.ref ? { ref: tx.valuation.ref } : {})
			};
		}
	} else {
		// An exchange's euro leg: the file's own currency, worth itself.
		asset = { symbol: tx.currency || currency, decimals: 2 };
		amount = euros(tx.amountCents);
		value = { amount, rate: '1', source: 'currency', at: time };
	}
	/** @type {Rec} */
	const out = {
		id: tx.sourceId || tx.id,
		account: into.id,
		time,
		date: tx.bookedOn,
		kind,
		asset,
		amount,
		value
	};
	if (into.type === 'wallet') {
		if (tx.txRef) out.txHash = tx.txRef;
		/** @type {Rec} */
		const party = {};
		if (tx.counterpartyAddress) party.address = tx.counterpartyAddress;
		if (kind !== 'fee' && tx.counterparty && tx.counterparty !== tx.counterpartyAddress) {
			party.name = tx.counterparty;
		}
		if (Object.keys(party).length) out.counterparty = party;
		const memo = memoOf(String(tx.purpose ?? ''));
		if (memo) out.memo = memo;
	} else {
		if (tx.chainTxRef) out.txHash = tx.chainTxRef;
		if (tx.txRef) out.ref = tx.txRef;
		if (tx.chainMethod) out.network = tx.chainMethod;
		if (tx.exchangeType) out.sourceType = tx.exchangeType;
	}
	if (typeof tx.explorerUrl === 'string' && tx.explorerUrl.startsWith('https://')) {
		out.explorerUrl = tx.explorerUrl;
	}
	return out;
}

/**
 * The crypto bookings as a crypto-ledger file.
 *
 * @param {object} params
 * @param {Rec[]} params.accounts
 * @param {Rec[]} params.transactions
 * @param {Rec[]} [params.wallets] the wallet list (settings `wallets`), for the names given to them
 * @param {string | null} [params.year] only this year's bookings (`2025`); null: all
 * @param {string} [params.generator] e.g. `Belege 0.6.0`
 * @param {Date} [params.now]
 */
export function cryptoLedger({
	accounts,
	transactions,
	wallets = [],
	year = null,
	generator,
	now = new Date()
}) {
	const currency = 'EUR';
	const byWallet = new Map(wallets.map((w) => [`${w.chain}:${w.address}`, w]));
	/** @type {Map<string, { account: Rec, into: Rec }>} */
	const crypto = new Map();
	for (const a of accounts) {
		const into = ledgerAccount(a, byWallet);
		if (into) crypto.set(a.id, { account: a, into });
	}
	/** @type {Map<string, Rec>} */
	const used = new Map();
	const movements = transactions
		.filter(
			(tx) =>
				!tx.deleted &&
				crypto.has(tx.accountId) &&
				/^\d{4}-\d{2}-\d{2}$/.test(String(tx.bookedOn ?? '')) &&
				(!year || String(tx.bookedOn).startsWith(`${year}-`))
		)
		.map((tx) => {
			const { account, into } = /** @type {{ account: Rec, into: Rec }} */ (
				crypto.get(tx.accountId)
			);
			used.set(into.id, into);
			return movement(tx, account, into, currency);
		})
		.sort((a, b) =>
			a.time === b.time ? (a.id < b.id ? -1 : 1) : Date.parse(a.time) - Date.parse(b.time)
		);
	return {
		format: FORMAT,
		version: VERSION,
		createdAt: now.toISOString(),
		...(generator ? { generator } : {}),
		currency,
		accounts: [...used.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
		movements
	};
}

export const CSV_COLUMNS = /** @type {const} */ ([
	'date',
	'time',
	'account',
	'account_name',
	'kind',
	'asset',
	'asset_id',
	'amount',
	'value',
	'currency',
	'rate',
	'rate_source',
	'rate_at',
	'tx_hash',
	'ref',
	'network',
	'counterparty_address',
	'counterparty_name',
	'memo',
	'source_type',
	'explorer_url',
	'id'
]);

/** Text a spreadsheet would take for a formula gets a leading apostrophe. @param {string} text */
const inert = (text) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

/** @param {string} field */
const quoted = (field) => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);

/**
 * The same file as CSV: one row per movement, RFC 4180 (comma, CRLF, UTF-8),
 * decimal points, the account's name next to its id.
 *
 * @param {ReturnType<typeof cryptoLedger>} ledger
 */
export function cryptoLedgerCsv(ledger) {
	const names = new Map(ledger.accounts.map((a) => [a.id, a.name]));
	const rows = ledger.movements.map((m) => {
		/** @type {Record<(typeof CSV_COLUMNS)[number], string>} */
		const row = {
			date: m.date,
			time: m.time,
			account: m.account,
			account_name: inert(names.get(m.account) ?? ''),
			kind: m.kind,
			asset: m.asset.symbol,
			asset_id: m.asset.caip19 ?? '',
			amount: m.amount,
			value: m.value?.amount ?? '',
			currency: ledger.currency,
			rate: m.value?.rate ?? '',
			rate_source: m.value?.source ?? '',
			rate_at: m.value?.at ?? '',
			tx_hash: m.txHash ?? '',
			ref: m.ref ?? '',
			network: inert(m.network ?? ''),
			counterparty_address: inert(m.counterparty?.address ?? ''),
			counterparty_name: inert(m.counterparty?.name ?? ''),
			memo: inert(m.memo ?? ''),
			source_type: inert(m.sourceType ?? ''),
			explorer_url: m.explorerUrl ?? '',
			id: m.id
		};
		return CSV_COLUMNS.map((c) => quoted(row[c])).join(',');
	});
	return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
