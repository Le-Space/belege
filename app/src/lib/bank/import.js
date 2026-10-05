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
import { valuedFields } from '../assets/valuation.js';
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
	// …and the network the exchange named for it (#215)
	'chainMethod',
	'exchangeType',
	// an own wallet's booking: the other side's address, the transaction in the explorer
	'counterpartyAddress',
	'explorerUrl',
	// a swap on a wallet: what went each way (wallets/wallet-sync.js)
	'swap',
	// a swap to another chain, from an IBC transfer's memo (wallets/cross-swap.js)
	'crossSwap',
	// moved out in someone else's transaction, and a booking without a rate (#162)
	'movedByOther',
	'rateMissing',
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
 * @property {string} [txRef] transaction hash or the exchange's reference, shared by the legs of a trade;
 *   on a bank account: a fee and the payment it was charged for (issue #218)
 * @property {{ amount: string, currency: string, rate?: string }} [original] a bank booking paid in another
 *   currency: that amount, its currency and the bank's rate
 * @property {string} [chainTxRef] an exchange's deposit or withdrawal: the on-chain hash, to pair it with a wallet
 * @property {string} [chainMethod] the network the exchange named for that hash (#215)
 * @property {string} [exchangeType] as the exchange names the entry, e.g. `transfer/spottostaking`
 * @property {string} [counterpartyAddress] an own wallet's booking: the other side's address on the chain
 * @property {string} [explorerUrl] an own wallet's booking: the transaction in the block explorer (https)
 * @property {import('../bridge/client.js').SwapSides} [swap] a wallet's swap: what went each way
 * @property {import('../wallets/cross-swap.js').CrossSwap} [crossSwap] a swap to another chain (IBC memo)
 * @property {{ by: string }} [movedByOther] moved out in someone else's transaction (#162)
 * @property {{ reason: string } | null} [rateMissing] no rate found: kept with its quantity, amount open (#162)
 * @property {CryptoFields} [crypto] for a crypto asset: what moved and how `amountCents`
 *   (EUR) was valued; see assets/valuation.js
 */

/**
 * @typedef {object} CryptoFields
 * @property {string} asset symbol, assets/registry.js
 * @property {string} quantity signed integer of the smallest unit, as a string
 * @property {number} decimals
 * @property {import('../assets/valuation.js').Valuation | null} valuation null while no rate is known (`rateMissing`, #162)
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
 * Whether a re-imported booking changed in what it is, not only in how it is
 * valued: the direction (an income became an expense or back); for euros,
 * the amount; for a crypto movement, the quantity. A new rate for the same
 * quantity is no such change.
 *
 * @param {Record<string, any>} stored
 * @param {Record<string, any>} next
 */
export function movedDifferently(stored, next) {
	const before = Number(stored.amountCents);
	const after = Number(next.amountCents);
	if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
	// A crypto movement: the quantity carries the direction; its euro value may
	// move with the rate (or round to 0 cents) without the booking changing.
	if (typeof stored.quantity === 'string' || typeof next.quantity === 'string') {
		return String(stored.quantity ?? '') !== String(next.quantity ?? '');
	}
	return before !== after;
}

/**
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.transactions
 * @param {{ id: string, source: string, fingerprintAccount: string }} params.account
 *   source: 'hibiscus', 'camt', 'kraken', or a wallet's chain (wallets/chains.js)
 *   the stored account record's id, its source, and the account key the fingerprint uses
 * @param {IncomingTransaction[]} params.incoming
 * @param {import('../store/repository.js').Collection} [params.events] the Verlauf: a booking that
 *   changed in what it is gets an entry
 * @param {() => Date} [params.now]
 * @returns {Promise<ImportCounts>}
 *
 * A stored booking that comes again changed in what it is (movedDifferently)
 * keeps its id, but loses its confirmed account – it was confirmed for what
 * the booking was – and carries `importChange` { at, fromCents, toCents,
 * signFlipped } until a person says they looked at it. Its receipt link
 * stays; the detail says to check it.
 */
export async function importTransactions({
	transactions,
	account,
	incoming,
	events,
	now = () => new Date()
}) {
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
			...(!tx.movement && tx.txRef ? { txRef: tx.txRef } : {}),
			...(tx.original ? { original: tx.original } : {}),
			...(tx.chainTxRef ? { chainTxRef: tx.chainTxRef } : {}),
			...(tx.chainMethod ? { chainMethod: tx.chainMethod } : {}),
			...(tx.exchangeType ? { exchangeType: tx.exchangeType } : {}),
			...(tx.counterpartyAddress ? { counterpartyAddress: tx.counterpartyAddress } : {}),
			...(tx.explorerUrl ? { explorerUrl: tx.explorerUrl } : {}),
			...(tx.swap ? { swap: tx.swap } : {}),
			...(tx.crossSwap ? { crossSwap: tx.crossSwap } : {}),
			...(tx.movedByOther ? { movedByOther: tx.movedByOther } : {}),
			...(tx.crypto ? { rateMissing: tx.rateMissing ?? null } : {}),
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
			// Who moved a token out stays known once a source named it: Blockscout
			// does not know it, Alchemy does (#162).
			...(fields.movedByOther && !fields.movedByOther.by && match.movedByOther?.by
				? { movedByOther: match.movedByOther }
				: {}),
			// A rate a person entered stays: the sync may know none, or another (#162).
			...(match.valuation?.source === 'manual'
				? { amountCents: match.amountCents, valuation: match.valuation, rateMissing: null }
				: {}),
			sourceId: fields.sourceId ?? match.sourceId ?? null,
			// Matched by id: its repeat count is whatever it was. A shorter sync
			// window can shift the count, and that is no change.
			fingerprintSeq: bySource ? (match.fingerprintSeq ?? seq) : seq
		};
		const changed = FIELDS.some(
			(f) => !same(/** @type {any} */ (next)[f], /** @type {any} */ (match)[f])
		);
		if (changed && !match.deleted) {
			/** @type {Record<string, any>} */
			const record = { ...match, ...next };
			if (movedDifferently(match, next)) {
				// Measured from what a person last saw: a second change keeps the first "before".
				const fromCents = Number(match.importChange?.fromCents ?? match.amountCents);
				const toCents = Number(next.amountCents);
				record.importChange = {
					at: now().toISOString(),
					fromCents,
					toCents,
					signFlipped: Math.sign(fromCents) !== Math.sign(toCents)
				};
				const wasConfirmed = Boolean(match.booking?.confirmedAt);
				if (wasConfirmed) record.booking = { ...match.booking, confirmedAt: null };
				await recordEvent(events, 'booking-changed', {
					transactionId: match.id,
					accountId: account.id,
					source: account.source,
					fromCents,
					toCents,
					signFlipped: record.importChange.signFlipped,
					unconfirmed: wasConfirmed,
					withReceipt: Boolean(match.receiptId)
				});
			}
			await transactions.put(record);
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
 * @param {{ source: string, sourceAccountId: string, ibanLast4: string, name: string, currency: string, kind?: 'exchange' | 'wallet' | 'outlay', asset?: string, decimals?: number }} input
 *   `kind`, `asset`, `decimals`: an account on an exchange or a wallet, holding one asset;
 *   `outlay`: what a person paid privately (outlays/outlays.js)
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
 * A CAMT statement's account: keyed by a hash of its IBAN – or, where the
 * bank names none (issue #218), of its other id with issuer and scheme – so
 * the number is not kept in full even inside the sealed store.
 *
 * @param {{ iban: string, otherId?: string, issuer?: string, scheme?: string, currency: string, name: string }} account
 */
export async function camtAccountInput(account) {
	const number = account.iban || account.otherId || '';
	const last4 = number.slice(-4);
	const currency = account.currency || 'EUR';
	return {
		source: /** @type {const} */ ('camt'),
		sourceAccountId: await ibanKey(
			account.iban ||
				`other:${account.issuer ?? ''}:${account.scheme ?? ''}:${account.otherId}:${currency}`
		),
		ibanLast4: last4,
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		name: account.name || `Konto ···${last4}`,
		currency,
		// An account in another currency keeps each booking's amount in it, valued in euros.
		...(currency !== 'EUR' ? { asset: currency, decimals: 2 } : {})
	};
}

/**
 * A statement's bookings in another currency than the euro (issue #218): each
 * keeps its amount as a quantity of that currency and is valued at the day's
 * rate (USD: the ECB reference rate, through the bridge). Without a rate – no
 * bridge, or a currency it has none for – the booking is kept with its
 * quantity and "Kurs fehlt", like a crypto booking (#162); a later import
 * with a rate fills the euros in.
 *
 * @param {import('./camt.js').CamtTransaction[]} transactions
 * @param {string} currency the account's
 * @param {((asset: string, date: string) => Promise<import('../assets/valuation.js').Rate>) | null} getRate
 * @returns {Promise<IncomingTransaction[]>}
 */
export async function valuedInEuros(transactions, currency, getRate) {
	/** @type {Map<string, Promise<import('../assets/valuation.js').Rate>>} */
	const rates = new Map();
	/** @type {IncomingTransaction[]} */
	const out = [];
	for (const tx of transactions) {
		const units = String(tx.amountCents);
		try {
			if (!getRate) throw new Error(`no rate for ${currency}`);
			if (!rates.has(tx.date)) rates.set(tx.date, getRate(currency, tx.date));
			const rate = await /** @type {Promise<import('../assets/valuation.js').Rate>} */ (
				rates.get(tx.date)
			);
			const { amountCents, asset, quantity, decimals, valuation } = valuedFields({
				asset: currency,
				units,
				decimals: 2,
				rate
			});
			out.push({
				...tx,
				amountCents,
				currency: 'EUR',
				crypto: { asset, quantity, decimals, valuation }
			});
		} catch (error) {
			out.push({
				...tx,
				amountCents: 0,
				currency: 'EUR',
				crypto: {
					asset: currency,
					quantity: units,
					decimals: 2,
					valuation: /** @type {any} */ (null)
				},
				rateMissing: {
					reason: String(/** @type {any} */ (error)?.message ?? error).slice(0, 200)
				}
			});
		}
	}
	return out;
}

/**
 * Import parsed CAMT statements: one account per statement IBAN.
 *
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} store
 * @param {import('./camt.js').CamtStatement[]} statements
 * @param {{ getRate?: ((asset: string, date: string) => Promise<import('../assets/valuation.js').Rate>) | null }} [options]
 *   the day's rate for a statement in another currency (the bridge client's `rate`)
 */
export async function importCamtStatements(store, statements, { getRate = null } = {}) {
	/** @type {{ account: import('../store/repository.js').StoredRecord, counts: ImportCounts, pending: number }[]} */
	const results = [];
	for (const statement of statements) {
		const input = await camtAccountInput(statement.account);
		const account = await upsertAccount(store.accounts, input);
		const counts = await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: {
				id: account.id,
				source: 'camt',
				fingerprintAccount: `camt:${input.sourceAccountId}`
			},
			incoming:
				input.currency === 'EUR'
					? statement.transactions
					: await valuedInEuros(statement.transactions, input.currency, getRate)
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
