// Signs of a scam in a receipt mail: each rule, the threshold, and that a
// person's word ends it. Every name, domain and number is made up.
import { describe, expect, it } from 'vitest';

import { FREE_MAIL, imitates, registrable, scamContext, scamSigns } from './scam.js';

const partner = {
	name: 'Wolkenfabrik Hosting GmbH',
	aliases: ['wolkenfabrik hosting'],
	senderDomains: ['rechnung.wolkenfabrik.example']
};
const ctx = scamContext({
	partners: [partner],
	transactions: [
		{ counterparty: 'Wolkenfabrik Hosting', counterpartyIban: 'DE00 1234 5678 0000 0042 11' }
	],
	accounts: [{ ibanLast4: '1400' }]
});

/** @param {Record<string, any>} over @param {Record<string, any>} [x] */
const mail = (over = {}, x = {}) => ({
	source: 'mail',
	authVerdict: 'pass',
	from: 'Wolkenfabrik <billing@wolkenfabrik.example>',
	subject: 'Ihre Rechnung',
	excerpt: 'Anbei Ihre Rechnung.',
	vendor: 'Wolkenfabrik Hosting GmbH',
	extraction: { document_type: 'invoice', vendor: 'Wolkenfabrik Hosting GmbH', ...x },
	...over
});

const codes = (/** @type {any} */ r) => scamSigns(r, ctx).signs.map((s) => s.code);

describe('domains', () => {
	it('the registrable part, with a country second level', () => {
		expect(registrable('rechnung.wolkenfabrik.example')).toBe('wolkenfabrik.example');
		expect(registrable('mail.shop.co.uk')).toBe('shop.co.uk');
		expect(FREE_MAIL.has('gmx.de')).toBe(true);
	});

	it('what imitates: a letter or two off, lookalike letters, another ending; not itself or others', () => {
		expect(imitates('wolkenfabrlk.example', 'wolkenfabrik.example')).toBe(true);
		expect(imitates('wo1kenfabrik.example', 'wolkenfabrik.example')).toBe(true);
		expect(imitates('wolkenfabrik.co', 'wolkenfabrik.example')).toBe(true);
		expect(imitates('mail.wolkenfabrik.example', 'wolkenfabrik.example')).toBe(false);
		expect(imitates('stromwerk.example', 'wolkenfabrik.example')).toBe(false);
		expect(imitates('abcd.example', 'abce.example')).toBe(false); // too short to say
	});
});

describe('scamSigns', () => {
	it('the known vendor from its known domain: nothing', () => {
		expect(scamSigns(mail(), ctx)).toEqual({ signs: [], suspicious: false });
	});

	it('strong signs, each on its own a suspicion', () => {
		expect(codes(mail({ authVerdict: 'fail' }))).toEqual(['auth-fail']);
		expect(codes(mail({ from: 'Wolkenfabrik <billing@wolkenfabrlk.example>' }))).toEqual([
			'lookalike'
		]);
		expect(codes(mail({ from: 'Wolkenfabrik <billing@cloud-invoices.example>' }))).toEqual([
			'other-domain'
		]);
		expect(codes(mail({}, { iban_last4: '9999' }))).toEqual(['new-iban']);
		expect(scamSigns(mail({ authVerdict: 'fail' }), ctx).suspicious).toBe(true);
	});

	it('the IBAN it was paid to before, or our own account on a direct debit: no sign', () => {
		expect(codes(mail({}, { iban_last4: '4211' }))).toEqual([]);
		expect(codes(mail({}, { iban_last4: '1400' }))).toEqual([]);
	});

	it('weak signs: one is a hint, two are a suspicion', () => {
		const unknown = { vendor: 'Neuer Anbieter GmbH' };
		const one = mail(
			{ ...unknown, from: 'x <rechnung@gmx.de>' },
			{ vendor: 'Neuer Anbieter GmbH' }
		);
		expect(scamSigns(one, ctx)).toMatchObject({ suspicious: false });
		expect(codes(one)).toEqual(['free-mail']);
		const two = mail(
			{
				...unknown,
				from: 'x <rechnung@gmx.de>',
				subject: 'Letzte Mahnung – sofort zahlen',
				extractionSent: 'Zahlen Sie hier: [LINK pay-now.example]'
			},
			{ vendor: 'Neuer Anbieter GmbH' }
		);
		expect(codes(two)).toEqual(['free-mail', 'pressure', 'foreign-links']);
		expect(scamSigns(two, ctx).suspicious).toBe(true);
	});

	it('a person’s word ends it; a released sender is not held against it; only mails', () => {
		expect(scamSigns(mail({ authVerdict: 'fail', scamCleared: true }), ctx).signs).toEqual([]);
		expect(codes(mail({ authVerdict: 'fail', confirmedByUser: true }))).toEqual([]);
		expect(scamSigns(mail({ source: 'upload', authVerdict: 'fail' }), ctx).signs).toEqual([]);
	});
});
