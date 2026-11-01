// A travel expense statement (Reisekostenabrechnung, issue #213, step 5):
// one traveller's trips of one month – decided: per month – with their
// receipts, allowances and mileage, the month's hospitality bills without a
// trip, and what is to be paid back. Pure: what the preview shows, what the
// checks say, and what the PDF prints come from here.
//
// To pay back: the allowances, the mileage, and the receipts paid privately
// (hospitality bills without a trip included, as they were paid). Receipts
// the company paid are listed for completeness and not paid back, and so are
// receipts booked as private outlays (#293): those are paid back through the
// outlay account, never twice.
//
// The checks:
//   errors    a trip without times or destination or reason, a hospitality
//             bill without what the law asks for, a privately paid receipt
//             without an amount, an employee without a clearing account
//             (#380), nothing to settle – no statement then
//   warnings  a day abroad without a rate, or with another country's (one
//             the BMF letter does not list: Luxembourg's; a territory: its
//             mother country's), a family member's car, a receipt in another
//             currency – the statement can be made, and says so

import { formatDate } from '../bank/format.js';
import { receiptDate, receiptVendor } from '../receipts/view.js';
import { cleanTrip, tripFigures, tripsOf } from './records.js';
import { euroOf, hospitalityOf, paidByGuess, receiptsOfTrip, travelKind } from './view.js';
import { advancesOf, allocateAdvances } from './advances.js';
import { statementChains } from './payout.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} ReceiptLine
 * @property {string} receiptId
 * @property {string} date
 * @property {string} vendor
 * @property {string | null} kind
 * @property {number | null} grossCents in euros (view.js euroOf); null: not known
 * @property {string} currency the receipt's own
 * @property {number | null} originalCents its gross in its own currency
 * @property {string | null} rate EUR per unit, where a rate made the euros
 * @property {{ rate: number, cents: number }[]} vat
 * @property {'private' | 'company'} paidBy
 * @property {boolean} outlay booked as a private outlay (#293): paid back through the outlay account, not here
 */

/**
 * @typedef {object} Check
 * @property {'error' | 'warning'} level
 * @property {string} code
 * @property {string} [tripId]
 * @property {string} [receiptId]
 * @property {string} [date]
 */

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;

/**
 * @param {Rec} r
 * @param {'private' | 'company'} paidBy
 * @param {Set<string>} outlays the receipts booked as private outlays
 * @param {{ transactions: Rec[], matches: Rec[] }} books for its euros
 * @returns {ReceiptLine}
 */
function receiptLine(r, paidBy, outlays, books) {
	const euro = euroOf(r, books);
	// VAT of another country is no German input VAT: it stays in the cost.
	const vat =
		euro.currency === 'EUR'
			? (Array.isArray(r.extraction?.vat) ? r.extraction.vat : [])
					.filter((/** @type {any} */ v) => typeof v?.rate === 'number' && cents(v.amount) !== 0)
					.map((/** @type {any} */ v) => ({ rate: v.rate, cents: cents(v.amount) }))
			: [];
	return {
		receiptId: String(r.id),
		date: receiptDate(/** @type {any} */ (r)) ?? '',
		vendor: receiptVendor(/** @type {any} */ (r)),
		kind: travelKind(r),
		grossCents: euro.cents,
		currency: euro.currency,
		originalCents: euro.originalCents,
		rate: euro.rate,
		vat,
		paidBy,
		outlay: outlays.has(String(r.id))
	};
}

/**
 * The statement of a traveller and month, as it would be made now.
 *
 * @param {object} p
 * @param {string} p.travellerId
 * @param {string} p.month YYYY-MM
 * @param {Rec[]} p.travel the travel collection's
 * @param {Rec[]} p.receipts
 * @param {Rec[]} [p.transactions] for who paid a hospitality bill without a trip, and the advances (#381)
 * @param {Rec[]} [p.matches]
 * @param {string | null} [p.corrects] the closed statement this one would replace: its advances become this one's
 */
export function statementOf({
	travellerId,
	month,
	travel,
	receipts,
	transactions = [],
	matches = [],
	corrects = null
}) {
	const ownTrips = travel.filter(
		(r) => r.kind === 'trip' && !r.deleted && r.travellerId === travellerId
	);
	const traveller = travel.find((r) => r.kind === 'traveller' && r.id === travellerId) ?? null;
	const employee = traveller?.role === 'employee';
	// Receipts booked as private outlays (#293) are paid back through the outlay account.
	const outlays = new Set(
		transactions
			.filter((t) => !t.deleted && t.source === 'outlay' && t.outlay?.receiptId)
			.map((t) => String(t.outlay.receiptId))
	);
	/** @type {Check[]} */
	const checks = [];
	/** @type {Map<string, any>} the rates used, each once */
	const rates = new Map();
	const trips = tripsOf(travel, { month, travellerId }).map((trip) => {
		const { problems } = cleanTrip(trip);
		if (problems.includes('noTimes') || problems.includes('endBeforeStart'))
			checks.push({ level: 'error', code: 'tripWithoutTimes', tripId: trip.id });
		if (problems.includes('noDestination'))
			checks.push({ level: 'error', code: 'tripWithoutDestination', tripId: trip.id });
		if (problems.includes('noReason'))
			checks.push({ level: 'error', code: 'tripWithoutReason', tripId: trip.id });
		const figures = tripFigures(trip, ownTrips, { traveller });
		for (const day of figures.allowance?.days ?? []) {
			if (day.rate)
				rates.set(
					`meal:${day.rate.country ?? day.country}:${day.rate.city ?? ''}:${day.rate.from}`,
					{
						kind: 'meal',
						country: day.country,
						...day.rate
					}
				);
			if (day.reason === 'noRate')
				checks.push({ level: 'warning', code: 'noRateAbroad', tripId: trip.id, date: day.date });
			if (day.rate?.via === 'notListed' || day.rate?.via === 'territory')
				checks.push({
					level: 'warning',
					code: day.rate.via === 'notListed' ? 'rateNotListed' : 'rateTerritory',
					tripId: trip.id,
					date: day.date
				});
		}
		// An employee's nights without an invoice (#380).
		for (const night of figures.lodging?.nights ?? []) {
			if (night.rate)
				rates.set(
					`lodging:${night.rate.country ?? night.country}:${night.rate.city ?? ''}:${night.rate.from}`,
					{ kind: 'lodging', country: night.country, ...night.rate }
				);
			else
				checks.push({ level: 'warning', code: 'lodgingNoRate', tripId: trip.id, date: night.date });
		}
		if (
			figures.lodging?.nights.length &&
			receiptsOfTrip(receipts, trip.id).some((r) => travelKind(r) === 'hotel')
		)
			checks.push({ level: 'warning', code: 'lodgingWithHotel', tripId: trip.id });
		for (const line of figures.mileage) {
			if (line.rate)
				rates.set(`km:${line.rate.from}:${line.rate.perKm}`, { kind: 'mileage', ...line.rate });
			if (line.flag === 'familyCar')
				checks.push({ level: 'warning', code: 'familyCar', tripId: trip.id });
		}
		const lines = receiptsOfTrip(receipts, trip.id)
			.map((r) =>
				receiptLine(r, r.travel?.paidBy === 'company' ? 'company' : 'private', outlays, {
					transactions,
					matches
				})
			)
			.sort((a, b) => a.date.localeCompare(b.date) || a.vendor.localeCompare(b.vendor));
		return { trip, figures, receipts: lines };
	});

	// Hospitality bills of the month that belong to no trip (decided: in the
	// month's statement) – the owner's, never an employee's as well (#380).
	const tripIds = new Set(ownTrips.map((x) => x.id));
	const hospitality = receipts
		.filter(
			(r) =>
				!employee &&
				!r.deleted &&
				r.status !== 'ignoriert' &&
				r.hospitality &&
				!(r.travel?.tripId && tripIds.has(r.travel.tripId)) &&
				(receiptDate(/** @type {any} */ (r)) ?? '').startsWith(month)
		)
		.map((r) => ({
			line: receiptLine(r, paidByGuess(r, { transactions, matches }), outlays, {
				transactions,
				matches
			}),
			split: hospitalityOf(r, { transactions, matches })
		}));
	// …and the hospitality bills on the trips.
	const tripHospitality = trips.flatMap((x) =>
		receiptsOfTrip(receipts, x.trip.id)
			.filter((r) => r.hospitality)
			.map((r) => ({ receiptId: String(r.id), split: hospitalityOf(r, { transactions, matches }) }))
	);
	for (const h of [
		...hospitality.map((x) => ({ receiptId: x.line.receiptId, split: x.split })),
		...tripHospitality
	]) {
		if (h.split.missing.length)
			checks.push({ level: 'error', code: 'hospitalityIncomplete', receiptId: h.receiptId });
		if (h.split.share)
			rates.set(`hosp:${h.split.share.from}`, { kind: 'hospitality', ...h.split.share });
	}

	const allLines = [...trips.flatMap((x) => x.receipts), ...hospitality.map((x) => x.line)];
	for (const l of allLines) {
		const foreign = l.currency !== 'EUR';
		// In another currency without its euros: never its amount taken as euros.
		if (foreign && l.originalCents !== null && l.grossCents === null)
			checks.push({
				level: l.paidBy === 'private' && !l.outlay ? 'error' : 'warning',
				code: 'foreignWithoutRate',
				receiptId: l.receiptId
			});
		else if (l.paidBy === 'private' && l.grossCents === null)
			checks.push({ level: 'error', code: 'receiptWithoutAmount', receiptId: l.receiptId });
		else if (foreign)
			checks.push({ level: 'warning', code: 'foreignCurrency', receiptId: l.receiptId });
	}
	if (employee && !String(traveller?.clearingAccount ?? '').trim())
		checks.push({ level: 'error', code: 'travellerWithoutAccount' });
	if (!trips.length && !hospitality.length) checks.push({ level: 'error', code: 'nothing' });

	const sum = (/** @type {number[]} */ xs) => xs.reduce((s, n) => s + n, 0);
	const privateCents = sum(
		allLines.filter((l) => l.paidBy === 'private' && !l.outlay).map((l) => l.grossCents ?? 0)
	);
	const outlayCents = sum(allLines.filter((l) => l.outlay).map((l) => l.grossCents ?? 0));
	const companyCents = sum(
		allLines.filter((l) => l.paidBy === 'company').map((l) => l.grossCents ?? 0)
	);
	const allowanceCents = sum(trips.map((x) => x.figures.allowanceCents));
	const mileageCents = sum(trips.map((x) => x.figures.mileageCents));
	const lodgingCents = sum(trips.map((x) => x.figures.lodgingCents));
	/** @type {Record<string, number>} input VAT by rate, from the receipts that carry it */
	const vatByRate = {};
	for (const l of allLines)
		for (const v of l.vat) vatByRate[v.rate] = (vatByRate[v.rate] ?? 0) + v.cents;
	const splits = [...hospitality.map((x) => x.split), ...tripHospitality.map((x) => x.split)];

	const toPayBackCents = allowanceCents + mileageCents + lodgingCents + privateCents;
	// Advances paid before (#381): those for its trips, and of the others what the
	// traveller's earlier statements leave – as the settlement will count them.
	const chains = statementChains(travel).filter(
		(c) => !corrects || !c.members.some((m) => String(m.id) === String(corrects))
	);
	const { byChain } = allocateAdvances(
		[
			...chains,
			{
				head: { travellerId, toPayBackCents },
				tripIds: trips.map((x) => String(x.trip.id))
			}
		],
		advancesOf(transactions)
	);
	const advances = /** @type {{ advance: import('./advances.js').Advance, cents: number }[]} */ (
		byChain.at(-1)
	).map((a) => ({
		transactionId: String(a.advance.tx.id),
		date: String(a.advance.tx.bookedOn ?? ''),
		tripId: a.advance.tripId,
		cents: a.cents
	}));
	const advanceCents = sum(advances.map((a) => a.cents));
	if (advanceCents > toPayBackCents) checks.push({ level: 'warning', code: 'advanceExceeds' });

	return {
		travellerId,
		month,
		trips,
		hospitality,
		advances,
		checks,
		ready: !checks.some((c) => c.level === 'error'),
		rates: [...rates.values()],
		totals: {
			allowanceCents,
			mileageCents,
			lodgingCents,
			privateCents,
			outlayCents,
			companyCents,
			vatByRate,
			hospitalityDeductibleCents: sum(splits.map((s) => s.deductibleCents)),
			hospitalityNonDeductibleCents: sum(splits.map((s) => s.nonDeductibleCents)),
			toPayBackCents,
			advanceCents,
			// What is left to pay out after the advances; below 0: the traveller owes it.
			toPayOutCents: toPayBackCents - advanceCents
		}
	};
}

/** @typedef {ReturnType<typeof statementOf>} Statement */

/**
 * What a closed statement keeps of itself: every line and figure it printed,
 * with the rates it used – so it stays as it was when the rates change.
 *
 * @param {Statement} s
 */
export function snapshotOf(s) {
	return {
		trips: s.trips.map((x) => ({
			tripId: String(x.trip.id),
			destination: x.trip.destination,
			reason: x.trip.reason,
			start: x.trip.start,
			end: x.trip.end,
			allowanceCents: x.figures.allowanceCents,
			mileageCents: x.figures.mileageCents,
			lodgingCents: x.figures.lodgingCents,
			nights: (x.figures.lodging?.nights ?? []).map((n) => ({
				date: n.date,
				country: n.country,
				city: n.city,
				cents: n.cents
			})),
			days: (x.figures.allowance?.days ?? []).map((d) => ({
				date: d.date,
				kind: d.kind,
				country: d.country,
				cents: d.cents,
				cutCents: d.cutCents,
				reason: d.reason
			})),
			mileage: x.figures.mileage.map((/** @type {any} */ m) => ({
				id: m.id,
				km: m.km,
				cents: m.cents,
				refused: m.refused,
				flag: m.flag
			})),
			receipts: x.receipts
		})),
		hospitality: s.hospitality.map((h) => ({
			...h.line,
			split: { ...h.split, share: h.split.share ?? null }
		})),
		advances: s.advances,
		totals: s.totals,
		rates: s.rates,
		warnings: s.checks.filter((c) => c.level === 'warning')
	};
}

/** The last day of a month. @param {string} month YYYY-MM */
export const lastDayOf = (month) => {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** A trip's times as a line: `04.05.2026 07:00 – 05.05.2026 19:30`. @param {Rec} trip */
export const tripTimes = (trip) =>
	[trip.start, trip.end]
		.filter(Boolean)
		.map((t) => `${formatDate(String(t).slice(0, 10))} ${String(t).slice(11, 16)}`)
		.join(' – ');
