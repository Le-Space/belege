// The app's words, from one place (issue #192).
//
// Every string the interface shows comes from a catalogue: `de.js`, and
// `en.js` of the same shape. The language is state (locale.svelte.js), so a
// switch re-renders what is on screen; both catalogues are in the bundle, so
// it works offline. A key English does not have yet falls back to German,
// never to a blank; the switch is offered only once English is complete
// (`englishReady`). Kept smaller than Le-Space/simple-todo's svelte-i18n
// setup: a plain lookup has no store to initialise before the first render.
//
// Documents for German bookkeeping (Eigenbeleg, statements, the DATEV
// export) stay German whatever the app's language: they format with
// DOCUMENT_LOCALE and their own German texts.
import de from './de.js';
import en from './en.js';
import { locale } from './locale.svelte.js';

/** @typedef {string | string[] | { [key: string]: Catalogue }} Catalogue */
/** @typedef {import('./locale.svelte.js').Locale} Locale */

export const LOCALES = /** @type {const} */ (['de', 'en']);
export const LOCALE_KEY = 'belege.locale';
/** Numbers and dates in documents for German bookkeeping. */
export const DOCUMENT_LOCALE = 'de-DE';
/** @type {Record<Locale, Catalogue>} */
const catalogues = { de: /** @type {Catalogue} */ (de), en: /** @type {Catalogue} */ (en) };

/**
 * @param {Catalogue} catalogue
 * @param {string} key
 * @returns {Catalogue | undefined}
 */
function lookupIn(catalogue, key) {
	/** @type {any} */
	let node = catalogue;
	for (const part of key.split('.')) {
		if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
		node = node[part];
	}
	return node;
}

/** @param {string} key In the current language, else in German. */
function lookup(key) {
	const here = lookupIn(catalogues[locale.current], key);
	return here === undefined ? lookupIn(catalogues.de, key) : here;
}

/**
 * Every key of a catalogue (its strings and lists), dotted.
 *
 * @param {Catalogue} catalogue
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function keysOf(catalogue, prefix = '') {
	if (typeof catalogue === 'string' || Array.isArray(catalogue)) return [prefix];
	return Object.entries(catalogue).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

/** The German keys English does not have yet. */
export const missingInEnglish = () => {
	const have = new Set(keysOf(catalogues.en));
	return keysOf(catalogues.de).filter((k) => !have.has(k));
};

/** Whether English is complete, and so offered. */
export const englishReady = () => missingInEnglish().length === 0;

/** The language now. */
export const currentLocale = () => locale.current;

/** `Intl` locale of the interface: German, or British English (day first, 24 h). */
export const intlLocale = () => (locale.current === 'en' ? 'en-GB' : 'de-DE');

/** @param {unknown} v @returns {v is Locale} */
const isLocale = (v) => LOCALES.includes(/** @type {any} */ (v));

/**
 * The language to start in: a stored choice, else the browser's (`de-AT` is
 * German), else English – while English is not complete, German.
 *
 * @param {{ stored?: string | null, languages?: readonly string[], ready?: boolean }} [env]
 * @returns {Locale}
 */
export function initialLocale({
	stored = readStored(),
	languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
	ready = englishReady()
} = {}) {
	if (!ready) return 'de';
	if (isLocale(stored)) return stored;
	for (const tag of languages) {
		const primary = String(tag).toLowerCase().split('-')[0];
		if (isLocale(primary)) return primary;
	}
	return 'en';
}

function readStored() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCALE_KEY);
	} catch {
		return null;
	}
}

/**
 * Switch the language: at once on screen, kept in this browser, and on `<html lang>`.
 *
 * @param {Locale} next
 */
export function setLocale(next) {
	if (!isLocale(next)) return;
	locale.current = next;
	try {
		localStorage.setItem(LOCALE_KEY, next);
	} catch {
		// Blocked: this session only.
	}
	if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** At start: the initial language, without storing it. */
export function startLocale() {
	locale.current = initialLocale();
	if (typeof document !== 'undefined') document.documentElement.lang = locale.current;
}

/**
 * A sentence, with `{name}` placeholders filled in.
 *
 * A missing key shows as the key itself: visible, so a test or a reader finds
 * it, rather than an empty space nobody notices.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function t(key, values) {
	const text = lookup(key);
	if (typeof text !== 'string') return key;
	return values ? fill(text, values) : text;
}

/**
 * A sentence in German whatever the app's language: for documents German
 * bookkeeping needs in German (the export's overview, say).
 *
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 */
export function tDocument(key, values) {
	const text = lookupIn(catalogues.de, key);
	if (typeof text !== 'string') return key;
	return values ? fill(text, values) : text;
}

/** @param {string} text @param {Record<string, string | number>} values */
function fill(text, values) {
	return text.replace(/\{(\w+)\}/g, (match, name) =>
		name in values ? String(values[name]) : match
	);
}

/**
 * A list of sentences (the technical explanations are lists).
 *
 * @param {string} key
 * @returns {string[]}
 */
export function list(key) {
	const value = lookup(key);
	return Array.isArray(value) ? value : [];
}

/**
 * Whether the catalogue has this key; for tests.
 *
 * @param {string} key
 */
export function has(key) {
	return lookup(key) !== undefined;
}
