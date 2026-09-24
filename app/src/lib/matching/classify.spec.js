// Bookings that need no receipt: rules, bank fees, own transfers, loans.
import { describe, expect, it } from 'vitest';

import { ibanKey } from '../bank/fingerprint.js';
import { ACCOUNTS, tx } from './fixtures.js';
import { buildMatchingContext } from './context.js';
import { classifyTransaction, cleanMatchingSettings, isOwnName } from './classify.js';

/** @param {Partial<import('./classify.js').ClassifyContext>} [over] */
const ctx = (over = {}) => ({
	companyNames: ['le space UG'],
	ownIbans: new Set(),
	ownLast4: new Map(),
	rules: [],
	...over
});

describe('isOwnName', () => {
	it('finds the company’s words in order, legal form dropped', () => {
		expect(isOwnName('LE SPACE UG (HAFTUNGSBESCHRAENKT)', 'le space UG')).toBe(true);
		expect(isOwnName('Le Space', 'le space UG')).toBe(true);
		expect(isOwnName('Nico Test Le Space', 'le space UG')).toBe(true);
		expect(isOwnName('Space Cafe GmbH', 'le space UG')).toBe(false);
		expect(isOwnName('Lespace Immobilien', 'le space UG')).toBe(false);
		expect(isOwnName('Irgendwer', '')).toBe(false);
		expect(isOwnName('UG', 'UG')).toBe(false);
	});
});

describe('classifyTransaction', () => {
	it('bank fees: the statement is the receipt', () => {
		for (const bookingType of ['Abschluss', 'Entgelt', 'Mehrwertsteuerbelastung']) {
			expect(classifyTransaction(tx({ amountCents: -1190, bookingType }), ctx())).toEqual({
				kind: 'bank-fee',
				bookingType
			});
		}
		expect(
			classifyTransaction(tx({ amountCents: -1190, bookingType: 'Basislastschrift' }), ctx())
		).toBeNull();
	});

	it('own transfer by company name: neutral account 1360', () => {
		const t = tx({
			amountCents: -50000,
			counterparty: 'le space UG',
			bookingType: 'Überweisungsauftrag',
			purpose: 'Umbuchung Revolut'
		});
		expect(classifyTransaction(t, ctx())).toEqual({
			kind: 'own-transfer',
			account: '1360',
			via: 'company',
			company: 'le space UG'
		});
		expect(classifyTransaction(t, ctx({ companyNames: [] }))).toBeNull();
	});

	it('own transfer by one of our full IBANs', () => {
		const t = tx({
			amountCents: -20000,
			counterparty: 'Revolut Bank UAB',
			counterpartyIban: 'LT00 0000 0000 0000 0001'
		});
		expect(classifyTransaction(t, ctx({ ownIbans: new Set(['LT000000000000000001']) }))?.kind).toBe(
			'own-transfer'
		);
	});

	it('four digits of our IBAN count only with the counter-booking on that account', () => {
		const t = tx({
			amountCents: -20000,
			counterparty: 'Revolut',
			counterpartyIban: 'LT000000000000000001',
			bookedOn: '2026-08-03'
		});
		const ownLast4 = new Map([['0001', ['ACC-REV']]]);
		expect(classifyTransaction(t, ctx({ ownLast4, mirrored: () => false }))).toBeNull();
		expect(classifyTransaction(t, ctx({ ownLast4, mirrored: () => true }))?.kind).toBe(
			'own-transfer'
		);
	});

	it('a shareholder loan: the contract is the receipt', () => {
		const t = tx({
			amountCents: 300000,
			counterparty: 'Gesellschafter Test',
			purpose: 'Gesellschafterdarlehen Tranche 2'
		});
		expect(classifyTransaction(t, ctx())).toEqual({ kind: 'loan' });
	});

	it('the person’s own rules come first: ignore with a reason, or private', () => {
		const rules = cleanMatchingSettings({
			rules: [
				{
					id: 'r1',
					field: 'counterparty',
					contains: 'Finanzamt',
					action: 'ignore',
					reason: 'Steuerbescheid liegt vor'
				},
				{ id: 'r2', field: 'purpose', contains: 'Taschengeld', action: 'private' },
				{ id: 'r3', field: 'any', contains: 'Abschluss', action: 'ignore', reason: 'eigene Regel' }
			]
		}).rules;
		expect(
			classifyTransaction(
				tx({ amountCents: -100, counterparty: 'FINANZAMT BEISPIEL' }),
				ctx({ rules })
			)
		).toEqual({
			kind: 'rule-ignore',
			reason: 'Steuerbescheid liegt vor',
			ruleId: 'r1',
			ruleField: 'counterparty',
			ruleContains: 'Finanzamt'
		});
		expect(
			classifyTransaction(tx({ amountCents: -100, purpose: 'Taschengeld Oktober' }), ctx({ rules }))
		).toEqual({
			kind: 'rule-private',
			reason: 'Taschengeld',
			ruleId: 'r2',
			ruleField: 'purpose',
			ruleContains: 'Taschengeld'
		});
		// The rule wins over the bank-fee default.
		expect(
			classifyTransaction(
				tx({ amountCents: -100, bookingType: 'Abschluss', purpose: 'Abschluss Q3' }),
				ctx({ rules })
			)?.kind
		).toBe('rule-ignore');
	});

	it('an ordinary debit needs a receipt', () => {
		expect(
			classifyTransaction(tx({ amountCents: -5259, counterparty: 'Stromwerk Test AG' }), ctx())
		).toBeNull();
	});
});

describe('cleanMatchingSettings', () => {
	it('keeps what is usable, compacts IBANs, drops the rest', () => {
		expect(
			cleanMatchingSettings({
				companyNames: [' le space UG ', ''],
				ownIbans: ['DE00 1111 2222 3333 4444 55', 'kein iban'],
				rules: [
					{ contains: 'x', action: 'ignore' },
					{ contains: 'Finanzamt', action: 'delete' },
					{ id: 'ok', contains: ' Miete ', action: 'private', field: 'weird' }
				],
				extra: true
			})
		).toEqual({
			companyNames: ['le space UG'],
			ownIbans: ['DE00111122223333444455'],
			rules: [
				{ id: 'ok', field: 'counterparty', contains: 'Miete', action: 'private', reason: '' }
			],
			graceDays: 7
		});
		expect(cleanMatchingSettings(null)).toEqual({
			companyNames: [],
			ownIbans: [],
			rules: [],
			graceDays: 7
		});
	});

	it('the grace period: whole days 0–90, from a form field too; anything else is the default', () => {
		expect(cleanMatchingSettings({ graceDays: 0 }).graceDays).toBe(0);
		expect(cleanMatchingSettings({ graceDays: 14 }).graceDays).toBe(14);
		expect(cleanMatchingSettings({ graceDays: '3' }).graceDays).toBe(3);
		expect(cleanMatchingSettings({ graceDays: 90 }).graceDays).toBe(90);
		for (const bad of [-1, 91, 2.5, '', 'bald', null]) {
			expect(cleanMatchingSettings({ graceDays: bad }).graceDays, String(bad)).toBe(7);
		}
	});
});

describe('buildMatchingContext', () => {
	it('recognises a CAMT account by the hash of its IBAN', async () => {
		const accounts = [
			...ACCOUNTS.slice(0, 1),
			{
				id: 'ACC-CAMT',
				source: 'camt',
				sourceAccountId: await ibanKey('LT00 0000 0000 0000 0001'),
				ibanLast4: '0001'
			}
		];
		const transfer = tx({
			amountCents: -20000,
			counterparty: 'Revolut Bank UAB',
			counterpartyIban: 'LT000000000000000001'
		});
		const c = await buildMatchingContext({ accounts, transactions: [transfer], settings: null });
		expect(c.ownIbans.has('LT000000000000000001')).toBe(true);
		expect(classifyTransaction(transfer, c)?.kind).toBe('own-transfer');
	});

	it('pairs a Hibiscus account’s last four digits with the counter-booking', async () => {
		const out = tx({
			accountId: 'ACC-GLS',
			bookedOn: '2026-08-03',
			amountCents: -20000,
			counterparty: 'Revolut',
			counterpartyIban: 'LT000000000000000001'
		});
		const inn = tx({
			accountId: 'ACC-REV',
			bookedOn: '2026-08-05',
			amountCents: 20000,
			counterparty: 'Test'
		});
		const later = tx({ accountId: 'ACC-REV', bookedOn: '2026-08-20', amountCents: 20000 });
		const withMirror = await buildMatchingContext({
			accounts: ACCOUNTS,
			transactions: [out, inn],
			settings: null
		});
		expect(classifyTransaction(out, withMirror)?.kind).toBe('own-transfer');
		const without = await buildMatchingContext({
			accounts: ACCOUNTS,
			transactions: [out, later],
			settings: null
		});
		expect(classifyTransaction(out, without)).toBeNull();
	});

	it('takes company names and rules from the settings value', async () => {
		const c = await buildMatchingContext({
			accounts: [],
			transactions: [],
			settings: { companyNames: ['Beispiel UG'], rules: [{ contains: 'Kita', action: 'private' }] }
		});
		expect(c.companyNames).toEqual(['Beispiel UG']);
		expect(c.rules).toHaveLength(1);
	});
});
