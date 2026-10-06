// A person's calls on bookings without a receipt: "Bankgebühr" (learned for the
// next one like it, and forgettable) and "Keine Umbuchung".
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { getSetting, setSetting } from '../store/settings.js';
import { tx } from './fixtures.js';
import {
	addCompanyName,
	confirmMatch,
	forgetBankFee,
	markBankFee,
	rejectTransfer,
	restoreReceipt,
	setAsideReceipt
} from './actions.js';
import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';

/** @type {any} */
let store;

beforeEach(async () => {
	store = {};
	for (const name of /** @type {const} */ ([
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events'
	])) {
		store[name] = memoryCollection(name).collection;
	}
	await setSetting(store.settings, 'matching', {
		companyNames: ['le space UG'],
		rules: [{ id: 'r1', contains: 'Finanzamt', action: 'ignore' }]
	});
});

/** @param {Record<string, any>} record */
async function addTx(record) {
	const rest = { ...record };
	delete rest.id;
	return store.transactions.put(rest);
}

async function classify(/** @type {any} */ t) {
	const ctx = await buildMatchingContext({
		accounts: [],
		transactions: await store.transactions.list(),
		settings: await getSetting(store.settings, 'matching')
	});
	return classifyTransaction(t, ctx);
}

describe('markBankFee and forgetBankFee', () => {
	it('learns the purpose words on this account, keeps the other settings, and can forget', async () => {
		const sep = await addTx(
			tx({ accountId: 'ACC-GLS', amountCents: -390, counterparty: '', purpose: 'Porto 09/2026' })
		);
		expect(await classify(sep)).toBeNull();

		await markBankFee(store, sep.id);
		const settings = await getSetting(store.settings, 'matching');
		expect(settings.feeKeys).toEqual(['ACC-GLS|porto']);
		expect(settings.companyNames).toEqual(['le space UG']);
		expect(settings.rules).toHaveLength(1);
		expect(await classify(sep)).toEqual({ kind: 'bank-fee', via: 'learned' });

		const oct = await addTx(
			tx({ accountId: 'ACC-GLS', amountCents: -390, counterparty: '', purpose: 'Porto 10/2026' })
		);
		expect((await classify(oct))?.via).toBe('learned');
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => e.action)).toContain('bank-fee');

		await forgetBankFee(store, 'ACC-GLS|porto');
		expect((await getSetting(store.settings, 'matching')).feeKeys ?? []).toEqual([]);
		expect(await classify(oct)).toBeNull();
	});

	it('a purpose without words: "Kein Beleg nötig: Bankgebühr" on this booking only', async () => {
		const t = await addTx(tx({ amountCents: -100, counterparty: '', purpose: '2026 0815' }));
		await markBankFee(store, t.id);
		expect((await store.transactions.get(t.id)).noReceipt.reason).toBe('Bankgebühr');
		expect((await getSetting(store.settings, 'matching')).feeKeys ?? []).toEqual([]);
	});
});

describe('rejectTransfer', () => {
	it('"Keine Umbuchung": the pair is kept apart, the other settings stay', async () => {
		const out = await addTx(
			tx({
				accountId: 'ACC-GLS',
				bookedOn: '2026-09-17',
				amountCents: -20000,
				purpose: 'Umbuchung'
			})
		);
		const into = await addTx(
			tx({ accountId: 'ACC-REV', bookedOn: '2026-09-18', amountCents: 20000, purpose: 'Umbuchung' })
		);
		expect((await classify(into))?.via).toBe('counter-booking');
		await rejectTransfer(store, into.id, out.id);
		expect(await classify(into)).toBeNull();
		expect(await classify(out)).toBeNull();
		const settings = await getSetting(store.settings, 'matching');
		expect(settings.companyNames).toEqual(['le space UG']);
		expect(settings.notTransfers).toHaveLength(1);
	});
});

describe('addCompanyName', () => {
	it('adds the name once, keeps the rest; the transfer is recognised', async () => {
		const into = await addTx(
			tx({
				accountId: 'ACC-REV',
				amountCents: 20000,
				counterparty: 'NORDLICHT WERKSTATT GMBH',
				purpose: 'Claude Code (KI)'
			})
		);
		expect(await classify(into)).toBeNull();
		await addCompanyName(store, 'NORDLICHT WERKSTATT GMBH');
		await addCompanyName(store, 'NORDLICHT WERKSTATT GMBH');
		const settings = await getSetting(store.settings, 'matching');
		expect(settings.companyNames).toEqual(['le space UG', 'NORDLICHT WERKSTATT GMBH']);
		expect(settings.rules).toHaveLength(1);
		expect((await classify(into))?.kind).toBe('own-transfer');
	});
});

describe('a learned bank fee covers only what looks like one (#320)', () => {
	const debit = (/** @type {string} */ month) =>
		tx({
			accountId: 'ACC-GLS',
			amountCents: -5259,
			counterparty: 'Kabel Beispiel GmbH',
			bookingType: 'Basislastschrift',
			purpose: `${month}/2025 K-NR. 000000001 Ihre Rechnung online bei www.beispiel.de/meinkabel`
		});

	it('a vendor’s monthly invoice debit called a fee is this one only, never a rule', async () => {
		const feb = await addTx(debit('02'));
		const mar = await addTx(debit('03'));
		await markBankFee(store, feb.id);
		expect((await getSetting(store.settings, 'matching')).feeKeys ?? []).toEqual([]);
		expect((await store.transactions.get(feb.id)).noReceipt).toBeTruthy();
		expect(await classify(mar)).toBeNull();
	});

	it('a key already learned from such a debit no longer covers the next month', async () => {
		const feb = await addTx(debit('02'));
		const mar = await addTx(debit('03'));
		const { feeKey } = await import('./classify.js');
		await setSetting(store.settings, 'matching', {
			...(await getSetting(store.settings, 'matching')),
			feeKeys: [feeKey(feb)]
		});
		expect(feeKey(feb)).toBe(feeKey(mar));
		expect(await classify(mar)).toBeNull();
	});

	it('an invoice in the purpose keeps a fee from being learned, even with no counterparty', async () => {
		const a = await addTx(
			tx({
				accountId: 'ACC-GLS',
				amountCents: -1190,
				counterparty: '',
				purpose: 'Rechnung RE-2025-01 Hosting'
			})
		);
		const b = await addTx(
			tx({
				accountId: 'ACC-GLS',
				amountCents: -1190,
				counterparty: '',
				purpose: 'Rechnung RE-2025-02 Hosting'
			})
		);
		await markBankFee(store, a.id);
		expect(await classify(b)).toBeNull();
	});

	it('the bank’s own monthly fee still learns and covers the next month', async () => {
		const own = (/** @type {string} */ m) =>
			tx({
				accountId: 'ACC-GLS',
				amountCents: -890,
				counterparty: 'GLS Gemeinschaftsbank',
				purpose: `Kontoführung ${m}/2025 Paket Business`
			});
		const feb = await addTx(own('02'));
		const mar = await addTx(own('03'));
		await markBankFee(store, feb.id);
		expect(await classify(mar)).toMatchObject({ kind: 'bank-fee' });
	});
});

describe('setAsideReceipt and restoreReceipt', () => {
	it('a copy is set aside: out of the matching, its link undone; restored it is read again', async () => {
		const t = await addTx(tx({ amountCents: -11900, counterparty: 'Wolkenfabrik' }));
		const r = await store.receipts.put({
			status: 'ausgelesen',
			extraction: { vendor: 'W' },
			vendor: 'W'
		});
		await confirmMatch(store, { receiptId: r.id, transactionId: t.id });
		await setAsideReceipt(store, r.id, { duplicateOf: 'R-KEEP' });
		const aside = await store.receipts.get(r.id);
		expect(aside).toMatchObject({
			status: 'ignoriert',
			setAside: { reason: 'duplicate', of: 'R-KEEP' }
		});
		expect(
			(await store.matches.list()).every((/** @type {any} */ m) => m.state === 'rejected')
		).toBe(true);
		await restoreReceipt(store, r.id);
		expect(await store.receipts.get(r.id)).toMatchObject({ status: 'ausgelesen', setAside: null });
	});
	it('a private receipt is set aside as private, with its reason, and logged as such', async () => {
		const r = await store.receipts.put({
			status: 'ausgelesen',
			extraction: { vendor: 'Hotel Beispiel' },
			vendor: 'Hotel Beispiel'
		});
		await setAsideReceipt(store, r.id, { private: true, note: '  private trip  ' });
		expect(await store.receipts.get(r.id)).toMatchObject({
			status: 'ignoriert',
			setAside: { reason: 'private', of: null, note: 'private trip' }
		});
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => e.action)).toContain('receipt-private');
	});

	it('without a reason, none is kept', async () => {
		const r = await store.receipts.put({ status: 'ausgelesen', extraction: { vendor: 'X' } });
		await setAsideReceipt(store, r.id, { private: true });
		const aside = await store.receipts.get(r.id);
		expect(aside.setAside.reason).toBe('private');
		expect('note' in aside.setAside).toBe(false);
	});
});
