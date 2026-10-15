// What a click on a trip proposal does (issue #213, step 4b; proposals.js):
// make it a trip, or add its receipts to the trip it falls into, each with
// who most likely paid it; or dismiss it for good, as business without a
// trip; or say it was private (#425).

import { setAsideReceipt } from '../matching/actions.js';
import { markPrivate } from '../matching/private.js';
import { matchOfReceipt } from '../matching/view.js';
import { assignReceipt, ownerTraveller, saveTrip } from './records.js';
import { paidByGuess } from './view.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @param {object} p
 * @param {{ travel: import('../store/repository.js').Collection, receipts: import('../store/repository.js').Collection }} p.store
 * @param {import('./proposals.js').Proposal} p.proposal
 * @param {import('../booking/settings.js').DatevSettings} p.settings cleaned
 * @param {{ transactions: Rec[], matches: Rec[] }} p.books for who paid
 * @param {string} [p.travellerId] whose trip it becomes (#380); the owner by default
 * @returns {Promise<string>} the trip's id
 */
export async function acceptProposal({ store, proposal, settings, books, travellerId }) {
	let tripId = proposal.tripId;
	if (!tripId) {
		const traveller = travellerId ? { id: travellerId } : await ownerTraveller(store, settings);
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

/**
 * "Privat" (#425): a holiday, a private ticket. Each receipt is set aside as
 * private with the note (#293), out of matching and export; where the
 * business account paid one (a linked payment that is no outlay), that
 * payment is marked private (#172) – by legal form a private withdrawal or
 * the shareholder's debt. Both can be taken back as before. Set aside, the
 * receipts are proposed no more.
 *
 * @param {object} p
 * @param {any} p.store receipts, matches, transactions, events
 * @param {import('./proposals.js').Proposal} p.proposal
 * @param {{ transactions: Rec[], matches: Rec[] }} p.books for who paid
 * @param {string} p.note what the person sees on the receipts and the payments
 * @returns {Promise<{ receipts: number, payments: number }>}
 */
export async function privateProposal({ store, proposal, books, note }) {
	let receipts = 0;
	let payments = 0;
	for (const id of proposal.receiptIds) {
		const receipt = await store.receipts.get(id);
		if (!receipt || receipt.deleted) continue;
		// Before the receipt lets go of its link: which payment it was.
		const match =
			paidByGuess(receipt, books) === 'company' ? matchOfReceipt(id, books.matches) : null;
		if (match) {
			await markPrivate(store, String(match.transactionId), note);
			payments++;
		}
		await setAsideReceipt(store, id, { private: true, note });
		receipts++;
	}
	return { receipts, payments };
}
