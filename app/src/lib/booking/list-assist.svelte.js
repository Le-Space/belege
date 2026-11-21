// "✦ Konten vorschlagen" on Zahlungen → "Ohne Konto": the model is asked for
// every listed payment that has no suggestion of the books' own, one after
// the other, with the same question as a payment's own "✦ Konto vorschlagen"
// (assist-request.js). What it names is put into the row's field; nothing is
// booked until the person takes it there.
//
// One payment a call, not the list in one: each answer is checked against the
// accounts offered for that payment (the bridge refuses any other), a refusal
// or an error costs one row and not all, and "Anhalten" stops after the
// payment that is under way. Kept for the session, not in the books: a
// suggestion nobody took is nothing to keep.
import { recordEvent } from '../activity/events.js';
import { matchesOfTx } from '../matching/view.js';
import { clearingAccountOf, travelSetOf } from '../travel/accounts.js';
import { assistBody, assistEventData } from './assist-request.js';
import { cleanDatevSettings, privateAccounts } from './settings.js';
import { searchAccounts } from './skr03.js';
import { isBookingConfirmed, suggestBooking } from './suggest.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {{ account: string | null, confidence: string, reason: string }} ListPick `account` null: the model named none */

/** At most this many payments a click: a month's worth, and a bound on the cost. */
export const MAX_LIST_ASSIST = 100;

export const listAssist = $state({
	/** @type {Record<string, ListPick>} by transaction id */
	picks: {},
	busy: false,
	done: 0,
	total: 0,
	/** @type {string | null} */
	error: null,
	stopping: false
});

/**
 * The linked receipts of a payment. @param {Rec} tx
 * @param {{ matches: Rec[], receipts: Rec[] }} app
 */
const receiptsOf = (tx, app) =>
	matchesOfTx(tx.id, /** @type {any} */ (app.matches)).flatMap((m) => {
		const r = app.receipts.find((x) => x.id === m.receiptId);
		return r ? [r] : [];
	});

/**
 * What the books suggest by themselves (suggest.js), from the session's lists.
 *
 * @param {Rec} tx
 * @param {Rec} app the session (session.svelte.js `app`)
 */
export function suggestFor(tx, app) {
	const datev = cleanDatevSettings(app.datevSettings);
	return suggestBooking(tx, {
		classification: app.classifications[tx.id] ?? null,
		receipts: receiptsOf(tx, /** @type {any} */ (app)),
		partners: app.partners ?? [],
		keys: datev.taxKeys,
		privateAccounts: privateAccounts(datev),
		travelSet: travelSetOf(datev, app.travel),
		travelClearing: clearingAccountOf(datev, app.travel)
	});
}

/**
 * The payments of a list the model is asked about: without a confirmed
 * account, without a suggestion of the books' own, and not asked yet.
 *
 * @param {Rec[]} txs
 * @param {Rec} app
 * @param {Record<string, ListPick>} [picks]
 */
export function toAsk(txs, app, picks = listAssist.picks) {
	return txs
		.filter((tx) => !isBookingConfirmed(tx) && !picks[tx.id] && !suggestFor(tx, app).account)
		.slice(0, MAX_LIST_ASSIST);
}

/**
 * Ask for each payment in turn.
 *
 * @param {object} p
 * @param {Rec[]} p.txs the listed payments
 * @param {Rec} p.app the session
 * @param {{ bookingAssist: (body: any) => Promise<any> }} p.client the paired bridge
 * @param {{ events?: any } | null} p.store for the Verlauf
 * @param {(vendors: string) => string} p.learnedName
 */
export async function askForList({ txs, app, client, store, learnedName }) {
	if (listAssist.busy) return;
	const asked = toAsk(txs, app);
	listAssist.busy = true;
	listAssist.stopping = false;
	listAssist.error = null;
	listAssist.done = 0;
	listAssist.total = asked.length;
	try {
		for (const tx of asked) {
			if (listAssist.stopping) break;
			const income = (tx.amountCents ?? 0) > 0;
			const r = await client.bookingAssist(
				assistBody({
					tx,
					receipt: receiptsOf(tx, /** @type {any} */ (app))[0] ?? null,
					own: app.accounts.find((/** @type {Rec} */ a) => a.id === tx.accountId),
					partners: app.partners ?? [],
					catalogue: searchAccounts('', { income, chart: app.chart }),
					chart: app.chart,
					learnedName
				})
			);
			const first = (r.picks ?? [])[0];
			listAssist.picks[tx.id] = {
				account: first?.account ? String(first.account) : null,
				confidence: String(first?.confidence ?? ''),
				reason: String(first?.reason ?? '').slice(0, 300)
			};
			listAssist.done++;
			await recordEvent(store?.events, 'booking-assist', assistEventData(tx.id, r));
		}
	} catch (e) {
		// The bridge or the model gave up: what was answered so far stays.
		listAssist.error = e instanceof Error ? e.message : String(e);
	} finally {
		listAssist.busy = false;
		listAssist.stopping = false;
	}
}

/** Stop after the payment that is under way. */
export function stopListAssist() {
	if (listAssist.busy) listAssist.stopping = true;
}

/** Other books, or a test: nothing of the last session's. */
export function resetListAssist() {
	listAssist.picks = {};
	listAssist.busy = false;
	listAssist.done = 0;
	listAssist.total = 0;
	listAssist.error = null;
	listAssist.stopping = false;
}
