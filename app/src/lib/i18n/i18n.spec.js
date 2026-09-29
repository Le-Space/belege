import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import de from './de.js';
import en from './en.js';
import {
	DOCUMENT_LOCALE,
	currentLocale,
	initialLocale,
	intlLocale,
	keysOf,
	has,
	missingInEnglish,
	setLocale,
	t,
	tDocument
} from './index.js';
import { formatDate, formatMoney } from '../bank/format.js';
import { formatQuantity } from '../assets/quantity.js';
import { looksGerman } from '../../../eslint/no-german.js';
import { formatRate, quantityText } from '../assets/valuation.js';

/** @param {any} catalogue @param {string} key */
const at = (catalogue, key) => key.split('.').reduce((n, k) => n?.[k], catalogue);
/** @param {unknown} text */
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the catalogues (#192)', () => {
	afterEach(() => setLocale('de'));

	it('English has every key German has, of the same kind and with the same placeholders', () => {
		const german = new Set(keysOf(/** @type {any} */ (de)));
		for (const key of keysOf(/** @type {any} */ (en))) {
			expect(german.has(key), key).toBe(true);
			const a = at(de, key);
			const b = at(en, key);
			expect(Array.isArray(b), key).toBe(Array.isArray(a));
			if (typeof a === 'string') expect(placeholders(b), key).toEqual(placeholders(a));
		}
		// Complete: the switch is offered.
		expect(missingInEnglish()).toEqual([]);
	});

	it('English is English: no German quotation marks left in it', () => {
		const german = keysOf(/** @type {any} */ (en)).filter((key) => /„/.test(String(at(en, key))));
		expect(german).toEqual([]);
	});

	it('switches at once; a key English lacks shows in German, never blank', () => {
		expect(currentLocale()).toBe('de');
		expect(t('language.label')).toBe('Sprache');
		setLocale('en');
		expect(t('language.label')).toBe('Language');
		expect(t('settings.title')).toBe(at(en, 'settings.title'));
		// A key English lacks (taken out for the test) shows in German.
		const title = at(en, 'settings.title');
		delete (/** @type {any} */ (en).settings.title);
		try {
			expect(t('settings.title')).toBe(at(de, 'settings.title'));
		} finally {
			/** @type {any} */ (en).settings.title = title;
		}
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

	it('crypto quantities and rates follow the language, every digit kept; documents stay German', () => {
		const nb = (/** @type {string} */ s) => s.replace(/\u00a0/g, ' ');
		const tx = { amountCents: 100, quantity: '-123456789012345678901', decimals: 18, asset: 'ETH' };
		expect(nb(formatQuantity('123456700000', 8, 'BTC'))).toBe('1.234,567 BTC');
		expect(formatRate('60123.4')).toBe('60.123,40');
		setLocale('en');
		expect(nb(formatQuantity('123456700000', 8, 'BTC'))).toBe('1,234.567 BTC');
		expect(nb(formatQuantity('1200', 2, 'EUR', { minFraction: 2 }))).toBe('12.00 EUR');
		expect(formatRate('60123.4')).toBe('60,123.40');
		expect(nb(quantityText(tx))).toBe('-123.456789012345678901 ETH');
		expect(nb(quantityText(tx, DOCUMENT_LOCALE))).toBe('-123,456789012345678901 ETH');
		expect(formatRate('60123.4', DOCUMENT_LOCALE)).toBe('60.123,40');
		expect(formatQuantity('123456700000', 8, '', { locale: DOCUMENT_LOCALE })).toBe('1.234,567');
	});

	it('every key the code names is in the German catalogue', () => {
		const root = new URL('../../', import.meta.url).pathname;
		/** @param {string} dir @returns {string[]} */
		const files = (dir) =>
			readdirSync(dir).flatMap((name) => {
				const path = join(dir, name);
				if (statSync(path).isDirectory()) return files(path);
				return /\.(js|svelte)$/.test(name) && !name.includes('.spec.') ? [path] : [];
			});
		/** @type {string[]} */
		const missing = [];
		for (const file of files(root)) {
			const text = readFileSync(file, 'utf8');
			for (const m of text.matchAll(/\b(?:t|tDocument|list)\(\s*'([a-zA-Z][\w.-]*\.[\w.-]+)'/g)) {
				if (!has(m[1])) missing.push(`${file.slice(root.length)}: ${m[1]}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('the lint guard sees German text, not the name or a kind', () => {
		for (const text of ['Kein Beleg nötig', 'Buchung ohne Betrag', '„{x}“', 'Fehler beim Laden'])
			expect(looksGerman(text), text).toBe(true);
		for (const text of ['Le Space Belege', 'Belege', 'rückfrage', 'No receipt needed', '“{x}”'])
			expect(looksGerman(text), text).toBe(false);
	});
});
