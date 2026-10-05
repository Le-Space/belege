// Paying outlays back (#293, step 4): a payout clears outlays – one several,
// several one –, the oldest first; it needs no receipt and is booked against
// the private account of the legal form. Every vendor and amount is made up.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { cleanDatevSettings, privateAccounts } from '../booking/settings.js';
import { suggestBooking } from '../booking/suggest.js';
import { isCovered } from '../matching/engine.js';
import { privateKind } from '../matching/private-kind.js';
import { bookOutlay, undoOutlay } from './outlays.js';
import {
	linkOutlayRepayment,
	mayRepayOutlays,
	openOutlays,
	outlaySettlement,
	suggestOutlays,
	unlinkOutlayRepayment
} from './repayment.js';

/** @type {any} */
let store;
beforeEach(() => {
	store = Object.fromEntries(
		[
			'accounts',
			'transactions',
			'matches',
			'events',
			'receipts',
			'settings',
			'partners',
			'questions'
		].map((name) => [name, memoryCollection(/** @type {any} */ (name)).collection])
	);
});

const corporation = cleanDatevSettings({ legalForm: 'corporation', shareholderAccount: '1755' });

/** @param {string} vendor @param {number} amountCents @param {string} day */
async function outlay(vendor, amountCents, day) {
	const receipt = await store.receipts.put({
		vendor,
		amountCents,
		currency: 'EUR',
		documentDate: day
	});
	const { transaction } = await bookOutlay({ store, settings: corporation, receipt, how: 'cash' });
	return transaction;
}

/** @param {number} amountCents @param {string} day */
const payout = (amountCents, day) =>
	store.transactions.put({
		accountId: 'ACC-BANK',
		source: 'hibiscus',
		currency: 'EUR',
		bookedOn: day,
		amountCents,
		counterparty: 'Erika Beispiel',
		purpose: 'Erstattung Auslagen'
	});

const all = () => store.transactions.list();

describe('suggestOutlays', () => {
	const open = (/** @type {number[]} */ cents) =>
		cents.map((c, i) => ({ tx: { id: `O${i}` }, openCents: c }));

	it('the outlays that add up to the payout exactly, the oldest preferred', () => {
		expect(suggestOutlays(150, open([100, 50, 150]))).toEqual(['O0', 'O1']);
		expect(suggestOutlays(150, open([70, 100, 50]))).toEqual(['O1', 'O2']);
		expect(suggestOutlays(70, open([70, 100, 50]))).toEqual(['O0']);
	});

	it('without an exact sum: the oldest until the payout is used up', () => {
		expect(suggestOutlays(120, open([100, 50, 30]))).toEqual(['O0', 'O1']);
		expect(suggestOutlays(1000, open([100, 50]))).toEqual(['O0', 'O1']);
	});
});

describe('linking a payout', () => {
	it('one payout clears two outlays; it is covered and booked against the clearing account', async () => {
		const a = await outlay('Bahn Beispiel AG', 8_990, '2025-03-04');
		const b = await outlay('Taxi Beispiel', 2_500, '2025-03-05');
		expect(openOutlays(await all()).map((o) => o.openCents)).toEqual([8_990, 2_500]);

		const p = await payout(-11_490, '2025-03-20');
		expect(mayRepayOutlays(p, [], null)).toBe(true);
		expect(mayRepayOutlays(a, [], null)).toBe(false);
		await linkOutlayRepayment(store, p.id, [a.id, b.id]);

		const paid = await store.transactions.get(p.id);
		expect(paid.outlayRepaymentOf).toEqual([a.id, b.id]);
		expect((await store.transactions.get(a.id)).outlay.repaidBy).toEqual([p.id]);
		expect(openOutlays(await all())).toEqual([]);
		expect(outlaySettlement(paid, await all())).toMatchObject({
			owedCents: 11_490,
			repaidCents: 11_490,
			openCents: 0
		});

		expect(privateKind(paid)).toBe('outlay-repayment');
		expect(isCovered(paid, null)).toBe(true);
		expect(mayRepayOutlays(paid, [], null)).toBe(false);
		expect(suggestBooking(paid, { privateAccounts: privateAccounts(corporation) }).account).toBe(
			'1755'
		);
		// A sole proprietor's outlays were deposits; paying them back is a withdrawal.
		expect(
			suggestBooking(paid, {
				privateAccounts: privateAccounts(cleanDatevSettings({ legalForm: 'sole' }))
			}).account
		).toBe('1800');
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => e.action)).toContain('outlay-repayment-link');
	});

	it('two payouts for one outlay: partly open in between, the oldest cleared first', async () => {
		const a = await outlay('Hotel Beispiel', 30_000, '2025-04-01');
		const b = await outlay('Taxi Beispiel', 4_000, '2025-04-02');
		const p1 = await payout(-20_000, '2025-04-10');
		await linkOutlayRepayment(store, p1.id, [a.id, b.id]);
		const s = outlaySettlement(await store.transactions.get(a.id), await all());
		expect(s.openCents).toBe(14_000);
		expect(s.openOf.get(a.id)).toBe(10_000);
		expect(s.openOf.get(b.id)).toBe(4_000);
		expect(openOutlays(await all()).map((o) => [o.tx.id, o.openCents])).toEqual([
			[a.id, 10_000],
			[b.id, 4_000]
		]);

		const p2 = await payout(-14_000, '2025-04-30');
		await linkOutlayRepayment(store, p2.id, [a.id, b.id]);
		expect(openOutlays(await all())).toEqual([]);

		// Let go again: what the second payout paid is open once more.
		await unlinkOutlayRepayment(store, p2.id, a.id);
		await unlinkOutlayRepayment(store, p2.id, b.id);
		expect((await store.transactions.get(p2.id)).outlayRepaymentOf).toBeNull();
		expect(privateKind(await store.transactions.get(p2.id))).toBeNull();
		expect(openOutlays(await all()).reduce((n, o) => n + o.openCents, 0)).toBe(14_000);
	});

	it('an outlay undone lets go of its payouts', async () => {
		const a = await outlay('Bahn Beispiel AG', 8_990, '2025-03-04');
		const b = await outlay('Taxi Beispiel', 2_500, '2025-03-05');
		const p = await payout(-11_490, '2025-03-20');
		await linkOutlayRepayment(store, p.id, [a.id, b.id]);
		await undoOutlay(store, a.id);
		expect((await store.transactions.get(p.id)).outlayRepaymentOf).toEqual([b.id]);
		const s = outlaySettlement(await store.transactions.get(p.id), await all());
		expect(s).toMatchObject({ owedCents: 2_500, repaidCents: 11_490, openCents: 0 });
	});

	it('only an outlay can be paid back, and only by a booking that is none', async () => {
		const a = await outlay('Bahn Beispiel AG', 8_990, '2025-03-04');
		const p = await payout(-8_990, '2025-03-20');
		await expect(linkOutlayRepayment(store, p.id, [p.id])).rejects.toThrow('No outlay');
		await expect(linkOutlayRepayment(store, a.id, [a.id])).rejects.toThrow('No payout');
	});
});

describe('mayRepayOutlays', () => {
	const tx = { id: 'T1', amountCents: -500, currency: 'EUR', source: 'hibiscus' };
	it('money out in euros, not covered otherwise', () => {
		expect(mayRepayOutlays(tx, [], null)).toBe(true);
		expect(mayRepayOutlays({ ...tx, amountCents: 500 }, [], null)).toBe(false);
		expect(mayRepayOutlays({ ...tx, currency: 'XMR' }, [], null)).toBe(false);
		expect(mayRepayOutlays({ ...tx, noReceipt: { reason: 'x' } }, [], null)).toBe(false);
		expect(mayRepayOutlays(tx, [], /** @type {any} */ ({ kind: 'own-transfer' }))).toBe(false);
		expect(
			mayRepayOutlays(tx, [{ transactionId: 'T1', receiptId: 'R1', state: 'confirmed' }], null)
		).toBe(false);
	});
});
