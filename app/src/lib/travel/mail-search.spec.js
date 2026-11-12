import { describe, expect, it } from 'vitest';

import { tripChecks } from './checks.js';
import { gapHitScore, gapQuery, hitFound, rankGapHits } from './mail-search.js';

// Made up (#693 c): a train to Beispielburg, a bus from A-Stadt (the ride
// between is missing) to Ortshausen, no lodging there. Towns and vendors are
// invented.

const receipt = (/** @type {string} */ id, /** @type {Record<string, any>} */ travel) => ({
	id,
	vendor: `Beispiel ${id}`,
	extraction: { travel }
});
const RECEIPTS = [
	receipt('train', {
		kind: 'train',
		from: 'Musterstadt',
		to: 'Beispielburg',
		from_country: 'DE',
		to_country: 'DE',
		departure: '2026-05-04T06:00',
		arrival: '2026-05-04T07:00'
	}),
	receipt('bus', {
		kind: 'bus',
		from: 'A-Stadt',
		to: 'Ortshausen',
		from_country: 'DE',
		to_country: 'AT',
		departure: '2026-05-04T08:00',
		arrival: '2026-05-04T13:00'
	}),
	receipt('back', {
		kind: 'bus',
		from: 'Ortshausen',
		to: 'Musterstadt',
		from_country: 'AT',
		to_country: 'DE',
		departure: '2026-05-06T09:00',
		arrival: '2026-05-06T15:00'
	})
];
const TRIP = {
	destination: 'Ortshausen',
	country: 'DE',
	start: '2026-05-04T05:30',
	end: '2026-05-06T15:30'
};
const checks = tripChecks(TRIP, RECEIPTS);
const night = /** @type {any} */ (checks.find((c) => c.kind === 'night'));
const gap = /** @type {any} */ (checks.find((c) => c.kind === 'gap'));

describe('the mailbox search for a gap of a trip (#693 c)', () => {
	it('a night: the place the last leg arrived at, words of a booking, ± 30 days', () => {
		expect(night.date).toBe('2026-05-04');
		expect(gapQuery(night, TRIP, RECEIPTS)).toEqual({
			looking: 'lodging',
			text: 'Ortshausen',
			terms: ['hotel', 'hostel', 'booking', 'reservation', 'Unterkunft'],
			around: '2026-05-04',
			days: 30
		});
	});

	it('a night before any leg arrived: the trip’s destination', () => {
		const q = gapQuery({ kind: 'night', key: 'night:2026-05-03', date: '2026-05-03' }, TRIP, []);
		expect(q?.text).toBe('Ortshausen');
	});

	it('a ride missing: where it went missing, where the next leg left, words of a ticket', () => {
		expect(gapQuery(gap, TRIP, RECEIPTS)).toEqual({
			looking: 'ride',
			text: 'Beispielburg',
			terms: ['A-Stadt', 'ticket', 'boarding', 'flight', 'Fahrkarte', 'itinerary'],
			around: '2026-05-04',
			days: 30
		});
	});

	it('only what the bridge takes: a place in another script is text, not a term', () => {
		const other = {
			...gap,
			after: { ...gap.after, to: { ...gap.after.to, name: 'Бейспильбург' } },
			before: { ...gap.before, from: { ...gap.before.from, name: 'Нова Стадт' } }
		};
		const q = gapQuery(other, TRIP, RECEIPTS);
		expect(q?.text).toBe('Бейспильбург');
		expect(q?.terms).toEqual(['ticket', 'boarding', 'flight', 'Fahrkarte', 'itinerary']);
		const quoted = { ...gap, after: { ...gap.after, to: { name: 'A"B' } } };
		expect(gapQuery(quoted, TRIP, RECEIPTS)?.text).toBe('A-Stadt');
	});

	it('no search for the end abroad or a leg outside the trip', () => {
		expect(
			gapQuery(
				{
					kind: 'endsAbroad',
					key: 'endsAbroad',
					country: 'AT',
					place: 'Ortshausen',
					at: '2026-05-04T13:00',
					receiptId: 'bus'
				},
				TRIP,
				RECEIPTS
			)
		).toBeNull();
	});
});

describe('its hits, most likely first (#693 c)', () => {
	const q = /** @type {import('./mail-search.js').GapQuery} */ (gapQuery(night, TRIP, RECEIPTS));
	const pdf = [{ name: 'Rechnung.pdf', kind: 'pdf' }];
	const booking = {
		id: 'm1',
		subject: 'Ihre Buchung im Hostel Beispiel',
		matched: ['"Ortshausen"', '"hostel"', '"booking"'],
		attachments: pdf,
		auth: { verdict: 'pass' },
		receivedAt: '2026-04-10T09:00:00Z'
	};
	const newsletter = {
		id: 'm2',
		subject: 'Die besten Hotels im Mai',
		matched: ['"hotel"'],
		bulk: true,
		receivedAt: '2026-05-04T09:00:00Z'
	};
	const near = {
		id: 'm3',
		subject: 'Grüße aus Ortshausen',
		matched: ['"Ortshausen"'],
		receivedAt: '2026-05-05T09:00:00Z'
	};
	const far = { ...near, id: 'm4', receivedAt: '2026-05-30T09:00:00Z' };

	it('names what a hit has: the place, which words', () => {
		expect(hitFound(booking, q)).toEqual({ place: true, words: ['hostel', 'booking'] });
		expect(hitFound(newsletter, q)).toEqual({ place: false, words: ['hotel'] });
	});

	it('the place and a word, an attachment, a booking subject first; a newsletter last', () => {
		expect(gapHitScore(booking, q)).toBeGreaterThan(gapHitScore(near, q));
		expect(gapHitScore(newsletter, q)).toBeLessThan(0);
		expect(rankGapHits([newsletter, far, near, booking], q).map((h) => h.id)).toEqual([
			'm1',
			'm3',
			'm4',
			'm2'
		]);
	});
});
