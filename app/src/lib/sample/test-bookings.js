// Test bookings: "Testbuchung anlegen" on Zahlungen, a button of the
// development and E2E builds only. It makes a made-up payment without a bank
// or a bridge, for tests – and it can land in real books when someone runs
// the development build with them (and, with device sync on, on every own
// device). These are found here and taken out again, like the sample books.
//
// A test booking carries `testBooking: true`. Older ones, made before the mark
// existed, are recognised by what the button wrote: Testpartner GmbH,
// "Testbuchung", no account and no source.
//
// Removing is a soft delete, as everywhere in these books: out of every list,
// kept in the append-only log. The export never takes one (export/plan.js).

import { isActive } from '../matching/engine.js';

/** @typedef {Record<string, any>} Rec */

/** What the button writes. */
export const TEST_COUNTERPARTY = 'Testpartner GmbH';
export const TEST_PURPOSE = 'Testbuchung';

/** @param {Rec | null | undefined} t */
export const isTestBooking = (t) =>
	Boolean(t) &&
	!t?.deleted &&
	(t?.testBooking === true ||
		(t?.counterparty === TEST_COUNTERPARTY &&
			t?.purpose === TEST_PURPOSE &&
			!t?.accountId &&
			!t?.source));

/** @param {Rec[]} transactions */
export const testBookings = (transactions) => transactions.filter(isTestBooking);

/**
 * Take every test booking out, with the matches and questions that point at one.
 *
 * @param {{ transactions: any, matches: any, questions: any }} store
 * @returns {Promise<number>} how many bookings were removed
 */
export async function removeTestBookings(store) {
	/** @type {Set<string>} */
	const ids = new Set();
	for (const t of await store.transactions.list({ where: isTestBooking })) {
		ids.add(String(t.id));
		await store.transactions.softDelete(t.id);
	}
	const points = (/** @type {Rec} */ r) => ids.has(String(r.transactionId ?? ''));
	for (const m of await store.matches.list({ where: points })) {
		if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
		await store.matches.softDelete(m.id);
	}
	for (const q of await store.questions.list({ where: points })) {
		await store.questions.softDelete(q.id);
	}
	return ids.size;
}
