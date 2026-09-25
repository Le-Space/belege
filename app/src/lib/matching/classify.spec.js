// Bookings that need no receipt: rules, bank fees, own transfers, loans.
import { describe, expect, it } from 'vitest';

import { ibanKey } from '../bank/fingerprint.js';
import { ACCOUNTS, tx } from './fixtures.js';
import { buildMatchingContext } from './context.js';
import {
	classifyTransaction,
	cleanMatchingSettings,
	feeKey,
	isOwnName,
	transferPairKey
} from './classify.js';

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
				via: 'booking-type',
				bookingType
			});
		}
		expect(
			classifyTransaction(tx({ amountCents: -1190, bookingType: 'Basislastschrift' }), ctx())
		).toBeNull();
	});

	it('bank fees by the bank transaction code (CAMT): CHRG, FEES, COMM', () => {
		expect(
			classifyTransaction(tx({ amountCents: -1000, bankCode: 'ACMT/MDOP/CHRG' }), ctx())
		).toEqual({ kind: 'bank-fee', via: 'bank-code', bankCode: 'ACMT/MDOP/CHRG' });
		expect(
			classifyTransaction(tx({ amountCents: -1000, bankCode: 'PMNT/CCRD/POSD' }), ctx())
		).toBeNull();
	});

	it('bank fees by the words of the purpose, when only the bank is on the other side', () => {
		// The Revolut plan fee: no counterparty, "Gebühr" in the purpose.
		const revolut = tx({
			amountCents: -1000,
			counterparty: '',
			purpose: 'Gebühr für Revolut Business • Gebühr für das Basic-Abo',
			bookingType: 'FEE'
		});
		expect(classifyTransaction(revolut, ctx())).toEqual({
			kind: 'bank-fee',
			via: 'fee-words',
			feeWord: 'Gebühr'
		});
		// The bank as counterparty counts as none.
		expect(
			classifyTransaction(
				tx({
					amountCents: -250,
					counterparty: 'GLS Gemeinschaftsbank eG',
					purpose: 'Entgelt Girocard'
				}),
				ctx()
			)?.via
		).toBe('fee-words');
		// A vendor's "Servicegebühr" needs its receipt; so does money coming in.
		expect(
			classifyTransaction(
				tx({ amountCents: -500, counterparty: 'Ticketshop Test GmbH', purpose: 'Servicegebühr' }),
				ctx()
			)
		).toBeNull();
		expect(
			classifyTransaction(
				tx({ amountCents: 500, counterparty: '', purpose: 'Gebühr erstattet' }),
				ctx()
			)
		).toBeNull();
	});

	it('bank fees a person taught: same account, same purpose words', () => {
		const porto = tx({
			accountId: 'ACC-REV',
			amountCents: -390,
			counterparty: '',
			purpose: 'Porto 09/2026'
		});
		expect(classifyTransaction(porto, ctx())).toBeNull();
		const taught = ctx({ feeKeys: new Set([feeKey(porto)]) });
		const next = { ...porto, purpose: 'Porto 10/2026' };
		expect(feeKey(next)).toBe('ACC-REV|porto');
		expect(classifyTransaction(next, taught)).toEqual({ kind: 'bank-fee', via: 'learned' });
		expect(classifyTransaction({ ...next, accountId: 'ACC-GLS' }, taught)).toBeNull();
		expect(feeKey(tx({ purpose: '2026 0815' }))).toBe('');
	});

	describe('own transfer by its counter-booking on our other account (#29)', () => {
		const out = tx({
			id: 'T-GLS-OUT',
			accountId: 'ACC-GLS',
			bookedOn: '2026-09-17',
			amountCents: -20000,
			counterparty: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
			purpose: 'Umbuchung'
		});
		const into = tx({
			id: 'T-REV-IN',
			accountId: 'ACC-REV',
			bookedOn: '2026-09-18',
			amountCents: 20000,
			counterparty: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
			purpose: 'Umbuchung'
		});
		/** @param {Record<string, any>[]} transactions @param {any} [settings] */
		const context = (transactions, settings = { companyNames: [] }) =>
			buildMatchingContext({ accounts: ACCOUNTS, transactions, settings });

		it('both sides, without a company name or an IBAN', async () => {
			const c = await context([out, into]);
			expect(classifyTransaction(into, c)).toEqual({
				kind: 'own-transfer',
				account: '1360',
				via: 'counter-booking',
				counterBookingId: 'T-GLS-OUT',
				counterAccountId: 'ACC-GLS',
				counterDay: '2026-09-17',
				sign: 'Umbuchung'
			});
			expect(classifyTransaction(out, c)?.counterBookingId).toBe('T-REV-IN');
		});

		it('a purpose that gives the reason, not "Umbuchung": the same name on both sides alone is no sign', async () => {
			const why = { ...into, purpose: 'Claude Code (KI)' };
			const away = { ...out, purpose: 'Claude Code (KI)' };
			expect(classifyTransaction(why, await context([away, why]))).toBeNull();
			// With the company name set up, it is one.
			const c = await context([away, why], { companyNames: ['le space UG'] });
			expect(classifyTransaction(why, c)?.via).toBe('counter-booking');
		});

		it('the other side names this account as its counterparty account: the sign', async () => {
			const why = { ...into, purpose: 'Claude Code (KI)', counterparty: '' };
			// GLS paid to the Revolut account (···0001 is ACC-REV's last four).
			const away = {
				...out,
				purpose: 'Claude Code (KI)',
				counterparty: 'Irgendein Name',
				counterpartyIban: 'LT000000000000000001'
			};
			const c = await context([away, why]);
			expect(classifyTransaction(why, c)).toMatchObject({
				via: 'counter-booking',
				sign: 'eigenes Konto'
			});
		});

		it('only one side imported: no counter-booking, no guess', async () => {
			expect(classifyTransaction(into, await context([into]))).toBeNull();
		});

		it('two equal transfers in the window: no guess', async () => {
			const twin = { ...out, id: 'T-GLS-OUT-2', bookedOn: '2026-09-19' };
			expect(classifyTransaction(into, await context([out, twin, into]))).toBeNull();
		});

		it('a vendor refund of the same amount on another account is no transfer (no sign)', async () => {
			const payment = tx({
				id: 'T-GLS-PAY',
				accountId: 'ACC-GLS',
				bookedOn: '2026-09-10',
				amountCents: -4999,
				counterparty: 'Versand Test GmbH',
				purpose: 'Bestellung 4711'
			});
			const refund = tx({
				id: 'T-REV-REF',
				accountId: 'ACC-REV',
				bookedOn: '2026-09-12',
				amountCents: 4999,
				counterparty: 'Versand Test GmbH',
				purpose: 'Erstattung Bestellung 4711'
			});
			expect(classifyTransaction(refund, await context([payment, refund]))).toBeNull();
		});

		it('too far apart, the same account, or marked "keine Umbuchung": not paired', async () => {
			const late = { ...out, bookedOn: '2026-09-25' };
			expect(classifyTransaction(into, await context([late, into]))).toBeNull();
			const sameAccount = { ...out, accountId: 'ACC-REV' };
			expect(classifyTransaction(into, await context([sameAccount, into]))).toBeNull();
			const c = await context([out, into], {
				companyNames: [],
				notTransfers: [transferPairKey('T-REV-IN', 'T-GLS-OUT')]
			});
			expect(classifyTransaction(into, c)).toBeNull();
		});
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
			graceDays: 7,
			feeKeys: [],
			notTransfers: []
		});
		expect(cleanMatchingSettings(null)).toEqual({
			companyNames: [],
			ownIbans: [],
			rules: [],
			graceDays: 7,
			feeKeys: [],
			notTransfers: []
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
