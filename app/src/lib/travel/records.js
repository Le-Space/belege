// The records of travel expenses (issue #213, step 2): travellers, trips with
// their mileage lines, and statements, in one sealed collection `travel`,
// told apart by `kind`. A receipt says itself which trip it belongs to and
// who paid it (`receipt.travel`), and a restaurant bill carries its
// hospitality details (`receipt.hospitality`), with or without a trip.
//
// For now one traveller: the owner or managing shareholder (decided 12.10.).
// Employees can follow as more traveller records.
//
// What a trip lacks (times, a reason, km) is named, not refused: a trip is
// written down as it is known and completed later; the calculation leaves out
// what it cannot compute (allowance.js, mileage.js).

import { privateAccounts } from '../booking/settings.js';
import { euroCents } from '../outlays/outlays.js';
import { mealAllowance, threeMonthCuts } from './allowance.js';
import { mileage } from './mileage.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {import('../store/repository.js').Collection} Collection */

/** `dismissed`: a trip proposal said no to (proposals.js, step 4b). */
export const KINDS = /** @type {const} */ (['traveller', 'trip', 'statement', 'dismissed']);
export const ROLES = /** @type {const} */ (['owner']);
export const PAID_BY = /** @type {const} */ (['private', 'company']);
export const VEHICLES = /** @type {const} */ (['own', 'family', 'rental', 'company']);
export const VEHICLE_TYPES = /** @type {const} */ (['car', 'motorcycle', 'bicycle']);

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** @param {unknown} v */
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The traveller who is the owner or managing shareholder, made once. Their
 * clearing account comes from the legal form in Buchhaltung, where it names one.
 *
 * @param {{ travel: Collection }} store
 * @param {import('../booking/settings.js').DatevSettings} settings cleaned
 * @param {string} [name]
 */
export async function ownerTraveller(store, settings, name = '') {
	const [found] = await store.travel.list({
		where: (r) => r.kind === 'traveller' && r.role === 'owner'
	});
	const clearing = privateAccounts(settings).repayment ?? '';
	if (found) {
		if (!found.clearingAccount && clearing)
			return store.travel.put({ ...found, clearingAccount: clearing });
		return found;
	}
	return store.travel.put({
		kind: 'traveller',
		role: 'owner',
		name: text(name),
		clearingAccount: clearing,
		ibanLast4: ''
	});
}

/**
 * A mileage line as it is kept: unknown fields dropped, the family car's
 * owner and cost bearer only where they belong.
 *
 * @param {Rec} line
 * @returns {import('./mileage.js').MileageLine & { id: string, plate?: string }}
 */
export function cleanMileageLine(line) {
	const vehicle = VEHICLES.includes(line?.vehicle) ? line.vehicle : 'own';
	const km = Number(line?.km);
	return {
		id: text(line?.id) || crypto.randomUUID(),
		date: DAY.test(line?.date) ? line.date : '',
		from: text(line?.from),
		to: text(line?.to),
		reason: text(line?.reason),
		km: Number.isFinite(km) && km > 0 ? Math.round(km * 10) / 10 : 0,
		roundTrip: line?.roundTrip === true,
		vehicle,
		type: VEHICLE_TYPES.includes(line?.type) ? line.type : 'car',
		...(vehicle === 'family'
			? { owner: text(line?.owner), costBearer: text(line?.costBearer) }
			: {}),
		...(text(line?.plate) ? { plate: text(line.plate) } : {})
	};
}

/**
 * A trip as it is kept, and what it still lacks.
 *
 * @param {Rec} input
 * @returns {{ trip: Rec, problems: string[] }}
 */
export function cleanTrip(input) {
	const start = TIME.test(input?.start) ? input.start : '';
	const end = TIME.test(input?.end) ? input.end : '';
	const stops = (Array.isArray(input?.stops) ? input.stops : [])
		.filter((/** @type {any} */ s) => TIME.test(s?.at) && COUNTRY.test(s?.country))
		.map((/** @type {any} */ s) => ({ at: s.at, country: s.country }))
		.sort((/** @type {any} */ a, /** @type {any} */ b) => a.at.localeCompare(b.at));
	/** @type {Record<string, { breakfast: boolean, lunch: boolean, dinner: boolean }>} */
	const meals = {};
	for (const [date, m] of Object.entries(input?.meals ?? {})) {
		if (!DAY.test(date) || !m) continue;
		const meal = {
			breakfast: m.breakfast === true,
			lunch: m.lunch === true,
			dinner: m.dinner === true
		};
		if (meal.breakfast || meal.lunch || meal.dinner) meals[date] = meal;
	}
	const trip = {
		...(input?.id ? { id: input.id } : {}),
		kind: 'trip',
		travellerId: text(input?.travellerId),
		destination: text(input?.destination),
		reason: text(input?.reason),
		// The place of activity, for the three-month rule: a customer, a site.
		place: text(input?.place),
		start,
		end,
		country: COUNTRY.test(input?.country) ? input.country : 'DE',
		stops,
		overnight: typeof input?.overnight === 'boolean' ? input.overnight : null,
		meals,
		mileage: (Array.isArray(input?.mileage) ? input.mileage : []).map(cleanMileageLine),
		note: text(input?.note)
	};
	const problems = [];
	if (!trip.travellerId) problems.push('noTraveller');
	if (!trip.destination) problems.push('noDestination');
	if (!trip.reason) problems.push('noReason');
	if (!start || !end) problems.push('noTimes');
	else if (end <= start) problems.push('endBeforeStart');
	for (const line of trip.mileage) {
		if (!line.km) problems.push(`mileage:${line.id}:noKm`);
		if (!line.date) problems.push(`mileage:${line.id}:noDate`);
		if (!line.reason && !trip.reason) problems.push(`mileage:${line.id}:noReason`);
	}
	return { trip, problems };
}

/**
 * Write a trip, new or changed.
 *
 * @param {{ travel: Collection }} store
 * @param {Rec} input
 */
export async function saveTrip(store, input) {
	if (input?.id) {
		const before = await store.travel.get(input.id);
		if (!before || before.kind !== 'trip') throw new Error(`No trip with id ${input.id}`);
	}
	const { trip, problems } = cleanTrip(input);
	return { trip: await store.travel.put(trip), problems };
}

/**
 * Delete a trip; its receipts are no longer assigned to it.
 *
 * @param {{ travel: Collection, receipts: Collection }} store
 * @param {string} id
 */
export async function deleteTrip(store, id) {
	const assigned = await store.receipts.list({ where: (r) => r.travel?.tripId === id });
	for (const r of assigned) await store.receipts.put({ ...r, travel: null });
	return store.travel.softDelete(id);
}

/**
 * A receipt to a trip, and who paid it. A receipt belongs to one trip at most.
 *
 * @param {{ travel: Collection, receipts: Collection }} store
 * @param {object} p
 * @param {string} p.receiptId
 * @param {string} p.tripId
 * @param {'private' | 'company'} p.paidBy
 */
export async function assignReceipt(store, { receiptId, tripId, paidBy }) {
	if (!PAID_BY.includes(paidBy)) throw new Error(`Who paid: ${paidBy}`);
	const trip = await store.travel.get(tripId);
	if (!trip || trip.deleted || trip.kind !== 'trip') throw new Error(`No trip with id ${tripId}`);
	const receipt = await store.receipts.get(receiptId);
	if (!receipt || receipt.deleted) throw new Error(`No receipt with id ${receiptId}`);
	// A rate kept for this trip stays when who paid changes.
	const euro =
		receipt.travel?.tripId === tripId && receipt.travel?.euro ? { euro: receipt.travel.euro } : {};
	return store.receipts.put({ ...receipt, travel: { tripId, paidBy, ...euro } });
}

/**
 * @param {{ receipts: Collection }} store
 * @param {string} receiptId
 */
export async function unassignReceipt(store, receiptId) {
	const receipt = await store.receipts.get(receiptId);
	if (!receipt) throw new Error(`No receipt with id ${receiptId}`);
	return store.receipts.put({ ...receipt, travel: null });
}

/**
 * The hospitality details of a restaurant bill: what the law asks for, kept
 * on the receipt. `null` takes them off again.
 *
 * @param {{ receipts: Collection }} store
 * @param {string} receiptId
 * @param {{ place?: string, participants?: string[], occasion?: string, tipCents?: number, tipTo?: string } | null} details
 */
export async function setHospitality(store, receiptId, details) {
	const receipt = await store.receipts.get(receiptId);
	if (!receipt || receipt.deleted) throw new Error(`No receipt with id ${receiptId}`);
	if (details === null) return store.receipts.put({ ...receipt, hospitality: null });
	const tip = Number(details.tipCents ?? 0);
	if (!Number.isSafeInteger(tip) || tip < 0)
		throw new Error(`Not a tip in cents: ${details.tipCents}`);
	return store.receipts.put({
		...receipt,
		hospitality: {
			place: text(details.place),
			participants: (details.participants ?? []).map(text).filter(Boolean),
			occasion: text(details.occasion),
			tipCents: tip,
			tipTo: text(details.tipTo)
		}
	});
}

/**
 * The euros of a receipt on a trip in another currency, by a rate: EUR per
 * unit (outlays.js `euroCents`), from the bridge (ECB, Bank of Russia …) or
 * typed from a document. Kept with the receipt's trip link; `null` takes it
 * off again.
 *
 * @param {{ receipts: Collection }} store
 * @param {string} receiptId
 * @param {{ rate: string, source: string, at?: string } | null} rate
 */
export async function setTravelEuro(store, receiptId, rate) {
	const receipt = await store.receipts.get(receiptId);
	if (!receipt || receipt.deleted) throw new Error(`No receipt with id ${receiptId}`);
	if (!receipt.travel?.tripId) throw new Error('The receipt is on no trip.');
	if (rate === null) {
		const rest = { ...receipt.travel };
		delete rest.euro;
		return store.receipts.put({ ...receipt, travel: rest });
	}
	if (!Number.isSafeInteger(receipt.amountCents)) throw new Error('The receipt has no amount.');
	const cents = euroCents(Math.abs(receipt.amountCents), rate.rate);
	return store.receipts.put({
		...receipt,
		travel: {
			...receipt.travel,
			euro: {
				cents,
				rate: String(rate.rate),
				source: String(rate.source),
				...(rate.at ? { at: String(rate.at) } : {})
			}
		}
	});
}

/** The month a trip counts in: the one it starts in. @param {Rec} trip */
export const tripMonth = (trip) => (TIME.test(trip.start) ? trip.start.slice(0, 7) : null);

/**
 * The trips of a month, of one traveller or all, earliest first.
 *
 * @param {Rec[]} records the travel collection's
 * @param {{ month: string, travellerId?: string }} p
 */
export function tripsOf(records, { month, travellerId }) {
	return records
		.filter(
			(r) =>
				r.kind === 'trip' &&
				!r.deleted &&
				tripMonth(r) === month &&
				(!travellerId || r.travellerId === travellerId)
		)
		.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

/** Each date a trip spans; none without valid times. @param {Rec} trip */
export function tripDates(trip) {
	if (!TIME.test(trip.start) || !TIME.test(trip.end) || trip.end <= trip.start) return [];
	const out = [];
	const last = new Date(`${trip.end.slice(0, 10)}T00:00Z`);
	for (
		let d = new Date(`${trip.start.slice(0, 10)}T00:00Z`);
		d <= last;
		d.setUTCDate(d.getUTCDate() + 1)
	)
		out.push(d.toISOString().slice(0, 10));
	return out;
}

/**
 * What a trip comes to by the rules (step 1): its meal allowance, cut by the
 * three-month rule from all of the traveller's trips to the same place, and
 * its mileage lines.
 *
 * @param {Rec} trip
 * @param {Rec[]} trips the traveller's other trips, for the three-month rule
 * @param {{ familyCar?: import('./mileage.js').FamilyCarRule }} [settings]
 */
export function tripFigures(trip, trips, settings = {}) {
	const timed = TIME.test(trip.start) && TIME.test(trip.end) && trip.end > trip.start;
	let cut;
	if (trip.place && timed) {
		const visits = [trip, ...trips.filter((t) => t.id !== trip.id)]
			.filter(
				(t) =>
					t.kind === 'trip' &&
					!t.deleted &&
					t.place === trip.place &&
					t.travellerId === trip.travellerId
			)
			.flatMap((t) => tripDates(t).map((date) => ({ place: t.place, date })));
		cut = threeMonthCuts(visits).get(trip.place);
	}
	const allowance = timed
		? mealAllowance({
				start: trip.start,
				end: trip.end,
				country: trip.country,
				stops: trip.stops,
				...(typeof trip.overnight === 'boolean' ? { overnight: trip.overnight } : {}),
				meals: trip.meals,
				...(cut ? { cut } : {})
			})
		: null;
	const lines = (trip.mileage ?? []).map((/** @type {any} */ line) => ({
		id: line.id,
		...mileage(line, settings)
	}));
	return {
		allowance,
		mileage: lines,
		allowanceCents: allowance?.cents ?? 0,
		mileageCents: lines.reduce((/** @type {number} */ s, /** @type {any} */ l) => s + l.cents, 0)
	};
}

/**
 * The next statement number of a year: `RK-2026-001`, counting the closed
 * statements of that year, corrections included.
 *
 * @param {Rec[]} records the travel collection's
 * @param {number} year
 */
export function nextStatementNumber(records, year) {
	const prefix = `RK-${year}-`;
	const used = records
		.filter((r) => r.kind === 'statement' && String(r.number ?? '').startsWith(prefix))
		.map((r) => Number(String(r.number).slice(prefix.length)))
		.filter(Number.isSafeInteger);
	return `${prefix}${String(Math.max(0, ...used) + 1).padStart(3, '0')}`;
}

/**
 * Write a statement's draft. A closed one is not changed: a correction is a
 * new statement that refers to it (`corrects`).
 *
 * @param {{ travel: Collection }} store
 * @param {Rec} input
 */
export async function saveStatement(store, input) {
	if (input?.id) {
		const before = await store.travel.get(input.id);
		if (!before || before.kind !== 'statement') throw new Error(`No statement with id ${input.id}`);
		if (before.state === 'closed') throw new Error('A closed statement is not changed.');
	}
	if (!/^\d{4}-\d{2}$/.test(input?.month ?? '')) throw new Error(`Not a month: ${input?.month}`);
	if (!text(input?.travellerId)) throw new Error('A statement needs its traveller.');
	return store.travel.put({
		...input,
		kind: 'statement',
		state: 'draft',
		number: null,
		corrects: input.corrects ?? null
	});
}

/**
 * Close a statement: it gets its number and the time, and is not changed
 * again.
 *
 * @param {{ travel: Collection }} store
 * @param {string} id
 * @param {() => Date} [now]
 */
export async function closeStatement(store, id, now = () => new Date()) {
	const statement = await store.travel.get(id);
	if (!statement || statement.deleted || statement.kind !== 'statement')
		throw new Error(`No statement with id ${id}`);
	if (statement.state === 'closed') throw new Error('This statement is closed already.');
	const all = await store.travel.list({ includeDeleted: true });
	const year = Number(statement.month.slice(0, 4));
	return store.travel.put({
		...statement,
		state: 'closed',
		number: nextStatementNumber(all, year),
		closedAt: now().toISOString()
	});
}
