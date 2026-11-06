// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/ledger: the one booking format of Le Space's tools (Belege, the
// Eigenbeleg API and web UI). Every chain reader produces it, every output
// (an Eigenbeleg, a Kontoauszug, a CSV, Belege's books) reads it.
//
// Two shapes, one meaning:
//   - `WalletEntry` (./wallet-entry.js): what a reader hands out for one
//     wallet. One entry per movement of value, signed from the wallet's side,
//     the fee as an entry of its own. It does not say which chain or account
//     it belongs to: the caller knows.
//   - `LedgerEntry` (below): the same movement with that context – chain,
//     network, the own account – and a schema version, so it can stand on its
//     own in a file, a CSV or another program. `fromWalletEntry` makes one.
//
// Versioned: `schema` names the version; a change to the meaning of a field
// bumps it. `le-space.ledger/1` has the fields of Eigenbeleg's
// `eigenbeleg.ledger/1` (Le-Space/eigenbeleg-agent packages/ledger-core) plus
// WalletEntry's optional details; `entry()` takes either and gives version 1.
//
// Amounts are decimal strings, never floats: a NEAR amount has 24 decimals,
// more than a JavaScript number keeps.

export const SCHEMA = 'le-space.ledger/1';
/** Earlier names of the same version, read as it. */
export const SCHEMA_ALIASES = Object.freeze(['eigenbeleg.ledger/1']);

export { fromBase64, toBase64, fromHex, toHex, utf8, fromUtf8 } from './bytes.js';
export { normalize, fromUnits, toUnits, sum, multiply, round, unitsToDecimal } from './decimal.js';

import { normalize } from './decimal.js';

/** @typedef {import('./wallet-entry.js').WalletEntry} WalletEntry */
/** @typedef {'sent' | 'received' | 'fee'} EntryType */
/**
 * What a movement is. `ibc` (Cosmos: across chains) comes from Belege's
 * readers; `call`, `unstake`, `storage`, `escrow` from Eigenbeleg's NEAR and
 * Akash readers.
 *
 * @typedef {'transfer' | 'fee' | 'reward' | 'stake' | 'unstake' | 'ibc' | 'swap' | 'call' | 'storage' | 'escrow'} EntryKind
 */

export const TYPES = Object.freeze(['sent', 'received', 'fee']);
export const KINDS = Object.freeze([
	'transfer',
	'fee',
	'reward',
	'stake',
	'unstake',
	'ibc',
	'swap',
	'call',
	'storage',
	'escrow'
]);

/**
 * @typedef {object} LedgerEntry
 * @property {string} schema SCHEMA
 * @property {string} id stable across reads: `<chain>:<account>:<the reader's id>`
 * @property {string} chain e.g. `near`, `akash`, `ethereum`
 * @property {string} network e.g. `mainnet`, `testnet`
 * @property {string} account the own address this entry is seen from
 * @property {string} hash the transaction hash, in full
 * @property {number} height block height
 * @property {string} time ISO 8601, UTC
 * @property {string} date YYYY-MM-DD, UTC
 * @property {EntryType} type
 * @property {EntryKind} kind
 * @property {string} asset symbol, e.g. `NEAR`, `USDC`
 * @property {string} contract `native`, or the token's contract
 * @property {number} decimals
 * @property {string} amount signed decimal: negative for sent and fee
 * @property {string} counterparty the other address; for a fee the network
 * @property {string} counterpartyLabel a known name for it, or ''
 * @property {string} method the contract method called, or ''
 * @property {string} memo
 * @property {boolean} success
 * @property {string} explorerUrl
 * @property {string} priceAs the market asset that values it (`NEAR`, `USDC`, …), '' for a token
 *   without a trusted price (an unknown token, often spam): such an entry is listed, never valued
 * @property {WalletEntry['swap']} [swap] what the wallet gave and got in a swap
 * @property {string} [ibcMemo] Cosmos: an IBC transfer's own memo
 * @property {boolean} [byOther] EVM: sent out in a transaction this address did not send
 * @property {string} [txFrom] EVM: who sent that transaction
 * @property {boolean} [listed] false for a token not in the chain's list: its symbol is its own claim
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;
const OPTIONAL = /** @type {const} */ (['swap', 'ibcMemo', 'byOther', 'txFrom', 'listed']);

/**
 * A checked entry; throws on a field that breaks the format.
 *
 * @param {Omit<LedgerEntry, 'schema' | 'date' | 'priceAs'> & { schema?: string, date?: string, priceAs?: string }} fields
 * @returns {LedgerEntry}
 */
export function entry(fields) {
	if (fields.schema && fields.schema !== SCHEMA && !SCHEMA_ALIASES.includes(fields.schema))
		throw new Error(`entry ${fields.id}: unknown schema ${fields.schema}`);
	const time = new Date(fields.time);
	if (Number.isNaN(time.getTime())) throw new Error(`entry ${fields.id}: bad time`);
	/** @type {LedgerEntry} */
	const e = {
		schema: SCHEMA,
		id: String(fields.id),
		chain: String(fields.chain),
		network: String(fields.network),
		account: String(fields.account),
		hash: String(fields.hash),
		height: Number(fields.height),
		time: time.toISOString(),
		date: time.toISOString().slice(0, 10),
		type: fields.type,
		kind: fields.kind,
		asset: String(fields.asset),
		contract: String(fields.contract || 'native'),
		decimals: Number(fields.decimals),
		amount: normalize(String(fields.amount)),
		counterparty: String(fields.counterparty ?? ''),
		counterpartyLabel: String(fields.counterpartyLabel ?? ''),
		method: String(fields.method ?? ''),
		memo: String(fields.memo ?? ''),
		success: fields.success !== false,
		explorerUrl: String(fields.explorerUrl ?? ''),
		priceAs: String(fields.priceAs ?? '')
	};
	for (const k of OPTIONAL) if (fields[k] !== undefined) /** @type {any} */ (e)[k] = fields[k];
	if (!TYPES.includes(e.type)) throw new Error(`entry ${e.id}: bad type ${e.type}`);
	if (!KINDS.includes(e.kind)) throw new Error(`entry ${e.id}: bad kind ${e.kind}`);
	if (!Number.isInteger(e.decimals) || e.decimals < 0)
		throw new Error(`entry ${e.id}: bad decimals`);
	if (!DECIMAL.test(e.amount)) throw new Error(`entry ${e.id}: bad amount ${e.amount}`);
	if ((e.type === 'sent' || e.type === 'fee') && !e.amount.startsWith('-') && e.amount !== '0')
		throw new Error(`entry ${e.id}: ${e.type} must be negative`);
	if (e.type === 'received' && e.amount.startsWith('-'))
		throw new Error(`entry ${e.id}: received must be positive`);
	return e;
}

/**
 * A reader's WalletEntry with its context → a LedgerEntry. What a product
 * reads differently (Eigenbeleg names an Akash escrow `escrow`, the network
 * as the counterparty of a fee) it hands in as `overrides`.
 *
 * @param {WalletEntry} e
 * @param {{ chain: string, network?: string, account: string, priceAs?: string }} context
 * @param {Partial<Omit<LedgerEntry, 'schema'>>} [overrides]
 * @returns {LedgerEntry}
 */
export function fromWalletEntry(
	e,
	{ chain, network = 'mainnet', account, priceAs = '' },
	overrides = {}
) {
	const listed = e.listed !== false;
	return entry({
		id: `${chain}:${account}:${e.id}`,
		chain,
		network,
		account,
		hash: e.hash,
		height: e.height,
		time: e.time,
		type: e.type,
		kind: e.kind,
		asset: e.asset,
		contract: listed ? 'native' : String(e.contract ?? e.asset),
		decimals: e.decimals,
		amount: e.amount,
		counterparty: e.counterparty,
		counterpartyLabel: e.counterpartyLabel,
		method: '',
		memo: e.memo,
		success: e.success,
		explorerUrl: e.explorerUrl,
		priceAs: listed ? priceAs : '',
		swap: e.swap,
		ibcMemo: e.ibcMemo,
		byOther: e.byOther,
		txFrom: e.txFrom,
		listed: e.listed,
		...overrides
	});
}

/** Oldest first; within a transaction the fee last. @param {LedgerEntry[]} entries */
export function sortEntries(entries) {
	return [...entries].sort(
		(a, b) =>
			a.time.localeCompare(b.time) ||
			a.hash.localeCompare(b.hash) ||
			Number(a.type === 'fee') - Number(b.type === 'fee') ||
			a.id.localeCompare(b.id)
	);
}

/**
 * The entries of one period, both ends included.
 *
 * @template {{ date: string }} E
 * @param {E[]} entries @param {string} from YYYY-MM-DD @param {string} to YYYY-MM-DD
 */
export function inPeriod(entries, from, to) {
	return entries.filter((e) => e.date >= from && e.date <= to);
}

/** `2026-10` → { from: '2026-10-01', to: '2026-10-31' }. @param {string} month YYYY-MM */
export function monthPeriod(month) {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`bad month ${month}`);
	const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export { derivedStatement } from './statement.js';
