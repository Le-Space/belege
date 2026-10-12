import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import {
	allAppointments,
	appointmentsOn,
	importAppointments,
	isOnSite,
	tripFromAppointment
} from './appointments.js';
import { tripProposals } from './proposals.js';

// Made-up invitations; no real event, place or person.

const fair = {
	summary: 'Fachtagung Beispiel 2026',
	location: 'Kongresshaus Musterstadt, Saal 2',
	start: '2026-11-05T09:30',
	end: '2026-11-05T17:15',
	allDay: false,
	cancelled: false
};

describe('appointments from invitations (#213, step 4c)', () => {
	it('kept once per mail and place in it; a cancellation noted; nothing without a start', async () => {
		const travel = memoryCollection('travel').collection;
		const messages = [
			{ id: 'M1', calendar: [fair, { ...fair, start: 'bald' }] },
			{ id: 'M2', calendar: [] },
			{ id: 'M3' }
		];
		expect(await importAppointments(travel, messages)).toEqual({ new: 1, cancelled: 0 });
		expect(await importAppointments(travel, messages)).toEqual({ new: 0, cancelled: 0 });
		const [a] = await travel.list();
		expect(a).toMatchObject({ kind: 'appointment', ref: 'M1#0', mailId: 'M1', ...fair });
		expect(
			await importAppointments(travel, [{ id: 'M1', calendar: [{ ...fair, cancelled: true }] }])
		).toEqual({ new: 0, cancelled: 1 });
		expect(allAppointments(await travel.list())).toEqual([]);
	});

	it('somewhere to go: a place, not a link, a call or nothing', () => {
		expect(isOnSite(fair)).toBe(true);
		for (const location of [
			'',
			'https://meet.example/abc',
			'Online',
			'Zoom',
			'Microsoft Teams-Besprechung',
			'Google Meet'
		])
			expect(isOnSite({ location }), location).toBe(false);
	});

	it('on some days; a trip’s head from one, all day from 8 to 18', () => {
		const travel = [
			{ id: 'A', kind: 'appointment', ...fair },
			{ id: 'B', kind: 'appointment', ...fair, location: 'Online' },
			{ id: 'C', kind: 'appointment', ...fair, cancelled: true }
		];
		expect(appointmentsOn(travel, '2026-11-04', '2026-11-06').map((a) => a.id)).toEqual(['A']);
		expect(appointmentsOn(travel, '2026-11-06', '2026-11-07')).toEqual([]);
		expect(tripFromAppointment(fair)).toEqual({
			destination: 'Kongresshaus Musterstadt, Saal 2',
			reason: 'Fachtagung Beispiel 2026',
			start: '2026-11-05T09:30',
			end: '2026-11-05T17:15'
		});
		expect(
			tripFromAppointment({ ...fair, allDay: true, start: '2026-11-05', end: '2026-11-07' })
		).toMatchObject({ start: '2026-11-05T08:00', end: '2026-11-07T18:00' });
	});

	it('gives a proposal on its days its reason; alone it proposes nothing', () => {
		const ticket = {
			id: 'r1',
			status: 'ausgelesen',
			documentDate: '2026-10-20',
			extraction: {
				document_type: 'ticket',
				travel: {
					kind: 'train',
					from: 'A-Stadt',
					to: 'Musterstadt',
					departure: '2026-11-05T06:10',
					arrival: '2026-11-05T09:00'
				}
			}
		};
		const travel = [{ id: 'A', kind: 'appointment', ...fair }];
		expect(tripProposals({ receipts: [ticket], travel })[0].reason).toBe(
			'Fachtagung Beispiel 2026'
		);
		expect(tripProposals({ receipts: [], travel })).toEqual([]);
	});
});
