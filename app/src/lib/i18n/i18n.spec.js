import { afterEach, describe, expect, it } from 'vitest';

import de from './de.js';
import en from './en.js';
import {
	DOCUMENT_LOCALE,
	currentLocale,
	initialLocale,
	intlLocale,
	keysOf,
	missingInEnglish,
	setLocale,
	t,
	tDocument
} from './index.js';
import { formatDate, formatMoney } from '../bank/format.js';

/** @param {any} catalogue @param {string} key */
const at = (catalogue, key) => key.split('.').reduce((n, k) => n?.[k], catalogue);
/** @param {unknown} text */
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the catalogues (#192)', () => {
	afterEach(() => setLocale('de'));

	it('English has only keys German has, of the same kind and with the same placeholders', () => {
		const german = new Set(keysOf(/** @type {any} */ (de)));
		for (const key of keysOf(/** @type {any} */ (en))) {
			expect(german.has(key), key).toBe(true);
			const a = at(de, key);
			const b = at(en, key);
			expect(Array.isArray(b), key).toBe(Array.isArray(a));
			if (typeof a === 'string') expect(placeholders(b), key).toEqual(placeholders(a));
		}
		// Not complete yet: the switch stays hidden until this is 0.
		expect(missingInEnglish().length).toBeGreaterThan(0);
	});

	it('switches at once; a key English lacks shows in German, never blank', () => {
		expect(currentLocale()).toBe('de');
		expect(t('language.label')).toBe('Sprache');
		setLocale('en');
		expect(t('language.label')).toBe('Language');
		expect(t('settings.title')).toBe(at(de, 'settings.title'));
		expect(t('no.such.key')).toBe('no.such.key');
		// Documents for German bookkeeping stay German.
		expect(tDocument('language.label')).toBe('Sprache');
		expect(intlLocale()).toBe('en-GB');
	});

	it('starts in the stored choice, else the browser’s language, else English – German until English is complete', () => {
		expect(initialLocale({ stored: 'en', languages: ['de-DE'], ready: false })).toBe('de');
		expect(initialLocale({ stored: 'en', languages: ['de-DE'], ready: true })).toBe('en');
		expect(initialLocale({ stored: null, languages: ['de-AT', 'en'], ready: true })).toBe('de');
		expect(initialLocale({ stored: null, languages: ['fr-FR', 'en-US'], ready: true })).toBe('en');
		expect(initialLocale({ stored: 'xx', languages: ['fr-FR'], ready: true })).toBe('en');
	});

	it('amounts and dates follow the language; documents stay German', () => {
		expect(formatMoney(143976)).toBe('1.439,76 EUR');
		expect(formatDate('2026-08-31')).toBe('31.08.2026');
		setLocale('en');
		expect(formatMoney(143976)).toBe('EUR 1,439.76');
		expect(formatDate('2026-08-31')).toBe('31/08/2026');
		expect(formatMoney(143976, 'EUR', DOCUMENT_LOCALE)).toBe('1.439,76 EUR');
		expect(formatDate('2026-08-31', DOCUMENT_LOCALE)).toBe('31.08.2026');
	});
});
