import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { readEInvoice, sniffEInvoice } from './einvoice.js';
import { CII_BASIC_WL, CII_XRECHNUNG, UBL_CREDIT_NOTE, UBL_INVOICE } from './einvoice.fixtures.js';

const read = (/** @type {string} */ xml) =>
	readEInvoice(xml, { DOMParser: /** @type {any} */ (DOMParser) });
const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s);

describe('e-invoices (#160)', () => {
	it('knows one by its root element, and nothing else', () => {
		expect(sniffEInvoice(bytes(UBL_INVOICE))).toBe('ubl');
		expect(sniffEInvoice(bytes(UBL_CREDIT_NOTE))).toBe('ubl');
		expect(
			sniffEInvoice(bytes(`\uFEFF<!-- Kopie -->${CII_XRECHNUNG.replace(/^<\?xml[^>]*>/, '')}`))
		).toBe('cii');
		expect(
			sniffEInvoice(
				bytes(
					'<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"/>'
				)
			)
		).toBeNull();
		expect(sniffEInvoice(bytes('<Invoice>kein Namensraum</Invoice>'))).toBeNull();
		expect(sniffEInvoice(bytes('%PDF-1.7'))).toBeNull();
	});

	it('XRechnung in UBL: every field the matching uses, without a model', () => {
		const r = read(UBL_INVOICE);
		expect(r).toMatchObject({ syntax: 'ubl', eInvoice: true });
		expect(r.profile).toContain('xrechnung_3.0');
		expect(r.extraction).toEqual({
			document_type: 'invoice',
			vendor: 'Wolkenbau Beispiel GmbH',
			vendor_vat_id: 'DE000000000',
			invoice_number: 'WB-2026-0815',
			customer_number: 'K-4711',
			invoice_date: '2026-09-14',
			due_or_debit_date: '2026-09-28',
			service_period: { from: '2026-09-01', to: '2026-09-30' },
			currency: 'EUR',
			net: 100,
			vat: [{ rate: 19, amount: 19 }],
			gross: 119,
			payment: 'bank_transfer',
			iban_last4: '1234',
			reverse_charge: false,
			travel: null,
			summary: 'Speicherpaket Beispiel September',
			line_items: [{ description: 'Speicherpaket Beispiel September', amount: 100 }],
			no_payment_request: false
		});
	});

	it('XRechnung in CII: the same fields, dates in format 102, a direct debit', () => {
		const r = read(CII_XRECHNUNG);
		expect(r).toMatchObject({ syntax: 'cii', eInvoice: true });
		expect(r.extraction).toMatchObject({
			vendor: 'Papierwerk Beispiel GmbH',
			vendor_vat_id: 'DE000000001',
			invoice_number: 'PW-2026-0042',
			customer_number: 'K-0042',
			invoice_date: '2026-09-14',
			due_or_debit_date: '2026-09-30',
			net: 41.09,
			vat: [{ rate: 19, amount: 7.81 }],
			gross: 48.9,
			payment: 'direct_debit',
			iban_last4: '9876',
			line_items: [{ description: 'Druckpapier Beispiel A4', amount: 41.09 }]
		});
	});

	it('a credit note is negative, as the extraction books it', () => {
		const r = read(UBL_CREDIT_NOTE);
		expect(r.extraction).toMatchObject({
			invoice_number: 'WB-G-2026-07',
			net: -10,
			vat: [{ rate: 19, amount: -1.9 }],
			gross: -11.9,
			line_items: [{ description: 'Gutschrift Ausfall Beispiel', amount: -10 }]
		});
	});

	it('Factur-X BASIC WL is read, but is no EN 16931 e-invoice', () => {
		const r = read(CII_BASIC_WL);
		expect(r).toMatchObject({
			syntax: 'cii',
			eInvoice: false,
			profile: 'urn:factur-x.eu:1p0:basicwl'
		});
		expect(r.extraction.gross).toBe(48.9);
	});

	it('a reverse charge invoice says so', () => {
		const rc = UBL_INVOICE.replace(
			'<cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent>',
			'<cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent>'
		);
		expect(read(rc).extraction.reverse_charge).toBe(true);
	});

	it('refuses what is no e-invoice', () => {
		expect(() => read('<Document/>')).toThrow('not an e-invoice');
		expect(() => read('kein xml')).toThrow();
	});
});
