import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import {
	assignReceipt,
	cleanTrip,
	closeStatement,
	deleteTrip,
	nextStatementNumber,
	ownerTraveller,
	saveStatement,
	saveTrip,
	setHospitality,
	tripFigures,
	tripsOf,
	unassignReceipt
} from './records.js';

// All travellers, trips and places here are made up.

const store = () => ({
	travel: memoryCollection('travel').collection,
	receipts: memoryCollection('receipts').collection
});
const corporation = { ...defaultDatevSettings(), legalForm: /** @type {const} */ ('corporation') };

const TRIP = {
	travellerId: 'T',
	destination: 'Musterstadt',
	reason: 'Workshop Kundin Beispiel UG',
	place: 'Kundin Beispiel UG',
	start: '2026-05-04T07:00',
	end: '2026-05-05T19:30'
};

describe('travellers (#213)', () => {
	it('the owner, made once, with the clearing account from Buchhaltung', async () => {
		const s = store();
		const first = await ownerTraveller(s, corporation, 'Inhaberin Beispiel');
		expect(first).toMatchObject({ kind: 'traveller', role: 'owner', clearingAccount: '' });
		const later = await ownerTraveller(s, { ...corporation, shareholderAccount: '1520' });
		expect(later).toMatchObject({ id: first.id, clearingAccount: '1520' });
		expect(await s.travel.list()).toHaveLength(1);
		const sole = await ownerTraveller(store(), { ...defaultDatevSettings(), legalForm: 'sole' });
		expect(sole.clearingAccount).toBe('1890');
	});
});

describe('trips (#213)', () => {
	it('kept clean, with what they lack named rather than refused', () => {
		const { trip, problems } = cleanTrip({
			...TRIP,
			start: 'tomorrow',
			stops: [{ at: '2026-05-04T12:00', country: 'at' }],
			meals: { '2026-05-05': { breakfast: true }, '2026-05-06': {} },
			mileage: [
				{ id: 'm1', date: '2026-05-04', km: '42.36', vehicle: 'family', owner: 'Ehepartner' }
			],
			extra: 'dropped'
		});
		expect(trip).not.toHaveProperty('extra');
		expect(trip.start).toBe('');
		expect(trip.stops).toEqual([]);
		expect(trip.meals).toEqual({ '2026-05-05': { breakfast: true, lunch: false, dinner: false } });
		expect(trip.mileage[0]).toMatchObject({
			km: 42.4,
			vehicle: 'family',
			owner: 'Ehepartner',
			costBearer: '',
			type: 'car'
		});
		expect(problems).toEqual(['noTimes']);
		expect(cleanTrip({ ...TRIP, end: '2026-05-03T07:00' }).problems).toEqual(['endBeforeStart']);
		expect(cleanTrip({ mileage: [{ id: 'm', vehicle: 'own' }] }).problems).toEqual([
			'noTraveller',
			'noDestination',
			'noReason',
			'noTimes',
			'mileage:m:noKm',
			'mileage:m:noDate',
			'mileage:m:noReason'
		]);
	});

	it('saved and listed by the month it starts in', async () => {
		const s = store();
		const { trip } = await saveTrip(s, TRIP);
		await saveTrip(s, { ...TRIP, start: '2026-06-01T07:00', end: '2026-06-01T18:00' });
		await saveTrip(s, { ...TRIP, travellerId: 'U' });
		const may = tripsOf(await s.travel.list(), { month: '2026-05', travellerId: 'T' });
		expect(may.map((t) => t.id)).toEqual([trip.id]);
		const changed = await saveTrip(s, { ...trip, destination: 'Beispielhausen' });
		expect(changed.trip).toMatchObject({ id: trip.id, destination: 'Beispielhausen' });
		await expect(saveTrip(s, { ...TRIP, id: '01J0000000000000000000000Z' })).rejects.toThrow(
			/No trip/
		);
	});

	it('what a trip comes to: allowance, three-month rule across trips, mileage', async () => {
		const s = store();
		const { trip } = await saveTrip(s, {
			...TRIP,
			meals: { '2026-05-05': { breakfast: true } },
			mileage: [
				{ date: '2026-05-04', km: 120, roundTrip: true, vehicle: 'family', reason: 'Workshop' },
				{ date: '2026-05-05', km: 30, vehicle: 'company', reason: 'Workshop' }
			]
		});
		const f = tripFigures(trip, []);
		expect(f.allowanceCents).toBe(1400 + 1400 - 560);
		expect(f.mileage.map((/** @type {any} */ l) => [l.cents, l.flag, l.refused])).toEqual([
			[7200, 'familyCar', null],
			[0, null, 'company']
		]);
		expect(f.mileageCents).toBe(7200);

		// Every weekday at the same place since February: by May the three months are over.
		const earlier = [];
		for (
			let d = new Date('2026-02-02T00:00Z');
			d < new Date('2026-05-04T00:00Z');
			d.setUTCDate(d.getUTCDate() + 1)
		) {
			const day = d.toISOString().slice(0, 10);
			earlier.push({
				...TRIP,
				id: `t-${day}`,
				kind: 'trip',
				start: `${day}T07:00`,
				end: `${day}T17:00`
			});
		}
		const cut = tripFigures(trip, earlier);
		expect(cut.allowance?.days.map((d) => d.reason)).toEqual(['threeMonthRule', 'threeMonthRule']);
		// Another traveller's trips there do not count.
		expect(
			tripFigures(
				trip,
				earlier.map((t) => ({ ...t, travellerId: 'U' }))
			).allowanceCents
		).toBe(2240);
		expect(tripFigures({ ...trip, end: '' }, []).allowance).toBeNull();
	});
});

describe('receipts on a trip (#213)', () => {
	it('assigned with who paid, taken off again, and off when the trip goes', async () => {
		const s = store();
		const { trip } = await saveTrip(s, TRIP);
		const r = await s.receipts.put({ status: 'ausgelesen', amountCents: 8900 });
		const assigned = await assignReceipt(s, {
			receiptId: r.id,
			tripId: trip.id,
			paidBy: 'private'
		});
		expect(assigned.travel).toEqual({ tripId: trip.id, paidBy: 'private' });
		await expect(
			assignReceipt(s, { receiptId: r.id, tripId: trip.id, paidBy: /** @type {any} */ ('nobody') })
		).rejects.toThrow();
		expect((await unassignReceipt(s, r.id)).travel).toBeNull();

		await assignReceipt(s, { receiptId: r.id, tripId: trip.id, paidBy: 'company' });
		await deleteTrip(s, trip.id);
		expect((await s.receipts.get(r.id))?.travel).toBeNull();
		expect((await s.travel.get(trip.id))?.deleted).toBe(true);
		await expect(
			assignReceipt(s, { receiptId: r.id, tripId: trip.id, paidBy: 'private' })
		).rejects.toThrow(/No trip/);
	});

	it('hospitality details on the bill, with or without a trip', async () => {
		const s = store();
		const r = await s.receipts.put({ status: 'ausgelesen', amountCents: 11900 });
		const kept = await setHospitality(s, r.id, {
			place: ' Gasthaus Beispiel ',
			participants: ['Inhaberin Beispiel', '', 'Kunde Beispiel'],
			occasion: 'Angebot Projekt Nord',
			tipCents: 800,
			tipTo: 'Bedienung'
		});
		expect(kept.hospitality).toEqual({
			place: 'Gasthaus Beispiel',
			participants: ['Inhaberin Beispiel', 'Kunde Beispiel'],
			occasion: 'Angebot Projekt Nord',
			tipCents: 800,
			tipTo: 'Bedienung'
		});
		await expect(setHospitality(s, r.id, { tipCents: 1.5 })).rejects.toThrow();
		expect((await setHospitality(s, r.id, null)).hospitality).toBeNull();
	});
});

describe('statements (#213)', () => {
	it('a draft changes, a closed one does not; numbers count per year', async () => {
		const s = store();
		const draft = await saveStatement(s, { travellerId: 'T', month: '2026-05' });
		expect(draft).toMatchObject({
			kind: 'statement',
			state: 'draft',
			number: null,
			corrects: null
		});
		await saveStatement(s, { ...draft, note: 'checked' });
		const closed = await closeStatement(s, draft.id, () => new Date('2026-06-02T10:00:00Z'));
		expect(closed).toMatchObject({
			state: 'closed',
			number: 'RK-2026-001',
			closedAt: '2026-06-02T10:00:00.000Z'
		});
		await expect(saveStatement(s, { ...closed, note: 'changed' })).rejects.toThrow(/closed/);
		await expect(closeStatement(s, draft.id)).rejects.toThrow(/closed/);

		const correction = await saveStatement(s, {
			travellerId: 'T',
			month: '2026-05',
			corrects: closed.id
		});
		expect((await closeStatement(s, correction.id)).number).toBe('RK-2026-002');
		await expect(saveStatement(s, { travellerId: 'T', month: 'May' })).rejects.toThrow();
		expect(nextStatementNumber(await s.travel.list(), 2027)).toBe('RK-2027-001');
	});
});

describe('a rate for a receipt in another currency (#213)', async () => {
	const { setTravelEuro } = await import('./records.js');
	it('kept with the trip link, in euros; kept when who paid changes; taken off again', async () => {
		const s = store();
		const { trip } = await saveTrip(s, TRIP);
		const r = await s.receipts.put({
			status: 'ausgelesen',
			currency: 'RUB',
			amountCents: 1_499_000
		});
		await expect(setTravelEuro(s, r.id, { rate: '0.0105', source: 'cbr' })).rejects.toThrow(
			/no trip/
		);
		await assignReceipt(s, { receiptId: r.id, tripId: trip.id, paidBy: 'private' });
		const kept = await setTravelEuro(s, r.id, { rate: '0.0105', source: 'cbr', at: '2025-03-14' });
		expect(kept.travel).toEqual({
			tripId: trip.id,
			paidBy: 'private',
			euro: { cents: 15740, rate: '0.0105', source: 'cbr', at: '2025-03-14' }
		});
		const moved = await assignReceipt(s, { receiptId: r.id, tripId: trip.id, paidBy: 'company' });
		expect(moved.travel.euro.cents).toBe(15740);
		expect((await setTravelEuro(s, r.id, null)).travel).toEqual({
			tripId: trip.id,
			paidBy: 'company'
		});
	});
});
