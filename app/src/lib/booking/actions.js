// "Übernehmen": the person confirms a booking's account and BU key. Stored on
// the transaction as `booking: { account, taxKey, confirmedAt }` (sealed like
// every record); a booking whose receipt names a vendor teaches that vendor
// the account (partners.js `learnAccount`). One event in the Verlauf.

import { recordEvent } from '../activity/events.js';
import { cleanMatchingSettings } from '../matching/classify.js';
import { learnAccount } from '../matching/partners.js';
import { matchesOfTx } from '../matching/view.js';
import { getSetting } from '../store/settings.js';
import { isAccountNumber } from './skr03.js';

/** @typedef {import('../matching/engine.js').MatchingStore} MatchingStore */

/**
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {{ account: string, taxKey?: string }} booking
 * @param {{ log?: boolean, now?: () => Date }} [options]
 */
export async function confirmBooking(
	store,
	transactionId,
	{ account, taxKey = '' },
	{ log = true, now = () => new Date() } = {}
) {
	const number = String(account ?? '').trim();
	const key = String(taxKey ?? '').trim();
	if (!isAccountNumber(number)) throw new Error('Ein Konto hat 4 bis 8 Ziffern.');
	if (!/^\d{0,4}$/.test(key)) throw new Error('Ein BU-Schlüssel hat bis zu 4 Ziffern.');
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	const record = await store.transactions.put({
		...tx,
		booking: { account: number, taxKey: key, confirmedAt: now().toISOString() },
		// Confirmed again after a change on re-import: looked at.
		importChange: null
	});
	const [first] = matchesOfTx(
		transactionId,
		await store.matches.list({ where: (m) => m.transactionId === transactionId })
	);
	const receipt = first ? await store.receipts.get(first.receiptId) : null;
	let learned = false;
	if (store.partners && receipt) {
		const { companyNames } = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
		learned = Boolean(
			await learnAccount(
				store.partners,
				receipt,
				tx,
				{ account: number, taxKey: key },
				{ companyNames }
			)
		);
	}
	if (log) {
		await recordEvent(store.events, 'decision', {
			action: 'booking',
			transactionId,
			account: number,
			taxKey: key,
			learned
		});
	}
	return record;
}

/**
 * Several bookings at once, each with its own values (the export page's
 * "Automatische Konten übernehmen"): one event for all.
 *
 * @param {MatchingStore} store
 * @param {{ transactionId: string, account: string, taxKey: string }[]} items
 */
export async function confirmBookings(store, items) {
	for (const item of items) {
		await confirmBooking(store, item.transactionId, item, { log: false });
	}
	if (items.length) {
		await recordEvent(store.events, 'decision', {
			action: 'bookings',
			transactionId: items[0].transactionId,
			count: items.length
		});
	}
}

/**
 * "Geprüft": a person looked at a booking that changed on re-import
 * (bank/import.js `importChange`); the mark goes, the booking stays as it is.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 */
export async function acknowledgeImportChange(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx?.importChange) return tx;
	return store.transactions.put({ ...tx, importChange: null });
}
