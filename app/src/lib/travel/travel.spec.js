import { describe, expect, it } from 'vitest';

import { mealAllowance, threeMonthCuts } from './allowance.js';
import { hospitality } from './hospitality.js';
import { mileage } from './mileage.js';
import { MEAL_RATES, mealRate, rateOn } from './rates.js';

// All trips, places and people here are made up.

/** Every day from one date to another. @param {string} from @param {string} to */
const daysFrom = (from, to) => {
	const out = [];
	for (
		let d = new Date(`${from}T00:00Z`);
		d <= new Date(`${to}T00:00Z`);
		d.setUTCDate(d.getUTCDate() + 1)
	)
		out.push(d.toISOString().slice(0, 10));
	return out;
};

describe('the rates table (#213)', () => {
	it('takes the entry that applies on the day', () => {
		expect(mealRate('DE', '2019-12-31')).toMatchObject({ full: 2400, partial: 1200 });
		expect(mealRate('DE', '2026-05-04')).toMatchObject({ full: 2800, partial: 1400 });
		expect(mealRate('DE', '2013-06-01')).toBeNull();
		// Abroad from the BMF letter in force (#379); none before the first one in the table.
		expect(mealRate('AT', '2026-05-04')).toMatchObject({ full: 5000, partial: 3300 });
		expect(mealRate('AT', '2024-05-04')).toBeNull();
		expect(rateOn(MEAL_RATES, '2026-05-04', (r) => r.country === 'DE')?.from).toBe('2020-01-01');
	});
});

describe('meal allowance (#213)', () => {
	it('one day: more than 8 hours away, or nothing', () => {
		const long = mealAllowance({ start: '2026-05-04T07:00', end: '2026-05-04T16:30' });
		expect(long.cents).toBe(1400);
		expect(long.days[0]).toMatchObject({ kind: 'partial', minutes: 570, country: 'DE' });
		expect(long.days[0].rate?.source).toMatch(/EStG/);
		const short = mealAllowance({ start: '2026-05-04T07:00', end: '2026-05-04T15:00' });
		expect(short).toMatchObject({ cents: 0, days: [{ kind: 'none', reason: 'under8h' }] });
	});

	it('across midnight without a night away: the hours add up on the day with most of them', () => {
		const evening = mealAllowance({
			start: '2026-05-04T17:00',
			end: '2026-05-05T03:00',
			overnight: false
		});
		expect(evening.cents).toBe(1400);
		expect(evening.days.map((d) => [d.date, d.kind, d.minutes, d.reason])).toEqual([
			['2026-05-04', 'partial', 600, null],
			['2026-05-05', 'none', 180, 'countedOnOtherDay']
		]);
		const night = mealAllowance({
			start: '2026-05-04T20:00',
			end: '2026-05-05T06:00',
			overnight: false
		});
		expect(night.days.map((d) => d.kind)).toEqual(['none', 'partial']);
		const tooShort = mealAllowance({
			start: '2026-05-04T21:00',
			end: '2026-05-05T04:00',
			overnight: false
		});
		expect(tooShort.cents).toBe(0);
		expect(() =>
			mealAllowance({ start: '2026-05-04T21:00', end: '2026-05-06T04:00', overnight: false })
		).toThrow();
	});

	it('with nights away: departure and arrival partial, the days between full', () => {
		const trip = mealAllowance({ start: '2026-05-04T08:00', end: '2026-05-06T18:00' });
		expect(trip.days.map((d) => d.kind)).toEqual(['partial', 'full', 'partial']);
		expect(trip.cents).toBe(1400 + 2800 + 1400);
		// An arrival day of one hour still counts after a night away.
		const late = mealAllowance({ start: '2026-05-04T08:00', end: '2026-05-05T01:00' });
		expect(late.cents).toBe(2800);
		// Before 2020, the older rates.
		expect(mealAllowance({ start: '2019-05-06T08:00', end: '2019-05-08T18:00' }).cents).toBe(
			1200 + 2400 + 1200
		);
	});

	it('meals provided cut the day by a share of the full rate, never below nothing', () => {
		const trip = mealAllowance({
			start: '2026-05-04T08:00',
			end: '2026-05-06T18:00',
			meals: {
				'2026-05-05': { breakfast: true },
				'2026-05-06': { breakfast: true, lunch: true }
			}
		});
		expect(trip.days.map((d) => [d.cents, d.cutCents])).toEqual([
			[1400, 0],
			[2800 - 560, 560],
			[0, 1400]
		]);
		const fed = mealAllowance({
			start: '2026-05-04T08:00',
			end: '2026-05-06T18:00',
			meals: { '2026-05-05': { breakfast: true, lunch: true, dinner: true } }
		});
		expect(fed.days[1]).toMatchObject({ cents: 0, cutCents: 2800 });
	});

	it('abroad: the country reached last before midnight; home again, the last one abroad; no rate made up', () => {
		// Austria in 2026 (BMF letter of 5 Dec 2025): 50 € a full day, 33 € the days there and back.
		const vienna = mealAllowance({
			start: '2026-05-04T06:00',
			end: '2026-05-05T18:00',
			stops: [
				{ at: '2026-05-04T10:00', country: 'AT' },
				{ at: '2026-05-05T15:00', country: 'DE' }
			]
		});
		expect(vienna.days.map((d) => [d.country, d.cents, d.reason])).toEqual([
			['AT', 3300, null],
			['AT', 3300, null]
		]);
		expect(vienna.days[0].rate?.source).toMatch(/5\. Dezember 2025/);
		// Before the first letter in the table: no rate, nothing made up.
		const earlier = mealAllowance({
			start: '2024-05-04T06:00',
			end: '2024-05-05T18:00',
			stops: [{ at: '2024-05-04T10:00', country: 'AT' }]
		});
		expect(earlier).toMatchObject({ cents: 0, missing: ['2024-05-04', '2024-05-05'] });
		expect(earlier.days[0].reason).toBe('noRate');

		// Over the border and back on the first day, then two days at home.
		const back = mealAllowance({
			start: '2026-05-04T06:00',
			end: '2026-05-06T12:00',
			stops: [
				{ at: '2026-05-04T08:00', country: 'NL' },
				{ at: '2026-05-04T20:00', country: 'DE' }
			]
		});
		expect(back.days.map((d) => [d.country, d.cents])).toEqual([
			['NL', 3900],
			['DE', 2800],
			['DE', 1400]
		]);

		// Two countries on one day: the one reached last counts.
		const two = mealAllowance({
			start: '2026-05-04T06:00',
			end: '2026-05-05T20:00',
			stops: [
				{ at: '2026-05-04T09:00', country: 'BE' },
				{ at: '2026-05-04T15:00', country: 'FR' }
			]
		});
		expect(two.days.map((d) => d.country)).toEqual(['FR', 'FR']);
	});

	it('abroad: a city with rates of its own, also on the day home; a meal cut by its full day (#379)', () => {
		// A made-up trip to Moscow, 2026: Moskau 30 € / 20 €, the rest of Russia 28 € / 19 €.
		const moscow = mealAllowance({
			start: '2026-05-04T05:00',
			end: '2026-05-07T22:00',
			stops: [
				{ at: '2026-05-04T12:00', country: 'RU', city: 'Moskau' },
				{ at: '2026-05-06T09:00', country: 'RU' },
				{ at: '2026-05-07T18:00', country: 'DE' }
			],
			meals: { '2026-05-05': { breakfast: true } }
		});
		expect(moscow.days.map((d) => [d.date, d.city ?? null, d.cents, d.cutCents])).toEqual([
			['2026-05-04', 'Moskau', 2000, 0],
			// A full day in Moscow, breakfast provided: 20 % of its 30 €.
			['2026-05-05', 'Moskau', 2400, 600],
			['2026-05-06', null, 2800, 0],
			// Home that day: the rest of Russia, reached last abroad.
			['2026-05-07', null, 1900, 0]
		]);
		expect(moscow.days[0].rate).toMatchObject({ country: 'RU', city: 'Moskau', via: null });
		expect(moscow.cents).toBe(2000 + 2400 + 2800 + 1900);
	});

	it('the three-month rule: cut from three months on at one place, until four weeks away', () => {
		const spring = daysFrom('2026-01-12', '2026-04-30').map((date) => ({
			place: 'Werk Nord',
			date
		}));
		const cuts = threeMonthCuts([...spring, { place: 'Messe West', date: '2026-03-03' }]);
		expect([...(cuts.get('Werk Nord') ?? [])][0]).toBe('2026-04-12');
		expect(cuts.get('Werk Nord')?.has('2026-04-11')).toBe(false);
		expect(cuts.has('Messe West')).toBe(false);

		// 27 days away do not start the count again, 28 do.
		const after27 = threeMonthCuts([...spring, { place: 'Werk Nord', date: '2026-05-28' }]);
		expect(after27.get('Werk Nord')?.has('2026-05-28')).toBe(true);
		const after28 = threeMonthCuts([...spring, { place: 'Werk Nord', date: '2026-05-29' }]);
		expect(after28.get('Werk Nord')?.has('2026-05-29')).toBe(false);

		// The end of a month: from 30 November, three months on is the last day of February.
		const winter = daysFrom('2026-11-30', '2027-03-01').map((date) => ({
			place: 'Werk Nord',
			date
		}));
		expect([...(threeMonthCuts(winter).get('Werk Nord') ?? [])][0]).toBe('2027-02-28');

		const cut = mealAllowance({
			start: '2026-04-11T07:00',
			end: '2026-04-13T18:00',
			cut: cuts.get('Werk Nord')
		});
		expect(cut.days.map((d) => [d.cents, d.reason])).toEqual([
			[1400, null],
			[0, 'threeMonthRule'],
			[0, 'threeMonthRule']
		]);
	});
});

describe('mileage (#213)', () => {
	const line = {
		date: '2026-05-04',
		from: 'Office',
		to: 'Kundin Beispiel UG',
		reason: 'Projektbesprechung',
		km: 42
	};

	it('own car and motorcycle by the table, a round trip twice', () => {
		expect(mileage({ ...line, vehicle: 'own' })).toMatchObject({ km: 42, cents: 1260, flag: null });
		expect(mileage({ ...line, vehicle: 'own', roundTrip: true }).cents).toBe(2520);
		expect(mileage({ ...line, vehicle: 'own', type: 'motorcycle' })).toMatchObject({
			cents: 840,
			rate: { perKm: 20 }
		});
		expect(mileage({ ...line, vehicle: 'own', type: 'bicycle' })).toMatchObject({
			cents: 0,
			refused: 'noFlatRate'
		});
		expect(mileage({ ...line, vehicle: 'own', km: 0 }).refused).toBe('noKm');
	});

	it('a family member’s car: the rate from the table, flagged until a setting decides', () => {
		const family = {
			...line,
			vehicle: /** @type {const} */ ('family'),
			owner: 'Ehepartner',
			costBearer: 'Ehepartner',
			km: 118.5,
			roundTrip: true
		};
		expect(mileage(family)).toEqual({
			km: 237,
			cents: 7110,
			rate: { from: '2014-01-01', perKm: 30, source: expect.stringMatching(/EStG/) },
			refused: null,
			flag: 'familyCar'
		});
		expect(mileage(family, { familyCar: 'flatRate' })).toMatchObject({ cents: 7110, flag: null });
		expect(mileage(family, { familyCar: 'none' })).toMatchObject({ cents: 0, flag: null });
	});

	it('no mileage for a company car or a rental', () => {
		expect(mileage({ ...line, vehicle: 'company' })).toMatchObject({
			cents: 0,
			refused: 'company'
		});
		expect(mileage({ ...line, vehicle: 'rental' })).toMatchObject({ cents: 0, refused: 'rental' });
	});
});

describe('hospitality (#213)', () => {
	it('70 % of the net costs and the tip deductible, the input VAT in full', () => {
		const meal = hospitality({
			date: '2026-05-05',
			grossCents: 11900,
			vatCents: 1900,
			tipCents: 800,
			tipTo: 'Bedienung',
			place: 'Gasthaus Beispiel',
			participants: ['Inhaberin', 'Kunde Beispiel'],
			occasion: 'Angebot Projekt Nord'
		});
		expect(meal).toMatchObject({
			netCents: 10800,
			deductibleCents: 7560,
			nonDeductibleCents: 3240,
			inputVatCents: 1900,
			missing: []
		});
	});

	it('names what the law asks for and is missing', () => {
		expect(
			hospitality({ date: '2026-05-05', grossCents: 5000, vatCents: 798, tipCents: 300 }).missing
		).toEqual(['place', 'participants', 'occasion', 'tipTo']);
		// An odd cent stays on the non-deductible side, the sum stays whole.
		const odd = hospitality({ date: '2026-05-05', grossCents: 1001, vatCents: 0 });
		expect(odd.deductibleCents + odd.nonDeductibleCents).toBe(1001);
	});
});
