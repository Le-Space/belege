// "Jetzt synchronisieren": the chosen Hibiscus accounts, through the bridge,
// into the sealed store.

import { recordEvent } from '../activity/events.js';
import { importTransactions, upsertAccount } from './import.js';

export const DEFAULT_DAYS = 90;
/** A sync starts this many days before the last one, for late bookings. */
export const OVERLAP_DAYS = 7;

/** @param {Date} date @param {number} days */
function isoDaysBefore(date, days) {
	return new Date(date.getTime() - days * 864e5).toISOString().slice(0, 10);
}

/**
 * @param {object} params
 * @param {import('../bridge/client.js').BridgeClient} params.client
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {import('../bridge/client.js').BridgeAccount[]} params.accounts the chosen ones
 * @param {Date} [params.now]
 * @param {string} [params.from] YYYY-MM-DD: fetch from this day instead of the automatic start
 */
export async function syncHibiscus({ client, store, accounts, now = new Date(), from }) {
	if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from))
		throw new Error(`Kein Datum: ${from}`);
	const today = now.toISOString().slice(0, 10);
	const totals = { new: 0, updated: 0, skipped: 0 };
	/** @type {{ accountId: string, name: string, since: string, counts: typeof totals }[]} */
	const perAccount = [];

	for (const bridgeAccount of accounts) {
		const record = await upsertAccount(store.accounts, {
			source: 'hibiscus',
			sourceAccountId: bridgeAccount.id,
			ibanLast4: bridgeAccount.ibanLast4,
			name: bridgeAccount.name || `Konto ···${bridgeAccount.ibanLast4}`,
			currency: bridgeAccount.currency || 'EUR'
		});
		const since = from
			? from
			: record.lastSyncedOn
				? isoDaysBefore(new Date(`${record.lastSyncedOn}T00:00:00Z`), OVERLAP_DAYS)
				: isoDaysBefore(now, DEFAULT_DAYS);
		const incoming = await client.transactions(bridgeAccount.id, since);
		const counts = await importTransactions({
			transactions: store.transactions,
			account: {
				id: record.id,
				source: 'hibiscus',
				fingerprintAccount: `hibiscus:${bridgeAccount.id}`
			},
			incoming
		});
		await store.accounts.put({ ...record, importEnabled: true, lastSyncedOn: today });
		totals.new += counts.new;
		totals.updated += counts.updated;
		totals.skipped += counts.skipped;
		perAccount.push({ accountId: record.id, name: record.name, since, counts });
	}
	await recordEvent(store.events, 'bank-sync', {
		source: 'hibiscus',
		accounts: perAccount.length,
		accountIds: perAccount.map((a) => a.accountId),
		since: perAccount.map((a) => a.since).sort()[0] ?? null,
		...totals
	});
	return { totals, perAccount };
}
