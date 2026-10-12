// What a click on a trip proposal does (issue #213, step 4b; proposals.js):
// make it a trip, or add its receipts to the trip it falls into, each with
// who most likely paid it; or dismiss it for good.

import { assignReceipt, ownerTraveller, saveTrip } from './records.js';
import { paidByGuess } from './view.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @param {object} p
 * @param {{ travel: import('../store/repository.js').Collection, receipts: import('../store/repository.js').Collection }} p.store
 * @param {import('./proposals.js').Proposal} p.proposal
 * @param {import('../booking/settings.js').DatevSettings} p.settings cleaned
 * @param {{ transactions: Rec[], matches: Rec[] }} p.books for who paid
 * @returns {Promise<string>} the trip's id
 */
export async function acceptProposal({ store, proposal, settings, books }) {
	let tripId = proposal.tripId;
	if (!tripId) {
		const traveller = await ownerTraveller(store, settings);
		const { trip } = await saveTrip(store, {
			travellerId: traveller.id,
			destination: proposal.destination,
			reason: proposal.reason ?? '',
			start: proposal.start,
			end: proposal.end
		});
		tripId = String(trip.id);
	}
	for (const id of proposal.receiptIds) {
		const receipt = await store.receipts.get(id);
		if (!receipt || receipt.deleted) continue;
		await assignReceipt(store, { receiptId: id, tripId, paidBy: paidByGuess(receipt, books) });
	}
	return tripId;
}

/**
 * Not a trip: this proposal is not offered again. Another receipt that would
 * join it makes a new one.
 *
 * @param {{ travel: import('../store/repository.js').Collection }} store
 * @param {string} key
 */
export const dismissProposal = (store, key) => store.travel.put({ kind: 'dismissed', key });
