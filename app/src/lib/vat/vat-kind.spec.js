import { describe, expect, it } from 'vitest';

import { vatCase, vatIdCountry, vatKinds } from './vat-kind.js';

/** A made-up invoice as read (#357). @param {string} id @param {Record<string, any>} x @param {Record<string, any>} [over] */
const inv = (id, x, over = {}) => ({
	id,
	status: 'ausgelesen',
	documentDate: x.invoice_date ?? '2026-05-10',
	extraction: { currency: 'EUR', invoice_date: '2026-05-10', ...x },
	...over
});
const line = (
	/** @type {number} */ rate,
	/** @type {number} */ amount,
	/** @type {string | null} */ category = null
) => ({
	rate,
	amount,
	category
});

describe('the VAT case of an invoice (#354)', () => {
	it('our own: domestic, §13b in Germany, intra-EU, third country, exempt', () => {
		const own = (/** @type {Record<string, any>} */ x) => vatCase(inv('O', x), true);
		expect(
			own({ net: 100, gross: 119, vat: [line(19, 19, 'standard')], customer_country: 'DE' })
		).toMatchObject({
			side: 'output',
			kind: 'domestic',
			vatCents: 1900,
			netCents: 10000
		});
		expect(
			own({ net: 100, gross: 100, vat: [line(0, 0, 'reverse_charge')], customer_country: 'DE' })
				.kind
		).toBe('reverseChargeDe');
		expect(
			own({
				net: 500,
				gross: 500,
				vat: [line(0, 0, 'intra_eu')],
				customer_vat_id: 'ATU00000000',
				customer_country: 'AT'
			})
		).toMatchObject({ kind: 'intraEu', vatId: 'ATU00000000', country: 'AT', netCents: 50000 });
		// A §13b service to a business in another EU country is reported in the ZM too.
		expect(
			own({
				net: 80,
				gross: 80,
				vat: [line(0, 0, 'reverse_charge')],
				customer_vat_id: 'FR00000000000'
			}).kind
		).toBe('intraEu');
		expect(own({ net: 300, gross: 300, vat: [], customer_country: 'CH' }).kind).toBe(
			'thirdCountry'
		);
		expect(own({ net: 300, gross: 300, vat: [line(0, 0, 'export')] }).kind).toBe('thirdCountry');
		expect(
			own({ net: 50, gross: 50, vat: [line(0, 0, 'exempt')], customer_country: 'DE' }).kind
		).toBe('exempt');
	});

	it('our own, unclear rather than guessed: intra-EU without the customer’s VAT ID, 0 % to nowhere known', () => {
		expect(
			vatCase(
				inv('U', { net: 500, gross: 500, vat: [line(0, 0, 'intra_eu')], customer_country: 'AT' }),
				true
			)
		).toMatchObject({
			kind: 'unclear',
			reason: 'noCustomerVatId'
		});
		expect(vatCase(inv('U2', { net: 500, gross: 500, vat: [] }), true)).toMatchObject({
			kind: 'unclear',
			reason: 'noCountry'
		});
	});

	it('received: domestic, foreign VAT, §13b, intra-EU acquisition, third country', () => {
		const got = (/** @type {Record<string, any>} */ x) => vatCase(inv('E', x), false);
		expect(got({ net: 40, gross: 47.6, vat: [line(19, 7.6)], vendor_country: 'DE' }).kind).toBe(
			'domestic'
		);
		expect(
			got({ net: 100, gross: 120, vat: [line(20, 20)], vendor_vat_id: 'ATU11111111' })
		).toMatchObject({
			kind: 'foreignVat',
			country: 'AT'
		});
		expect(
			got({ net: 200, gross: 200, vat: [], reverse_charge: true, vendor_country: 'IE' }).kind
		).toBe('reverseCharge');
		expect(
			got({ net: 900, gross: 900, vat: [line(0, 0, 'intra_eu')], vendor_country: 'NL' }).kind
		).toBe('intraEuAcquisition');
		expect(got({ net: 30, gross: 30, vat: [], vendor_country: 'US' }).kind).toBe('thirdCountry');
		expect(got({ net: 30, gross: 30, vat: [], vendor_country: 'FR' })).toMatchObject({
			kind: 'unclear',
			reason: 'noCategory'
		});
	});

	it('a VAT ID’s country: EL is Greece', () => {
		expect(vatIdCountry('EL000000000')).toBe('GR');
		expect(vatIdCountry('DE123')).toBe('DE');
		expect(vatIdCountry('')).toBeNull();
	});

	it('the year in sums per kind, what is unclear, and the ZM per period and customer', () => {
		const receipts = [
			inv(
				'A',
				{
					net: 500,
					gross: 500,
					vat: [line(0, 0, 'intra_eu')],
					customer_vat_id: 'ATU00000000',
					invoice_date: '2026-02-10'
				},
				{ ownInvoice: true }
			),
			inv(
				'B',
				{
					net: 250,
					gross: 250,
					vat: [line(0, 0, 'intra_eu')],
					customer_vat_id: 'ATU00000000',
					invoice_date: '2026-03-10'
				},
				{ ownInvoice: true }
			),
			inv(
				'C',
				{ net: 100, gross: 119, vat: [line(19, 19)], customer_country: 'DE' },
				{ ownInvoice: true }
			),
			inv('D', { net: 40, gross: 47.6, vat: [line(19, 7.6)], vendor_country: 'DE' }),
			inv(
				'E',
				{ net: 500, gross: 500, vat: [line(0, 0, 'intra_eu')], customer_country: 'AT' },
				{ ownInvoice: true }
			),
			inv('F', { net: 10, gross: 11.9, vat: [line(19, 1.9)] }, { status: 'rückfrage' })
		];
		const k = vatKinds({ receipts, isOwn: (r) => r.ownInvoice === true, year: 2026 });
		expect(k.output.intraEu).toMatchObject({ netCents: 75000, receipts: ['A', 'B'] });
		expect(k.output.domestic).toMatchObject({ vatCents: 1900 });
		expect(k.input.domestic).toMatchObject({ vatCents: 760 });
		expect(k.unclear).toEqual([{ id: 'E', side: 'output', reason: 'noCustomerVatId' }]);
		expect(k.zm).toEqual([
			{ period: 'Q1', vatId: 'ATU00000000', country: 'AT', netCents: 75000, invoices: 2 }
		]);
	});
});
