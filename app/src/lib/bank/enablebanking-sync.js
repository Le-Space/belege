// "Umsätze holen" through Enable Banking (issue #224, step 3): the chosen
// accounts the bridge lets leave, into the sealed store, on a click only.
//
// An account is known by its IBAN key (bank/fingerprint.js `ibanKey`), which
// the bridge sends for an allowed account – never the IBAN. A statement file
// for the same IBAN (CAMT) made an account with that key already: it is
// continued, not doubled. Its bookings stay as they are; the fetch begins the
// day after the last one the file brought, so the two never overlap. The
// fingerprints use the same account key as the CAMT import, `camt:<key>`.
//
// The first fetch reaches back 90 days, later ones a week before the last,
// for late bookings; what was imported is not imported twice (sourceId, then
// fingerprint). A bank allows only a few unattended fetches a day; this runs
// when a person clicks.

import { recordEvent } from '../activity/events.js';
import { importTransactions, upsertAccount, valuedInEuros } from './import.js';
import { DEFAULT_DAYS, OVERLAP_DAYS } from './hibiscus-sync.js';

/** @param {string} day YYYY-MM-DD @param {number} days */
const shift = (day, days) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/**
 * The account record an Enable Banking account goes into: one of its own,
 * else a statement file's with the same key, else a new one.
 *
 * @param {import('../store/repository.js').Collection} accounts
 * @param {import('../bridge/client.js').EnableBankingAccount} account
 */
export async function accountFor(accounts, account) {
	const key = /** @type {string} */ (account.ibanKey);
	const known = await accounts.list({
		where: (a) =>
			!a.deleted &&
			a.sourceAccountId === key &&
			(a.source === 'enablebanking' || a.source === 'camt')
	});
	const own = known.find((a) => a.source === 'enablebanking');
	if (own) return own;
	const camt = known.find((a) => a.source === 'camt');
	if (camt) return camt;
	return upsertAccount(accounts, {
		source: 'enablebanking',
		sourceAccountId: key,
		ibanLast4: account.ibanLast4,
		name: account.name || `${account.bank} ···${account.ibanLast4}`,
		currency: account.currency || 'EUR'
	});
}

/**
 * @param {object} params
 * @param {{ enableBankingTransactions: (uid: string, since: string) => Promise<{ transactions: any[], pending: number, complete: boolean }> }} params.client
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {import('../bridge/client.js').EnableBankingAccount[]} params.accounts the chosen ones, allowed by the bridge
 * @param {string} [params.from] YYYY-MM-DD instead of the automatic start
 * @param {((asset: string, date: string) => Promise<any>) | null} [params.getRate] for an account in another currency
 * @param {Date} [params.now]
 */
export async function syncEnableBanking({
	client,
	store,
	accounts,
	from,
	getRate = null,
	now = new Date()
}) {
	if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`date: ${from}`);
	const today = now.toISOString().slice(0, 10);
	const totals = { new: 0, updated: 0, skipped: 0 };
	let pending = 0;
	let incomplete = 0;
	/** @type {{ accountId: string, since: string, continued: boolean, counts: typeof totals }[]} */
	const perAccount = [];

	for (const account of accounts) {
		if (!account.allowed || !account.ibanKey) continue;
		const record = await accountFor(store.accounts, account);
		const continued = record.source === 'camt';
		let since = from ?? '';
		if (!since) {
			if (record.ebLastSyncedOn) since = shift(record.ebLastSyncedOn, -OVERLAP_DAYS);
			else {
				since = shift(today, -DEFAULT_DAYS);
				if (continued) {
					// After the file's last booking: the two sources never overlap.
					const fromFile = await store.transactions.list({
						where: (t) => t.accountId === record.id && t.source === 'camt' && !t.deleted
					});
					const last = fromFile
						.map((t) => String(t.bookedOn ?? ''))
						.sort()
						.at(-1);
					if (last && shift(last, 1) > since) since = shift(last, 1);
				}
			}
		}
		if (since > today) since = today;
		const answer = await client.enableBankingTransactions(account.uid, since);
		const currency = account.currency || 'EUR';
		const incoming =
			currency === 'EUR'
				? answer.transactions
				: await valuedInEuros(answer.transactions, currency, getRate);
		const counts = await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: {
				id: record.id,
				source: 'enablebanking',
				fingerprintAccount: `camt:${account.ibanKey}`
			},
			incoming
		});
		await store.accounts.put({ ...record, ebLastSyncedOn: today });
		totals.new += counts.new;
		totals.updated += counts.updated;
		totals.skipped += counts.skipped;
		pending += answer.pending;
		if (!answer.complete) incomplete++;
		perAccount.push({ accountId: record.id, since, continued, counts });
	}
	await recordEvent(store.events, 'bank-sync', {
		source: 'enablebanking',
		accounts: perAccount.length,
		accountIds: perAccount.map((a) => a.accountId),
		since: perAccount.map((a) => a.since).sort()[0] ?? null,
		...totals
	});
	return { totals, pending, incomplete, perAccount };
}
