// "Bankgebühr – kein Beleg nötig": a person's call, learned for the next one
// like it, and forgettable.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { getSetting, setSetting } from '../store/settings.js';
import { tx } from './fixtures.js';
import { forgetBankFee, markBankFee } from './actions.js';
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
		expect((await getSetting(store.settings, 'matching')).feeKeys).toEqual([]);
		expect(await classify(oct)).toBeNull();
	});

	it('a purpose without words: "Kein Beleg nötig: Bankgebühr" on this booking only', async () => {
		const t = await addTx(tx({ amountCents: -100, counterparty: '', purpose: '2026 0815' }));
		await markBankFee(store, t.id);
		expect((await store.transactions.get(t.id)).noReceipt.reason).toBe('Bankgebühr');
		expect((await getSetting(store.settings, 'matching')).feeKeys ?? []).toEqual([]);
	});
});
