// Bank transactions into the sealed store, without duplicates.
//
// A transaction is the same as one already stored when
//   1. source, account and sourceId match (Hibiscus id, CAMT AcctSvcrRef), or
//   2. failing that, when one of the two has no sourceId: the fingerprint
//      matches (see fingerprint.js), counting repeats — the second identical
//      coffee on the same day is `fingerprintSeq` 1, not a duplicate of the first.
// Two records that both have a sourceId and differ in it are never merged.
//
// A match whose fields changed (Hibiscus fills in a value date later, say) is
// updated in place; one that did not is skipped. A soft-deleted record still
// counts as known: deleting a booking and syncing again does not bring it back.

import { recordEvent } from '../activity/events.js';
import { fingerprint as computeFingerprint, ibanKey } from './fingerprint.js';

/** An ISO 8601 time with its offset, as `bookedAt` keeps it. @param {unknown} v */
export const isIsoTime = (v) =>
	typeof v === 'string' &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
	Number.isFinite(Date.parse(v));

/** The fields an import owns. Anything else on a record (a receipt link) stays. */
const FIELDS = /** @type {const} */ ([
	'accountId',
	'source',
	'sourceId',
	'fingerprint',
	'fingerprintSeq',
	'bookedOn',
	'bookedAt',
	'valueDate',
	'amountCents',
	'currency',
	'counterparty',
	'counterpartyIban',
	'purpose',
	'endToEndId',
	'bookingType',
	'bankCode',
	// an exchange or wallet booking; absent on bank transactions
	'movement',
	'txRef',
	'chainTxRef',
	'exchangeType',
	// an own wallet's booking: the other side's address, the transaction in the explorer
	'counterpartyAddress',
	'explorerUrl',
	// a crypto movement (assets/valuation.js)
	'asset',
	'quantity',
	'decimals',
	'valuation'
]);

/**
 * @typedef {object} IncomingTransaction normalised, from the bridge or the CAMT parser
 * @property {string | null} sourceId
 * @property {string | null} date
 * @property {string | null} [valueDate]
 * @property {number} amountCents
 * @property {string} [bookedAt] ISO 8601 with offset: the time, where the source knows it
 * @property {string} [currency]
 * @property {string} [counterpartyName]
 * @property {string} [counterpartyIban]
 * @property {string} [purpose]
 * @property {string} [endToEndId]
 * @property {string} [bookingType]
 * @property {string} [bankCode] ISO 20022 domain/family/sub-family (CAMT only)
 * @property {string} [fingerprint] the bridge sends it; computed when missing
 * @property {'transfer' | 'trade' | 'fee' | 'reward' | 'stake'} [movement] on an exchange or a wallet
 * @property {string} [txRef] transaction hash or the exchange's reference, shared by the legs of a trade
 * @property {string} [chainTxRef] an exchange's deposit or withdrawal: the on-chain hash, to pair it with a wallet
 * @property {string} [exchangeType] as the exchange names the entry, e.g. `transfer/spottostaking`
 * @property {string} [counterpartyAddress] an own wallet's booking: the other side's address on the chain
 * @property {string} [explorerUrl] an own wallet's booking: the transaction in the block explorer (https)
 * @property {CryptoFields} [crypto] for a crypto asset: what moved and how `amountCents`
 *   (EUR) was valued; see assets/valuation.js
 */

/**
 * @typedef {object} CryptoFields
 * @property {string} asset symbol, assets/registry.js
 * @property {string} quantity signed integer of the smallest unit, as a string
 * @property {number} decimals
 * @property {import('../assets/valuation.js').Valuation} valuation
 */

/**
 * @typedef {{ new: number, updated: number, skipped: number }} ImportCounts
 */

/**
 * An object's keys in one order: the store hands records back with their
 * keys sorted (dag-cbor), so `{ rate, currency, source, at }` must equal
 * `{ at, rate, source, currency }` – else every re-sync "updates" every
 * crypto booking.
 *
 * @param {unknown} v
 */
const comparable = (v) =>
	v === null || v === undefined
		? ''
		: typeof v === 'object'
			? JSON.stringify(v, (_key, value) =>
					value && typeof value === 'object' && !Array.isArray(value)
						? Object.fromEntries(
								Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
							)
						: value
				)
			: v;
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => comparable(a) === comparable(b);

/**
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.transactions
 * @param {{ id: string, source: string, fingerprintAccount: string }} params.account
 *   source: 'hibiscus', 'camt', 'kraken', or a wallet's chain (wallets/chains.js)
 *   the stored account record's id, its source, and the account key the fingerprint uses
 * @param {IncomingTransaction[]} params.incoming
 * @returns {Promise<ImportCounts>}
 */
export async function importTransactions({ transactions, account, incoming }) {
	const existing = await transactions.list({
		includeDeleted: true,
		where: (r) => r.accountId === account.id && r.source === account.source
	});

	/** @type {Map<string, import('../store/repository.js').StoredRecord>} */
	const bySourceId = new Map();
	/** @type {Map<string, import('../store/repository.js').StoredRecord>} */
	const byFingerprint = new Map();
	for (const r of existing) {
		if (r.sourceId) bySourceId.set(String(r.sourceId), r);
		if (r.fingerprint) byFingerprint.set(`${r.fingerprint}#${r.fingerprintSeq ?? 0}`, r);
	}
	/** Records matched in this run; each stored record answers for one incoming at most. */
	const claimed = new Set();
	/** @type {Map<string, number>} */
	const seen = new Map();
	/** @type {ImportCounts} */
	const counts = { new: 0, updated: 0, skipped: 0 };

	for (const tx of incoming) {
		if (!tx.date || !Number.isSafeInteger(tx.amountCents)) {
			counts.skipped++;
			continue;
		}
		const fp =
			tx.fingerprint ??
			(await computeFingerprint({
				account: account.fingerprintAccount,
				date: tx.date,
				amountCents: tx.amountCents,
				purpose: tx.purpose,
				counterpartyName: tx.counterpartyName
			}));
		const seq = seen.get(fp) ?? 0;
		seen.set(fp, seq + 1);

		const fields = {
			accountId: account.id,
			source: account.source,
			sourceId: tx.sourceId || null,
			fingerprint: fp,
			fingerprintSeq: seq,
			bookedOn: tx.date,
			...(isIsoTime(tx.bookedAt) ? { bookedAt: tx.bookedAt } : {}),
			valueDate: tx.valueDate || tx.date,
			amountCents: tx.amountCents,
			currency: tx.currency || 'EUR',
			counterparty: tx.counterpartyName ?? '',
			counterpartyIban: tx.counterpartyIban ?? '',
			purpose: tx.purpose ?? '',
			endToEndId: tx.endToEndId ?? '',
			bookingType: tx.bookingType ?? '',
			bankCode: tx.bankCode ?? '',
			...(tx.movement ? { movement: tx.movement, txRef: tx.txRef ?? '' } : {}),
			...(tx.chainTxRef ? { chainTxRef: tx.chainTxRef } : {}),
			...(tx.exchangeType ? { exchangeType: tx.exchangeType } : {}),
			...(tx.counterpartyAddress ? { counterpartyAddress: tx.counterpartyAddress } : {}),
			...(tx.explorerUrl ? { explorerUrl: tx.explorerUrl } : {}),
			...(tx.crypto
				? {
						asset: tx.crypto.asset,
						quantity: tx.crypto.quantity,
						decimals: tx.crypto.decimals,
						valuation: tx.crypto.valuation
					}
				: {})
		};

		let match = fields.sourceId ? bySourceId.get(fields.sourceId) : undefined;
		if (match && claimed.has(match.id)) match = undefined;
		const bySource = Boolean(match);
		if (!match) {
			const candidate = byFingerprint.get(`${fp}#${seq}`);
			if (
				candidate &&
				!claimed.has(candidate.id) &&
				(!candidate.sourceId || !fields.sourceId || candidate.sourceId === fields.sourceId)
			) {
				match = candidate;
			}
		}

		if (!match) {
			const created = await transactions.put(fields);
			claimed.add(created.id);
			if (created.sourceId) bySourceId.set(String(created.sourceId), created);
			byFingerprint.set(`${fp}#${seq}`, created);
			counts.new++;
			continue;
		}

		claimed.add(match.id);
		// A stored sourceId is kept when the incoming one is missing.
		const next = {
			...fields,
			sourceId: fields.sourceId ?? match.sourceId ?? null,
			// Matched by id: its repeat count is whatever it was. A shorter sync
			// window can shift the count, and that is no change.
			fingerprintSeq: bySource ? (match.fingerprintSeq ?? seq) : seq
		};
		const changed = FIELDS.some(
			(f) => !same(/** @type {any} */ (next)[f], /** @type {any} */ (match)[f])
		);
		if (changed && !match.deleted) {
			await transactions.put({ ...match, ...next });
			counts.updated++;
		} else {
			counts.skipped++;
		}
	}

	return counts;
}

/**
 * Find or create the account record for a source's account.
 *
 * @param {import('../store/repository.js').Collection} accounts
 * @param {{ source: string, sourceAccountId: string, ibanLast4: string, name: string, currency: string, kind?: 'exchange' | 'wallet', asset?: string, decimals?: number }} input
 *   `kind`, `asset`, `decimals`: an account on an exchange or a wallet, holding one asset
 */
export async function upsertAccount(accounts, input) {
	const [found] = await accounts.list({
		where: (a) => a.source === input.source && a.sourceAccountId === input.sourceAccountId
	});
	if (!found) return accounts.put({ ...input });
	const changed = /** @type {const} */ ([
		'ibanLast4',
		'name',
		'currency',
		'kind',
		'asset',
		'decimals'
	]).some((f) => !same(found[f], /** @type {any} */ (input)[f]));
	return changed ? accounts.put({ ...found, ...input }) : found;
}

/**
 * A CAMT statement's account: keyed by a hash of its IBAN, so the full IBAN
 * is not kept even inside the sealed store.
 *
 * @param {{ iban: string, currency: string, name: string }} account
 */
export async function camtAccountInput(account) {
	const last4 = account.iban.slice(-4);
	return {
		source: /** @type {const} */ ('camt'),
		sourceAccountId: await ibanKey(account.iban),
		ibanLast4: last4,
		name: account.name || `Konto ···${last4}`,
		currency: account.currency || 'EUR'
	};
}

/**
 * Import parsed CAMT statements: one account per statement IBAN.
 *
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} store
 * @param {import('./camt.js').CamtStatement[]} statements
 */
export async function importCamtStatements(store, statements) {
	/** @type {{ account: import('../store/repository.js').StoredRecord, counts: ImportCounts, pending: number }[]} */
	const results = [];
	for (const statement of statements) {
		const input = await camtAccountInput(statement.account);
		const account = await upsertAccount(store.accounts, input);
		const counts = await importTransactions({
			transactions: store.transactions,
			account: {
				id: account.id,
				source: 'camt',
				fingerprintAccount: `camt:${input.sourceAccountId}`
			},
			incoming: statement.transactions
		});
		results.push({ account, counts, pending: statement.skipped });
	}
	if (results.length) {
		const sum = (/** @type {'new' | 'updated' | 'skipped'} */ k) =>
			results.reduce((n, r) => n + r.counts[k], 0);
		await recordEvent(store.events, 'bank-sync', {
			source: 'camt',
			accounts: results.length,
			accountIds: results.map((r) => r.account.id),
			new: sum('new'),
			updated: sum('updated'),
			skipped: sum('skipped'),
			pending: results.reduce((n, r) => n + r.pending, 0)
		});
	}
	return results;
}
