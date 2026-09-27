// A charge and its refund (issue #119). Made-up bookings only.
import { describe, expect, it } from 'vitest';

import { refundIndex } from './refunds.js';
import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';
import { classificationLine } from './explain.js';
import { relatedIndex } from './related.js';

/** @param {string} id @param {string} bookedOn @param {number} amountCents @param {string} counterparty @param {Record<string, any>} [extra] */
const tx = (id, bookedOn, amountCents, counterparty, extra = {}) => ({
	id,
	bookedOn,
	amountCents,
	counterparty,
	accountId: 'card',
	currency: 'EUR',
	purpose: '',
	deleted: false,
	...extra
});

const charge = tx('c1', '2026-03-26', -4952, 'Beispiel-VPN');
const refund = tx('r1', '2026-04-09', 4952, 'Rückerstattung von Beispiel-VPN');

describe('refundIndex', () => {
	it('a charge and its full refund on the same card pair', () => {
		const idx = refundIndex([charge, refund]);
		expect(idx.refundOf(charge)).toMatchObject({
			other: { id: 'r1' },
			role: 'charge',
			full: true,
			manual: false
		});
		expect(idx.refundOf(refund)).toMatchObject({ other: { id: 'c1' }, role: 'refund', full: true });
	});

	it('a refund word is needed, full or partial; more than the charge is none', () => {
		const partial = { ...refund, amountCents: 2000 };
		expect(refundIndex([charge, partial]).refundOf(charge)).toMatchObject({ full: false });
		const noWord = { ...refund, counterparty: 'Beispiel-VPN' };
		expect(refundIndex([charge, noWord]).refundOf(charge)).toBeNull();
		const more = { ...refund, amountCents: 5000 };
		expect(refundIndex([charge, more]).refundOf(charge)).toBeNull();
	});

	it('no pair: another vendor, too late, before the charge, two equal charges', () => {
		expect(
			refundIndex([charge, { ...refund, counterparty: 'Rückerstattung Anderer Laden' }]).refundOf(
				charge
			)
		).toBeNull();
		expect(
			refundIndex([charge, { ...refund, bookedOn: '2026-08-01' }]).refundOf(charge)
		).toBeNull();
		expect(
			refundIndex([charge, { ...refund, bookedOn: '2026-03-01' }]).refundOf(charge)
		).toBeNull();
		const twin = { ...charge, id: 'c2', bookedOn: '2026-03-27' };
		const idx = refundIndex([charge, twin, refund]);
		expect(idx.refundOf(refund)).toBeNull();
	});

	it('a link by hand comes first; "Keine Erstattung" keeps a pair apart', () => {
		const other = tx('x', '2026-05-01', 4952, 'Irgendwer');
		expect(refundIndex([charge, other], { refundPairs: ['c1|x'] }).refundOf(other)).toMatchObject({
			other: { id: 'c1' },
			manual: true
		});
		expect(refundIndex([charge, refund], { notRefunds: ['c1|r1'] }).refundOf(charge)).toBeNull();
	});
});

describe('as the matching sees it', () => {
	it('a full refund covers both, relates as Erstattung, and explains itself', async () => {
		const ctx = await buildMatchingContext({
			accounts: [],
			transactions: [charge, refund],
			settings: null
		});
		const c = classifyTransaction(charge, ctx);
		const r = classifyTransaction(refund, ctx);
		expect(c).toMatchObject({ kind: 'refund', role: 'charge', counterBookingId: 'r1' });
		expect(r).toMatchObject({ kind: 'refund', role: 'refund', counterBookingId: 'c1' });
		expect(classificationLine(c)).toContain('Voll erstattet');
		expect(classificationLine(r)).toContain('Erstattung zur Belastung');
		const rel = relatedIndex([charge, refund], /** @type {any} */ ({ c1: c, r1: r }));
		expect(rel.get('c1')).toMatchObject([{ kind: 'refund', other: { id: 'r1' } }]);
	});

	it('a partial refund: the charge still needs its receipt, the refund does not', async () => {
		const partial = { ...refund, amountCents: 2000 };
		const ctx = await buildMatchingContext({
			accounts: [],
			transactions: [charge, partial],
			settings: null
		});
		expect(classifyTransaction(charge, ctx)).toBeNull();
		expect(classifyTransaction(partial, ctx)).toMatchObject({ kind: 'refund', role: 'refund' });
	});
});

describe('linking and rejecting', () => {
	it('link, replace, reject: stored, and logged', async () => {
		const { linkRefund, rejectRefund } = await import('./actions.js');
		const { getSetting } = await import('../store/settings.js');
		const { memoryCollection } = await import('../bank/test-support.js');
		/** @type {any} */
		const store = {};
		for (const name of /** @type {const} */ (['settings', 'events']))
			store[name] = memoryCollection(name).collection;
		await rejectRefund(store, 'a', 'b');
		await linkRefund(store, 'a', 'c');
		await linkRefund(store, 'b', 'a');
		let m = await getSetting(store.settings, 'matching');
		expect(m.refundPairs).toEqual(['a|b']);
		expect(m.notRefunds).toEqual([]);
		await rejectRefund(store, 'a', 'b');
		m = await getSetting(store.settings, 'matching');
		expect(m.refundPairs).toEqual([]);
		expect(m.notRefunds).toEqual(['a|b']);
		const actions = (await store.events.list()).map((/** @type {any} */ e) => e.action);
		expect(actions).toContain('refund-link');
		expect(actions).toContain('not-refund');
	});
});
