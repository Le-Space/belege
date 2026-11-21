// The private share of a payment: a share that can be, the two parts in
// cents, which bills are telecommunication, and what the books suggest.
// Made-up vendors and amounts.
import { describe, expect, it } from 'vitest';

import { cleanPrivateShare, splitCents, suggestedShare, telecomKind } from './private-share.js';

describe('cleanPrivateShare', () => {
	it('takes 1 to 99 percent and an account number', () => {
		expect(cleanPrivateShare({ percent: 30, account: '1390' })).toEqual({
			percent: 30,
			account: '1390'
		});
		expect(cleanPrivateShare({ percent: ' 50 ', account: ' 1390 ' })).toEqual({
			percent: 50,
			account: '1390'
		});
	});

	it('is none for anything else', () => {
		for (const bad of [
			null,
			undefined,
			'30',
			{},
			{ percent: 0, account: '1390' },
			{ percent: 100, account: '1390' },
			{ percent: 12.5, account: '1390' },
			{ percent: 30, account: '' },
			{ percent: 30, account: '13' },
			{ percent: 'viel', account: '1390' }
		]) {
			expect(cleanPrivateShare(bad)).toBeNull();
		}
	});
});

describe('splitCents', () => {
	it('the two parts add up to the payment, to the cent', () => {
		expect(splitCents(-5259, 50)).toEqual({ business: -2629, private: -2630 });
		expect(splitCents(-1499, 30)).toEqual({ business: -1049, private: -450 });
		for (const cents of [-1, -2, -3, -99, -1001, -123457, 777]) {
			for (const percent of [1, 30, 33, 50, 70, 99]) {
				const parts = splitCents(cents, percent);
				expect(parts.business + parts.private).toBe(cents);
				expect(Math.sign(parts.private) * Math.sign(cents)).toBeGreaterThanOrEqual(0);
			}
		}
	});
});

describe('telecomKind', () => {
	it('a landline or fixed connection', () => {
		expect(telecomKind(['Kabelnetz Beispiel GmbH', 'Ihre Rechnung DSL 100'])).toBe('landline');
		expect(telecomKind(['Rechnung online bei www.example.de/meinkabel'])).toBe('landline');
		expect(telecomKind(['Glasfaser Anschluss 10/2026'])).toBe('landline');
	});

	it('everything mobile, also in a bundle with a landline', () => {
		expect(telecomKind(['Gebuehr fuer Allnet M fuer Ihr Prepaid-Konto'])).toBe('mobile');
		expect(telecomKind(['Mobilfunk 10/2026'])).toBe('mobile');
		expect(telecomKind(['Festnetz und Mobilfunk Paket'])).toBe('mobile');
	});

	it('nothing else', () => {
		expect(telecomKind(['Wolkenfabrik Hosting GmbH', 'Server 10/2026'])).toBeNull();
		expect(telecomKind(['Kabelbinder 100 Stück', 'Simulation'])).toBeNull();
		expect(telecomKind([null, undefined, ''])).toBeNull();
	});
});

describe('suggestedShare', () => {
	const rule = { account: '1390', landline: 50, mobile: 30 };
	const landline = { amountCents: -5259, counterparty: 'Kabelnetz Beispiel GmbH', purpose: 'DSL' };
	const mobile = { amountCents: -1499, counterparty: 'Funknetz Test AG', purpose: 'Prepaid' };

	it('the rule: one percentage for a landline, another for mobile', () => {
		expect(suggestedShare({ tx: landline, receipt: null, partner: null, rule })).toEqual({
			share: { percent: 50, account: '1390' },
			via: 'landline'
		});
		expect(suggestedShare({ tx: mobile, receipt: null, partner: null, rule })).toEqual({
			share: { percent: 30, account: '1390' },
			via: 'mobile'
		});
	});

	it('the receipt’s positions count where the payment says nothing', () => {
		const tx = { amountCents: -2000, counterparty: 'Stromwerk Test AG', purpose: 'Rechnung 4711' };
		const receipt = { extraction: { line_items: [{ description: 'Mobilfunk Tarif L' }] } };
		expect(suggestedShare({ tx, receipt, partner: null, rule })?.via).toBe('mobile');
		expect(suggestedShare({ tx, receipt: null, partner: null, rule })).toBeNull();
	});

	it('off without an account or a percentage, and for money that came in', () => {
		expect(suggestedShare({ tx: landline, receipt: null, partner: null, rule: null })).toBeNull();
		expect(
			suggestedShare({ tx: landline, receipt: null, partner: null, rule: { ...rule, account: '' } })
		).toBeNull();
		expect(
			suggestedShare({ tx: landline, receipt: null, partner: null, rule: { ...rule, landline: 0 } })
		).toBeNull();
		expect(
			suggestedShare({ tx: { ...landline, amountCents: 5259 }, receipt: null, partner: null, rule })
		).toBeNull();
	});

	it('what the vendor was booked with last time goes before the rule, also "whole"', () => {
		const learned = {
			name: 'Kabelnetz Beispiel GmbH',
			privateShare: { percent: 20, account: '1800' }
		};
		expect(suggestedShare({ tx: landline, receipt: null, partner: learned, rule })).toEqual({
			share: { percent: 20, account: '1800' },
			via: 'learned'
		});
		const whole = { name: 'Kabelnetz Beispiel GmbH', privateShare: null };
		expect(suggestedShare({ tx: landline, receipt: null, partner: whole, rule })).toBeNull();
		// A vendor learned before shares existed says nothing about them: the rule.
		const old = { name: 'Kabelnetz Beispiel GmbH', account: '4920' };
		expect(suggestedShare({ tx: landline, receipt: null, partner: old, rule })?.via).toBe(
			'landline'
		);
	});
});
