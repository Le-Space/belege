// The read share's snapshot (issue #124): scope and redaction. Made-up data only.
import { describe, expect, it } from 'vitest';

import { buildSnapshot, redactText } from './snapshot.js';

describe('redactText', () => {
	it('IBANs to their last four; mail and phone out; long numbers and chain ids shortened', () => {
		const text = redactText(
			'IBAN DE00 1234 5678 9012 3456 78, Kunde C-0012345678, Tel. +49 170 1234567, a@b.de, 0x' +
				'ab'.repeat(20) +
				', Rechnung 2026-07'
		);
		expect(text).toContain('[IBAN …5678]');
		expect(text).toContain('[Telefon]');
		expect(text).toContain('[E-Mail]');
		expect(text).toContain('0xabab…abab');
		expect(text).not.toMatch(/0012345678|1234567|DE00 1234/);
		expect(text).toContain('Rechnung 2026-07');
	});
});

describe('buildSnapshot', () => {
	const books = {
		accounts: [{ id: 'giro', name: 'Girokonto', ibanLast4: '4711' }],
		transactions: [
			{
				id: 't1',
				bookedOn: '2026-06-03',
				amountCents: -1500,
				counterparty: 'Funkmobil Test',
				purpose: 'Kunde 0012345678 Aufladung',
				accountId: 'giro',
				counterpartyIban: 'DE00123456781234567890',
				receiptId: null
			},
			{
				id: 't0',
				bookedOn: '2025-12-30',
				amountCents: -500,
				counterparty: 'Alt',
				accountId: 'giro'
			}
		],
		receipts: [
			{
				id: 'r1',
				documentDate: '2026-06-15',
				vendor: 'Funkmobil Test',
				extraction: {
					gross: 1.98,
					invoice_number: 'FM2605B10013918642',
					summary: 'Rufnummer 01701234567'
				},
				fileName: 'Max Muster Rechnung.pdf',
				from: 'Funkmobil <rechnung@funkmobil.example>',
				status: 'ausgelesen'
			}
		],
		questions: [
			{ id: 'q1', kind: 'missing-receipt', state: 'open', transactionId: 't1', candidates: [] }
		],
		matches: [],
		classifications: {}
	};

	it('only the year and the collections chosen; redacted by default', () => {
		const s = /** @type {any} */ (
			buildSnapshot({
				books,
				collections: ['transactions', 'receipts'],
				year: 2026,
				redacted: true,
				now: '2026-09-27T10:00:00Z'
			})
		);
		expect(s.transactions.map((/** @type {any} */ t) => t.id)).toEqual(['t1']);
		expect(s.questions).toBeUndefined();
		expect(s.transactions[0]).toMatchObject({
			amountCents: -1500,
			payee: 'Funkmobil Test',
			account: 'Girokonto ···4711'
		});
		const text = JSON.stringify(s);
		for (const secret of [
			'DE00123456781234567890',
			'0012345678',
			'B10013918642',
			'01701234567',
			'Max Muster',
			'rechnung@funkmobil.example'
		]) {
			expect(text.includes(secret), secret).toBe(false);
		}
		expect(s.receipts[0]).toMatchObject({ vendor: 'Funkmobil Test', grossCents: 198 });
	});

	it('not redacted: as stored, file names and IBANs included', () => {
		const s = /** @type {any} */ (
			buildSnapshot({
				books,
				collections: ['transactions', 'receipts', 'questions'],
				year: 2026,
				redacted: false,
				now: '2026-09-27T10:00:00Z'
			})
		);
		expect(s.transactions[0].counterpartyIban).toBe('DE00123456781234567890');
		expect(s.receipts[0].fileName).toBe('Max Muster Rechnung.pdf');
		expect(s.questions).toHaveLength(1);
	});
});
