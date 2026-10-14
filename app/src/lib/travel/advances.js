// Advances before a trip (issue #381): money paid out to a traveller before
// the statement, marked on the payment itself (`tx.travelAdvance`: whose,
// and optionally for which trip). It needs no receipt of its own – the later
// statement documents it – and is booked against the traveller's clearing
// account, as the payout is (booking/suggest.js).
//
// Advances settle with the statements per traveller (payout.js):
//   for a trip    on the statement that has the trip, whatever it comes to –
//                 more than the costs leaves a claim on the traveller
//   for no trip   on the traveller's open statements, the oldest first
// What no statement takes yet stays open: an advance still to be accounted
// for, shown as such.

/* eslint-disable belege/no-german -- the reason stored in the books (#192) */

import { recordEvent } from '../activity/events.js';
import { setNoReceipt } from '../matching/actions.js';

/** @typedef {Record<string, any>} Rec */

export const ADVANCE_REASON = 'Vorschuss für Reisekosten';

/**
 * @typedef {object} Advance
 * @property {Rec} tx the payment
 * @property {string} travellerId
 * @property {string | null} tripId
 * @property {number} cents what was paid, positive
 */

/** @param {Rec | null | undefined} tx */
export const isAdvance = (tx) => Boolean(tx?.travelAdvance?.travellerId) && !tx?.deleted;

/**
 * The advances, oldest first.
 *
 * @param {Rec[]} transactions
 * @returns {Advance[]}
 */
export const advancesOf = (transactions) =>
	transactions
		.filter((tx) => isAdvance(tx) && Number(tx.amountCents) < 0)
		.sort(
			(a, b) =>
				String(a.bookedOn).localeCompare(String(b.bookedOn)) ||
				String(a.id).localeCompare(String(b.id))
		)
		.map((tx) => ({
			tx,
			travellerId: String(tx.travelAdvance.travellerId),
			tripId: tx.travelAdvance.tripId ? String(tx.travelAdvance.tripId) : null,
			cents: -Number(tx.amountCents)
		}));

/**
 * Which statement takes which advance.
 *
 * @param {{ head: Rec, tripIds?: string[] }[]} chains oldest first; `tripIds` where the head has no snapshot yet (a statement being made)
 * @param {Advance[]} advances oldest first
 * @returns {{ byChain: { advance: Advance, cents: number }[][], open: { advance: Advance, cents: number }[] }}
 */
export function allocateAdvances(chains, advances) {
	/** @type {{ advance: Advance, cents: number }[][]} */
	const byChain = chains.map(() => []);
	const tripsOf = (/** @type {{ head: Rec, tripIds?: string[] }} */ c) =>
		c.tripIds ?? (c.head.snapshot?.trips ?? []).map((/** @type {Rec} */ t) => String(t.tripId));
	const taken = (/** @type {number} */ i) => byChain[i].reduce((s, a) => s + a.cents, 0);
	/** @type {{ advance: Advance, cents: number }[]} */
	const open = [];
	// For a trip: on the statement that has it, all of it.
	for (const a of advances.filter((x) => x.tripId)) {
		const i = chains.findIndex(
			(c) =>
				String(c.head.travellerId) === a.travellerId &&
				tripsOf(c).includes(/** @type {string} */ (a.tripId))
		);
		if (i >= 0) byChain[i].push({ advance: a, cents: a.cents });
		else open.push({ advance: a, cents: a.cents });
	}
	// For no trip: the traveller's statements, the oldest first, as far as their costs go.
	for (const a of advances.filter((x) => !x.tripId)) {
		let left = a.cents;
		chains.forEach((c, i) => {
			if (left <= 0 || String(c.head.travellerId) !== a.travellerId) return;
			const room = Number(c.head.toPayBackCents ?? 0) - taken(i);
			const cents = Math.min(left, room);
			if (cents <= 0) return;
			byChain[i].push({ advance: a, cents });
			left -= cents;
		});
		if (left > 0) open.push({ advance: a, cents: left });
	}
	return { byChain, open };
}

/**
 * "Vorschuss für Reisekosten": this money out is an advance to a traveller,
 * for a trip or not. Its receipt is the later statement.
 *
 * @param {any} store transactions, matches, travel, events
 * @param {string} transactionId
 * @param {{ travellerId: string, tripId?: string | null }} p
 */
export async function markAdvance(store, transactionId, { travellerId, tripId = null }) {
	const tx = await store.transactions.get(transactionId);
	if (!tx || tx.deleted || tx.source === 'travel' || Number(tx.amountCents) >= 0)
		throw new Error('No payment out');
	if (String(tx.currency ?? 'EUR') !== 'EUR') throw new Error('An advance is paid in euros.');
	const traveller = await store.travel.get(travellerId);
	if (!traveller || traveller.deleted || traveller.kind !== 'traveller')
		throw new Error(`No traveller ${travellerId}`);
	if (tripId) {
		const trip = await store.travel.get(tripId);
		if (!trip || trip.deleted || trip.kind !== 'trip' || trip.travellerId !== travellerId)
			throw new Error(`No trip ${tripId} of this traveller`);
	}
	await setNoReceipt(store, transactionId, ADVANCE_REASON, { log: false });
	const now = await store.transactions.get(transactionId);
	await store.transactions.put({
		...now,
		travelAdvance: { travellerId, tripId: tripId || null, at: new Date().toISOString() }
	});
	await recordEvent(store.events, 'decision', {
		action: 'travel-advance',
		transactionId,
		...(tripId ? { tripId } : {})
	});
}

/**
 * Not an advance after all: the payment waits for its receipt again.
 *
 * @param {any} store
 * @param {string} transactionId
 */
export async function unmarkAdvance(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx?.travelAdvance) return;
	await store.transactions.put({ ...tx, travelAdvance: null });
	await setNoReceipt(store, transactionId, null, { log: false });
	await recordEvent(store.events, 'decision', { action: 'travel-advance-undo', transactionId });
}
