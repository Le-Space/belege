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

import { fingerprint as computeFingerprint, ibanKey } from './fingerprint.js';

/** The fields an import owns. Anything else on a record (a receipt link) stays. */
const FIELDS = /** @type {const} */ ([
	'accountId',
	'source',
	'sourceId',
	'fingerprint',
	'fingerprintSeq',
	'bookedOn',
	'valueDate',
	'amountCents',
	'currency',
	'counterparty',
	'counterpartyIban',
	'purpose',
	'endToEndId',
	'bookingType'
]);

/**
 * @typedef {object} IncomingTransaction normalised, from the bridge or the CAMT parser
 * @property {string | null} sourceId
 * @property {string | null} date
 * @property {string | null} [valueDate]
 * @property {number} amountCents
 * @property {string} [currency]
 * @property {string} [counterpartyName]
 * @property {string} [counterpartyIban]
 * @property {string} [purpose]
 * @property {string} [endToEndId]
 * @property {string} [bookingType]
 * @property {string} [fingerprint] the bridge sends it; computed when missing
 */

/**
 * @typedef {{ new: number, updated: number, skipped: number }} ImportCounts
 */

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => (a ?? '') === (b ?? '');

/**
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.transactions
 * @param {{ id: string, source: 'hibiscus' | 'camt', fingerprintAccount: string }} params.account
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
			valueDate: tx.valueDate || tx.date,
			amountCents: tx.amountCents,
			currency: tx.currency || 'EUR',
			counterparty: tx.counterpartyName ?? '',
			counterpartyIban: tx.counterpartyIban ?? '',
			purpose: tx.purpose ?? '',
			endToEndId: tx.endToEndId ?? '',
			bookingType: tx.bookingType ?? ''
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
 * @param {{ source: 'hibiscus' | 'camt', sourceAccountId: string, ibanLast4: string, name: string, currency: string }} input
 */
export async function upsertAccount(accounts, input) {
	const [found] = await accounts.list({
		where: (a) => a.source === input.source && a.sourceAccountId === input.sourceAccountId
	});
	if (!found) return accounts.put({ ...input });
	const changed = /** @type {const} */ (['ibanLast4', 'name', 'currency']).some(
		(f) => !same(found[f], input[f])
	);
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
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection }} store
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
	return results;
}
