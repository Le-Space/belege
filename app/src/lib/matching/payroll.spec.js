import { describe, expect, it } from 'vitest';

import { payrollAccount, payrollKind, periodOf } from './payroll.js';
import { classifyTransaction } from './classify.js';
import { buildMatchingContext } from './context.js';

/** @param {Record<string, any>} over */
const tx = (over) => ({
	id: 't1',
	accountId: 'acc-1',
	bookedOn: '2026-01-02',
	amountCents: -48362,
	counterparty: '',
	purpose: '',
	...over
});

describe('wages, payroll taxes, contributions and tax payments (#233)', () => {
	it('the tax office: which tax, and for which period', () => {
		expect(
			payrollKind(tx({ counterparty: 'FK Musterstadt', purpose: '123/456/78901 LSt. 12/2025' }))
		).toEqual({
			kind: 'payroll-tax',
			tax: 'wage-tax',
			period: '2025-12',
			via: 'tax-office'
		});
		expect(
			payrollKind(
				tx({
					counterparty: 'Finanzkasse Musterstadt',
					purpose: 'StNr. 123/456/78901 Umsatzsteuerrestzahlung 2024/2025'
				})
			)
		).toMatchObject({ kind: 'tax-payment', tax: 'vat', period: '2024/2025' });
		expect(
			payrollKind(tx({ counterparty: 'Finanzamt Musterstadt', purpose: 'USt-VA IV/2025' }))
		).toMatchObject({
			tax: 'vat',
			period: '2025-Q4'
		});
		expect(
			payrollKind(
				tx({ counterparty: 'Finanzamt Musterstadt', purpose: 'KSt Vorauszahlung Q1 2026' })
			)
		).toMatchObject({
			tax: 'corporate',
			period: '2026-Q1'
		});
		// No office named, but a tax number in the purpose.
		expect(
			payrollKind(tx({ counterparty: 'Landesbank', purpose: '123/456/78901 Säumniszuschlag' }))
		).toMatchObject({
			kind: 'tax-payment',
			tax: null,
			via: 'tax-number'
		});
		// Trade tax goes to the municipality.
		expect(
			payrollKind(tx({ counterparty: 'Stadtkasse Musterstadt', purpose: 'Gewerbesteuer 2025' }))
		).toMatchObject({
			kind: 'tax-payment',
			tax: 'trade',
			via: 'municipality'
		});
	});

	it('contributions: the Minijob-Zentrale, insurers, the Berufsgenossenschaft', () => {
		expect(
			payrollKind(tx({ counterparty: 'Minijob-Zentrale', purpose: 'Beitrag 12/2025' }))
		).toMatchObject({
			kind: 'social-security',
			insurer: 'Minijob-Zentrale',
			period: '2025-12'
		});
		expect(payrollKind(tx({ counterparty: 'Beispiel BKK' }))).toMatchObject({
			kind: 'social-security'
		});
	});

	it('wages: a person on the employees list, or Lohn/Gehalt/Minijob in an outgoing purpose', () => {
		const employees = ['Max Beispiel'];
		expect(
			payrollKind(tx({ counterparty: 'MAX BEISPIEL', purpose: 'Danke' }), { employees })
		).toMatchObject({
			kind: 'wage',
			employee: 'Max Beispiel',
			via: 'employee'
		});
		expect(
			payrollKind(tx({ counterparty: 'Erika Muster', purpose: 'Minijob Beispiel UG 12/2025' }))
		).toMatchObject({
			kind: 'wage',
			via: 'wage-words',
			period: '2025-12'
		});
		// Incoming is no wage paid, and a crypto movement is none of these.
		expect(payrollKind(tx({ amountCents: 1000, purpose: 'Gehalt' }))).toBeNull();
		expect(payrollKind(tx({ movement: 'transfer', counterparty: 'Finanzamt' }))).toBeNull();
		expect(
			payrollKind(tx({ counterparty: 'Wolkenfabrik Hosting GmbH', purpose: 'RE-1001' }))
		).toBeNull();
	});

	it('periods and accounts', () => {
		expect(periodOf('LSt. 1/2026')).toBe('2026-01');
		expect(periodOf('nichts')).toBeNull();
		expect(payrollAccount({ kind: 'wage', period: null, via: 'employee' }, '2026-01-02')).toBe(
			'1740'
		);
		expect(
			payrollAccount(
				{ kind: 'payroll-tax', tax: 'wage-tax', period: null, via: 'tax-office' },
				'2026-01-02'
			)
		).toBe('1741');
		expect(
			payrollAccount({ kind: 'social-security', period: null, via: 'insurer' }, '2026-01-02')
		).toBe('1742');
		expect(
			payrollAccount(
				{ kind: 'tax-payment', tax: 'vat', period: '2026-Q1', via: 'tax-office' },
				'2026-04-10'
			)
		).toBe('1780');
		expect(
			payrollAccount(
				{ kind: 'tax-payment', tax: 'vat', period: '2024/2025', via: 'tax-office' },
				'2026-01-13'
			)
		).toBe('1790');
		expect(
			payrollAccount(
				{ kind: 'tax-payment', tax: 'trade', period: null, via: 'municipality' },
				'2026-01-02'
			)
		).toBe('4320');
		expect(
			payrollAccount(
				{ kind: 'tax-payment', tax: null, period: null, via: 'tax-number' },
				'2026-01-02'
			)
		).toBeNull();
	});

	it('the classifier covers them: no receipt asked for, the account suggested', async () => {
		const wage = tx({ counterparty: 'Max Beispiel', purpose: 'Lohn 12/2025' });
		const ctx = await buildMatchingContext({
			accounts: [],
			transactions: [wage],
			settings: { employees: ['Max Beispiel'] }
		});
		expect(classifyTransaction(wage, ctx)).toMatchObject({
			kind: 'wage',
			account: '1740',
			employee: 'Max Beispiel',
			period: '2025-12'
		});
	});
});
