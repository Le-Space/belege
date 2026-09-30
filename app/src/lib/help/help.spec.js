import { describe, expect, it } from 'vitest';

import de from '../i18n/de.js';
import en from '../i18n/en.js';
import { INTEGRATION_HELP, helpDoc } from './integration-help.js';
import { noteWayOut, wayOutKind, wayOutOf } from './way-out.js';

/** @param {any} catalogue @param {string} key */
const at = (catalogue, key) => key.split('.').reduce((n, k) => n?.[k], catalogue);

describe('a way out beside an error (#200, step 4)', () => {
	it('knows the kind from the bridge’s answer', () => {
		expect(wayOutKind(0, null)).toBe('unreachable');
		expect(wayOutKind(401, {})).toBe('unknown-device');
		expect(wayOutKind(403, { error: 'origin not allowed' })).toBe('origin');
		expect(wayOutKind(403, { error: 'wrong code' })).toBeNull();
		expect(wayOutKind(503, { code: 'MAIL_NOT_SET_UP' })).toBe('mail');
		expect(wayOutKind(503, { code: 'LLM_NOT_SET_UP' })).toBe('llm');
		expect(wayOutKind(503, { error: 'Hibiscus is not set up: run setup:hibiscus.' })).toBe(
			'hibiscus'
		);
		expect(wayOutKind(503, { error: 'Kraken is not set up: run `pnpm setup:kraken`.' })).toBe(
			'kraken'
		);
		expect(wayOutKind(500, { error: 'boom' })).toBeNull();
	});

	it('a noted message gets its command and page; any other message none', () => {
		noteWayOut('Die Bridge ist nicht erreichbar.', 'unreachable');
		noteWayOut('Etwas anderes', null);
		expect(wayOutOf('Die Bridge ist nicht erreichbar.')).toEqual({
			kind: 'unreachable',
			command: 'pnpm bridge',
			href: '/integrationen/bridge'
		});
		expect(wayOutOf('Etwas anderes')).toBeNull();
		expect(wayOutOf(null)).toBeNull();
	});

	it('every way out has its text in both languages, and a link text where it has a page', () => {
		for (const kind of [
			'unreachable',
			'unknown-device',
			'origin',
			'mail',
			'llm',
			'hibiscus',
			'kraken'
		]) {
			noteWayOut(`m-${kind}`, /** @type {any} */ (kind));
			const way = wayOutOf(`m-${kind}`);
			for (const catalogue of [de, en]) {
				expect(at(catalogue, `help.wayOut.${kind}`), kind).toBeTruthy();
				if (way?.href) expect(at(catalogue, `help.wayOutLink.${kind}`), kind).toBeTruthy();
			}
		}
	});
});

describe('help on an integration’s page (#200, step 4)', () => {
	it('every integration has what and how in both languages', () => {
		for (const id of Object.keys(INTEGRATION_HELP)) {
			for (const catalogue of [de, en]) {
				expect(at(catalogue, `integrationen.help.${id}.what`), id).toBeTruthy();
				expect(at(catalogue, `integrationen.help.${id}.how`), id).toBeTruthy();
			}
		}
	});

	it('links the German twin of a doc where there is one', () => {
		expect(helpDoc('ki', 'en')).toBe('https://github.com/Le-Space/belege/blob/main/docs/ai.md');
		expect(helpDoc('ki', 'de')).toBe('https://github.com/Le-Space/belege/blob/main/docs/ai.de.md');
		expect(helpDoc('wallets', 'en')).toMatch(/docs\/crypto\.md#own-wallets$/);
		expect(helpDoc('wallets', 'de')).toMatch(/docs\/crypto\.de\.md$/);
		expect(helpDoc('bridge', 'de')).toMatch(/bridge\/README\.md$/);
		expect(helpDoc('nope', 'de')).toBeNull();
	});
});
