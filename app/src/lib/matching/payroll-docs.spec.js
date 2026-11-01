// Payroll and tax documents (#233, part 2): one document linked to all the
// payments it stands for, and what the export's Buchungstext says. Every
// name, tax number and amount is made up.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { bookingText } from '../export/plan.js';
import { isActive } from './engine.js';
import { payrollText } from './payroll.js';
import { guessPayrollDoc, linkPayrollDoc, paymentsFor, unlinkPayrollDoc } from './payroll-docs.js';

/** @param {string} id @param {string} day @param {number} cents @param {Record<string, any>} [over] */
const tx = (id, day, cents, over = {}) => ({
	id,
	accountId: 'BANK',
	source: 'hibiscus',
	bookedOn: day,
	amountCents: cents,
	currency: 'EUR',
	counterparty: '',
	purpose: '',
	...over
});

const TXS = [
	tx('W1', '2025-12-30', -53354, { counterparty: 'Max Beispiel', purpose: 'Minijob 12/2025' }),
	tx('W2', '2026-01-02', -210000, { counterparty: 'Erika Beispiel', purpose: 'Gehalt' }),
	tx('W3', '2025-11-28', -53354, { counterparty: 'Max Beispiel', purpose: 'Minijob 11/2025' }),
	tx('L1', '2026-01-10', -48362, {
		counterparty: 'FK Musterstadt',
		purpose: '12/345/67890 LSt 12/2025'
	}),
	tx('V1', '2026-01-10', -1200, { counterparty: 'Finanzkasse Musterstadt', purpose: 'USt 2024' })
];
/** As the matching classified them (payroll.js). */
const CLASSIFIED = {
	W1: { kind: 'wage', employee: 'Max Beispiel', period: '2025-12', via: 'employee' },
	// Paid in January for December, no period in the purpose: its booking month.
	W2: { kind: 'wage', employee: 'Erika Beispiel', period: null, via: 'employee' },
	W3: { kind: 'wage', employee: 'Max Beispiel', period: '2025-11', via: 'employee' },
	L1: { kind: 'payroll-tax', tax: 'wage-tax', period: '2025-12', via: 'tax-office' },
	V1: { kind: 'tax-payment', tax: 'vat', period: '2024', via: 'tax-office' }
};

describe('payroll and tax documents (#233)', () => {
	it('what a document is and its period, from its name and text', () => {
		expect(
			guessPayrollDoc({ fileName: 'Lohnjournal 12-2025.pdf', text: 'Abrechnungsmonat 12/2025' })
		).toEqual({
			kind: 'payroll',
			period: '2025-12'
		});
		expect(
			guessPayrollDoc({ fileName: 'Lohnsteuer-Anmeldung Dezember.pdf', text: 'Zeitraum 12/2025' })
		).toEqual({
			kind: 'wage-tax-return',
			period: '2025-12'
		});
		expect(guessPayrollDoc({ subject: 'Beitragsnachweis Minijob-Zentrale IV/2025' })).toMatchObject(
			{
				kind: 'contributions',
				period: '2025-Q4'
			}
		);
		expect(guessPayrollDoc({ fileName: 'Bescheid über Umsatzsteuer 2024.pdf' })).toMatchObject({
			kind: 'tax-assessment',
			period: '2024'
		});
		expect(
			guessPayrollDoc({ fileName: 'Rechnung 2025-012.pdf', vendor: 'Wolkenfabrik Hosting GmbH' })
		).toBeNull();
	});

	it('the payments a document stands for: its kind, its period – or its month for one without', () => {
		const december = paymentsFor({ kind: 'payroll', period: '2025-12' }, TXS, CLASSIFIED);
		// W2 was booked in January: it belongs to January's payroll, not December's.
		expect(december.map((t) => t.id)).toEqual(['W1']);
		expect(
			paymentsFor({ kind: 'payroll', period: '2026-01' }, TXS, CLASSIFIED).map((t) => t.id)
		).toEqual(['W2']);
		expect(
			paymentsFor({ kind: 'wage-tax-return', period: '2025-12' }, TXS, CLASSIFIED).map((t) => t.id)
		).toEqual(['L1']);
		expect(
			paymentsFor({ kind: 'tax-assessment', period: '2024' }, TXS, CLASSIFIED).map((t) => t.id)
		).toEqual(['V1']);
	});

	it('linked to several payments at once, and let go again', async () => {
		const store = {
			receipts: memoryCollection('receipts').collection,
			transactions: memoryCollection('transactions').collection,
			matches: memoryCollection('matches').collection,
			events: memoryCollection('events').collection,
			settings: memoryCollection('settings').collection
		};
		const ids = [];
		for (const t of [TXS[0], TXS[2]])
			ids.push(String((await store.transactions.put({ ...t, id: undefined })).id));
		const journal = await store.receipts.put({
			fileName: 'Lohnjournal 2025.pdf',
			status: 'ausgelesen'
		});
		await linkPayrollDoc(store, String(journal.id), { kind: 'payroll', period: '2025-12' }, ids);
		expect((await store.receipts.get(String(journal.id)))?.payrollDoc).toEqual({
			kind: 'payroll',
			period: '2025-12'
		});
		const active = (await store.matches.list()).filter((m) => isActive(m));
		expect(active.map((m) => m.transactionId).sort()).toEqual([...ids].sort());
		await expect(
			linkPayrollDoc(store, String(journal.id), { kind: 'payroll', period: 'Dezember' }, ids)
		).rejects.toMatchObject({ code: 'period' });
		await unlinkPayrollDoc(store, String(journal.id));
		expect((await store.matches.list()).filter((m) => isActive(m))).toEqual([]);
		expect((await store.receipts.get(String(journal.id)))?.payrollDoc).toBeNull();
	});

	it('the Buchungstext says what and for when', () => {
		expect(payrollText(CLASSIFIED.W1, TXS[0])).toBe('Lohn 12/2025 Max Beispiel');
		expect(payrollText(CLASSIFIED.L1, TXS[3])).toBe('LSt 12/2025 FK Musterstadt');
		expect(payrollText(CLASSIFIED.V1, TXS[4])).toBe('USt 2024 Finanzkasse Musterstadt');
		expect(
			payrollText(
				{ kind: 'social-security', period: '2025-Q4', insurer: 'AOK' },
				tx('S', '2026-01-15', -100, { counterparty: 'AOK Beispiel' })
			)
		).toBe('SV-Beiträge 2025 Q4 AOK Beispiel');
		expect(payrollText({ kind: 'own-transfer' }, TXS[0])).toBeNull();
		// In the export, before the receipt's vendor.
		expect(bookingText(TXS[0], { vendor: 'Lohnjournal' }, CLASSIFIED.W1)).toBe(
			'Lohn 12/2025 Max Beispiel'
		);
		expect(bookingText(TXS[0], null, null)).toBe('Max Beispiel');
	});
});
