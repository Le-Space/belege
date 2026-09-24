import { describe, expect, it } from 'vitest';

import { syncHibiscus } from './hibiscus-sync.js';
import { memoryCollection } from './test-support.js';

const NOW = new Date('2026-09-24T12:00:00Z');
/** @type {import('../bridge/client.js').BridgeAccount} */
const ACCOUNT = {
	id: '2',
	ibanMasked: 'DE00 **** 1400',
	ibanLast4: '1400',
	name: 'Kontokorrent',
	currency: 'EUR',
	balanceCents: 0,
	balanceDate: '2026-09-24'
};

function fakeClient() {
	/** @type {string[]} */ const asked = [];
	return {
		asked,
		client: /** @type {any} */ ({
			transactions: async (/** @type {string} */ _id, /** @type {string} */ since) => {
				asked.push(since);
				return [];
			}
		})
	};
}

function store() {
	return {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection
	};
}

describe('syncHibiscus: where it starts', () => {
	it('90 days back the first time, a week before the last sync after that', async () => {
		const s = store();
		const { client, asked } = fakeClient();
		await syncHibiscus({ client, store: s, accounts: [ACCOUNT], now: NOW });
		await syncHibiscus({ client, store: s, accounts: [ACCOUNT], now: NOW });
		expect(asked).toEqual(['2026-06-26', '2026-09-17']);
	});

	it('a chosen date wins over both', async () => {
		const s = store();
		const { client, asked } = fakeClient();
		await syncHibiscus({ client, store: s, accounts: [ACCOUNT], now: NOW });
		await syncHibiscus({ client, store: s, accounts: [ACCOUNT], now: NOW, from: '2026-01-01' });
		expect(asked).toEqual(['2026-06-26', '2026-01-01']);
	});

	it('refuses something that is not a date, before asking the bridge', async () => {
		const { client, asked } = fakeClient();
		await expect(
			syncHibiscus({ client, store: store(), accounts: [ACCOUNT], now: NOW, from: '1.1.2026' })
		).rejects.toThrow('Kein Datum');
		expect(asked).toEqual([]);
	});
});
