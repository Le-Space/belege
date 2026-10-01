import { describe, expect, it } from 'vitest';

import { syncEnableBanking } from './enablebanking-sync.js';
import { ibanKey } from './fingerprint.js';
import { importCamtStatements } from './import.js';
import { memoryCollection } from './test-support.js';

const NOW = new Date('2026-10-01T12:00:00Z');
// The bridge computes the same key (bridge/test/enablebanking-links.test.js pins this value too).
const KEY = 'iban-sha256:f132c600c5d086b136ebb1fafa4cb6787f25da72c95ce14a47144d1c04c4c1bb';

/** @type {import('../bridge/client.js').EnableBankingAccount} */
const ACCOUNT = {
	uid: 'acc-0001',
	linkId: '00000000-0000-4000-8000-000000000001',
	bank: 'Beispielbank',
	ibanLast4: '1234',
	name: 'Geschäftskonto',
	currency: 'EUR',
	validUntil: '2027-03-30T00:00:00Z',
	allowed: true,
	ibanKey: KEY
};

const BOOKED = [
	{
		sourceId: 'EB-REF-0002',
		date: '2026-09-21',
		valueDate: '2026-09-21',
		amountCents: -11900,
		currency: 'EUR',
		counterpartyName: 'Wolkenfabrik Hosting GmbH',
		counterpartyIban: 'DE00000000000000002222',
		purpose: 'RE-1001 Kundennummer 4711',
		endToEndId: '',
		bookingType: 'Basislastschrift'
	},
	{
		sourceId: 'EB-REF-0001',
		date: '2026-09-11',
		valueDate: '2026-09-12',
		amountCents: 238000,
		currency: 'EUR',
		counterpartyName: 'Kundin Beispiel AG',
		counterpartyIban: 'DE00000000000000001111',
		purpose: 'Rechnung 2026-001',
		endToEndId: '',
		bookingType: ''
	}
];

function fakeClient(transactions = BOOKED) {
	/** @type {string[]} */ const asked = [];
	return {
		asked,
		client: {
			enableBankingTransactions: async (
				/** @type {string} */ _uid,
				/** @type {string} */ since
			) => {
				asked.push(since);
				return {
					since,
					transactions: transactions.filter((t) => t.date >= since),
					pending: 1,
					complete: true
				};
			}
		}
	};
}

function store() {
	return {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection
	};
}

describe('syncEnableBanking (#224, step 3)', () => {
	it('the IBAN key is the bridge’s', async () => {
		expect(await ibanKey('DE00 0000 0000 0000 0012 34')).toBe(KEY);
	});

	it('a new account by its key, 90 days back first, a week before the last fetch after that, nothing twice', async () => {
		const s = store();
		const { client, asked } = fakeClient();
		const first = await syncEnableBanking({ client, store: s, accounts: [ACCOUNT], now: NOW });
		expect(first.totals).toEqual({ new: 2, updated: 0, skipped: 0 });
		expect(first.pending).toBe(1);
		const again = await syncEnableBanking({ client, store: s, accounts: [ACCOUNT], now: NOW });
		// A week before the last fetch: nothing that old comes again.
		expect(again.totals).toEqual({ new: 0, updated: 0, skipped: 0 });
		const refetched = await syncEnableBanking({
			client,
			store: s,
			accounts: [ACCOUNT],
			from: '2026-09-01',
			now: NOW
		});
		expect(refetched.totals).toEqual({ new: 0, updated: 0, skipped: 2 });
		expect(asked).toEqual(['2026-07-03', '2026-09-24', '2026-09-01']);

		const [account] = await s.accounts.list();
		expect(account).toMatchObject({
			source: 'enablebanking',
			sourceAccountId: KEY,
			ibanLast4: '1234',
			name: 'Geschäftskonto',
			ebLastSyncedOn: '2026-10-01'
		});
		const txs = await s.transactions.list();
		expect(txs.map((t) => [t.source, t.sourceId, t.amountCents]).sort()).toEqual([
			['enablebanking', 'EB-REF-0001', 238000],
			['enablebanking', 'EB-REF-0002', -11900]
		]);
		expect(JSON.stringify(txs)).not.toContain('DE00000000000000001234');
	});

	it('continues the account a statement file brought, from the day after its last booking', async () => {
		const s = store();
		await importCamtStatements(s, [
			{
				id: 'STMT-1',
				account: {
					iban: 'DE00000000000000001234',
					otherId: '',
					issuer: '',
					scheme: '',
					currency: 'EUR',
					name: 'Geschäftskonto'
				},
				transactions: [
					{
						sourceId: 'CAMT-1',
						date: '2026-09-11',
						valueDate: '2026-09-12',
						amountCents: 238000,
						currency: 'EUR',
						counterpartyName: 'Kundin Beispiel AG',
						counterpartyIban: '',
						purpose: 'Rechnung 2026-001',
						endToEndId: '',
						bookingType: '',
						bankCode: ''
					}
				],
				skipped: 0
			}
		]);
		const { client, asked } = fakeClient();
		const result = await syncEnableBanking({ client, store: s, accounts: [ACCOUNT], now: NOW });
		expect(asked).toEqual(['2026-09-12']);
		expect(result.perAccount[0].continued).toBe(true);
		expect(result.totals.new).toBe(1);
		const accounts = await s.accounts.list();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].source).toBe('camt');
		const txs = await s.transactions.list();
		expect(txs.map((t) => [t.source, t.amountCents]).sort()).toEqual([
			['camt', 238000],
			['enablebanking', -11900]
		]);
		expect(new Set(txs.map((t) => t.accountId)).size).toBe(1);
	});

	it('an account the bridge keeps, or one without its key, is not fetched; a date chosen is used', async () => {
		const s = store();
		const { client, asked } = fakeClient();
		await syncEnableBanking({
			client,
			store: s,
			accounts: [
				{ ...ACCOUNT, allowed: false, ibanKey: null },
				{ ...ACCOUNT, uid: 'acc-x', ibanKey: null }
			],
			now: NOW
		});
		expect(asked).toEqual([]);
		await syncEnableBanking({
			client,
			store: s,
			accounts: [ACCOUNT],
			from: '2026-09-15',
			now: NOW
		});
		expect(asked).toEqual(['2026-09-15']);
		await expect(
			syncEnableBanking({ client, store: s, accounts: [ACCOUNT], from: '15.9.2026', now: NOW })
		).rejects.toThrow();
	});
});
