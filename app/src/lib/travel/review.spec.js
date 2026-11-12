import { describe, expect, it } from 'vitest';

import { tripChecks } from './checks.js';
import { reviewOffered, reviewRequest } from './review.js';

// "✦ Reise prüfen" (#693 d), made up: by bus from A-Stadt to Ortshausen (AT),
// a meal there, no accommodation, no way back. Towns and vendors are invented.

const bus = {
	id: 'b1',
	vendor: 'Fernbus Beispiel',
	documentDate: '2026-05-04',
	invoiceNumber: 'RE-0000-0001',
	gross: 12.34,
	extraction: {
		document_type: 'ticket',
		travel: {
			kind: 'bus',
			from: 'A-Stadt',
			to: 'Ortshausen',
			from_country: 'DE',
			to_country: 'AT',
			departure: '2026-05-04T08:00',
			arrival: '2026-05-04T13:00'
		}
	}
};
const meal = {
	id: 'm1',
	vendor: 'Gasthaus Muster',
	documentDate: '2026-05-05',
	text: 'Rechnung Gasthaus Muster, Musterweg 1',
	extraction: { document_type: 'invoice', travel: { kind: 'restaurant', place: 'Ortshausen' } }
};
const trip = {
	id: 'T',
	kind: 'trip',
	destination: 'Ortshausen',
	reason: 'Projekttreffen Beispiel',
	note: 'privat: nichts',
	start: '2026-05-04T07:30',
	end: '2026-05-06T18:00',
	country: 'DE',
	stops: [{ at: '2026-05-04T13:00', country: 'AT' }],
	overnight: true,
	nights: []
};

describe('what "Reise prüfen" sends (#693 d)', () => {
	const checks = tripChecks(trip, [meal, bus]);
	const { body, receiptOf } = reviewRequest(trip, [meal, bus], checks, 'de');

	it('legs and receipts by name, the rules’ questions as lines', () => {
		expect(body.legs).toEqual([
			{
				ref: 'L1',
				receipt: 'R1',
				kind: 'bus',
				from: 'A-Stadt DE',
				to: 'Ortshausen AT',
				dep: '2026-05-04T08:00',
				arr: '2026-05-04T13:00'
			}
		]);
		expect(body.receipts).toEqual([
			{
				ref: 'R1',
				kind: 'bus',
				vendor: 'Fernbus Beispiel',
				date: '2026-05-04',
				from: 'A-Stadt',
				to: 'Ortshausen'
			},
			{
				ref: 'R2',
				kind: 'restaurant',
				vendor: 'Gasthaus Muster',
				date: '2026-05-05',
				place: 'Ortshausen'
			}
		]);
		expect(body.questions).toEqual([
			'night 2026-05-04: no accommodation receipt, no flat rate, no leg overnight',
			'night 2026-05-05: no accommodation receipt, no flat rate, no leg overnight',
			'ends abroad: the last leg arrives in Ortshausen (AT) at 2026-05-04T13:00, no way back'
		]);
		expect([...receiptOf]).toEqual([
			['R1', 'b1'],
			['R2', 'm1'],
			['L1', 'b1']
		]);
	});

	it('no amount, number, text, reason or note of the person goes along', () => {
		const sent = JSON.stringify(body);
		for (const no of ['12.34', 'RE-0000', 'Musterweg', 'Projekttreffen', 'privat']) {
			expect(sent).not.toContain(no);
		}
		expect(Object.keys(body.trip).sort()).toEqual(
			['country', 'destination', 'end', 'flatNights', 'overnight', 'start', 'stops'].sort()
		);
	});

	it('offered only where the model gets the text unredacted, here or in the enclave', () => {
		expect(reviewOffered(false)).toBe(true);
		expect(reviewOffered('enclave')).toBe(true);
		expect(reviewOffered(true)).toBe(false);
		expect(reviewOffered(null)).toBe(false);
	});
});
