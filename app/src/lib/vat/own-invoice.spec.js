import { describe, expect, it } from 'vitest';

import { inputVat } from './input-vat.js';
import { outputVat } from './output-vat.js';
import { normalizeVatId, ownInvoiceTest } from './own-invoice.js';

const isOwn = ownInvoiceTest({ companyNames: ['Muster Beispiel UG'], ownVatId: 'DE 999 999 999' });
/** A made-up receipt as read. @param {Record<string, any>} over @param {Record<string, any>} [x] */
const receipt = (over, x = {}) => ({
	id: over.id ?? 'R',
	status: 'ausgelesen',
	documentDate: '2026-05-10',
	extraction: {
		currency: 'EUR',
		invoice_date: '2026-05-10',
		gross: 119,
		vat: [{ rate: 19, amount: 19 }],
		...x
	},
	...over
});

describe('our own invoices among the receipts (#354)', () => {
	it('by the company name, the bare mark, our VAT ID – and the person’s word over all', () => {
		expect(isOwn(receipt({ vendor: 'Muster Beispiel UG (haftungsbeschränkt)' }))).toBe(true);
		expect(isOwn(receipt({}, { vendor: '[FIRMA]' }))).toBe(true);
		expect(isOwn(receipt({ vendor: 'Kunde Beispiel' }, { vendor_vat_id: 'de999999999' }))).toBe(
			true
		);
		expect(
			isOwn(receipt({ vendor: 'Wolkenbau Beispiel GmbH' }, { vendor_vat_id: 'DE000000000' }))
		).toBe(false);
		expect(isOwn(receipt({ vendor: 'Muster Beispiel UG', ownInvoice: false }))).toBe(false);
		expect(isOwn(receipt({ vendor: 'Wolkenbau Beispiel GmbH', ownInvoice: true }))).toBe(true);
		expect(normalizeVatId(' de-999.999 999')).toBe('DE999999999');
	});

	it('its VAT is never input VAT, and counts as output VAT (Soll: the invoice date)', () => {
		const own = receipt({ id: 'O', vendor: 'Muster Beispiel UG', invoiceNumber: 'RE-2026-9' });
		const bought = receipt(
			{ id: 'B', vendor: 'Wolkenbau Beispiel GmbH' },
			{ vat: [{ rate: 19, amount: 7.6 }], gross: 47.6 }
		);
		const receipts = [own, bought];
		const input = inputVat({ receipts, matches: [], year: 2026, isOwn });
		expect(input.year.total).toBe(760);
		const output = outputVat({
			receipts,
			matches: [],
			transactions: [],
			year: 2026,
			basis: 'soll',
			isOwn
		});
		expect(output.year.total).toBe(1900);
		// Without the test (as before #354), the own invoice was input VAT.
		expect(inputVat({ receipts, matches: [], year: 2026 }).year.total).toBe(2660);
	});

	it('one the invoicing app sent and that was read from a PDF too counts once: the app’s', () => {
		const fromApp = receipt({
			id: 'A',
			source: 'invoice-app',
			ownInvoice: true,
			invoiceNumber: 'RE-2026/009'
		});
		const fromPdf = receipt({
			id: 'P',
			source: 'upload',
			vendor: 'Muster Beispiel UG',
			invoiceNumber: 're2026009'
		});
		const output = outputVat({
			receipts: [fromApp, fromPdf],
			matches: [],
			transactions: [],
			year: 2026,
			basis: 'soll',
			isOwn
		});
		expect(output.year.total).toBe(1900);
		expect(output.invoices).toBe(1);
	});

	it('a receipt waiting for a sender confirmation is not counted yet', () => {
		const held = receipt({ id: 'H', vendor: 'Muster Beispiel UG', status: 'rückfrage' });
		expect(
			outputVat({
				receipts: [held],
				matches: [],
				transactions: [],
				year: 2026,
				basis: 'soll',
				isOwn
			}).invoices
		).toBe(0);
	});
});
