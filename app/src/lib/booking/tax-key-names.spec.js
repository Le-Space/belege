// A BU key in words: the books' own keys first, DATEV's standard keys after,
// and no words for a key that is not on record.
import { describe, expect, it } from 'vitest';

import { setLocale } from '../i18n/index.js';
import de from '../i18n/de.js';
import en from '../i18n/en.js';
import { DEFAULT_TAX_KEYS } from './settings.js';
import { STANDARD_TAX_KEYS, offeredTaxKeys, taxKeyLabel, taxKeyName } from './tax-key-names.js';

describe('taxKeyName', () => {
	it('names the standard keys', () => {
		setLocale('de');
		expect(taxKeyName('9')).toBe('Vorsteuer 19 %');
		expect(taxKeyName(' 3 ')).toBe('Umsatzsteuer 19 %');
		expect(taxKeyName('94')).toContain('§ 13b');
		expect(taxKeyName('19')).toContain('Innergemeinschaftlicher Erwerb');
		expect(taxKeyLabel('8')).toBe('8 – Vorsteuer 7 %');
	});

	it('has no words for no key, or one that is not on record', () => {
		setLocale('de');
		for (const k of ['', null, undefined, '777', 'abc']) expect(taxKeyName(k)).toBe('');
		expect(taxKeyLabel('777')).toBe('777');
		expect(taxKeyLabel('')).toBe('');
	});

	it('a key the books gave a role means that role, whatever the standard says', () => {
		setLocale('de');
		const keys = { ...DEFAULT_TAX_KEYS, input19: '401', reverseCharge: '19' };
		expect(taxKeyName('401', keys)).toBe('Vorsteuer 19 %');
		expect(taxKeyName('19', keys)).toContain('§ 13b');
		// 9 is no longer the books' key for input VAT, but still the standard's.
		expect(taxKeyName('9', keys)).toBe('Vorsteuer 19 %');
	});

	it('offers the books’ keys first, then the standard ones, each once', () => {
		const keys = { ...DEFAULT_TAX_KEYS, input19: '401', output7: '' };
		const offered = offeredTaxKeys(keys);
		expect(offered.slice(0, 4)).toEqual(['401', '8', '3', '94']);
		expect(new Set(offered).size).toBe(offered.length);
		for (const k of STANDARD_TAX_KEYS) expect(offered).toContain(k);
	});

	it('every standard key and every role has words in both languages', () => {
		for (const catalogue of [de, en]) {
			const booking = /** @type {any} */ (catalogue).booking;
			for (const k of STANDARD_TAX_KEYS) expect(booking.taxKeyName[k]).toBeTruthy();
			for (const r of Object.keys(DEFAULT_TAX_KEYS)) expect(booking.taxKeyRole[r]).toBeTruthy();
		}
		setLocale('en');
		expect(taxKeyName('9')).toBe('Input VAT 19 %');
		setLocale('de');
	});
});
