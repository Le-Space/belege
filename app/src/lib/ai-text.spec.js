// The AI hints say "geschwärzt" only when the bridge blacks out (#431).
import { describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ llmRedaction: /** @type {boolean | 'enclave' | null} */ (null) }));
vi.mock('./session.svelte.js', () => ({ app }));

const { aiText } = await import('./ai-text.js');
const { default: de } = await import('./i18n/de.js');
const { default: en } = await import('./i18n/en.js');

const KEYS = [
	'ai.extract',
	'ai.upload',
	'ai.import',
	'ai.portal',
	'zahlungen.detail.linkTransferAiTitle',
	'zahlungen.detail.aiChoiceTitle',
	'zahlungen.detail.aiSearchTitle',
	'vendorAccount.explainTitle',
	'rueckfragen.ai.what'
];

/** @param {any} catalogue @param {string} key */
const at = (catalogue, key) => key.split('.').reduce((o, k) => o?.[k], catalogue);

describe('aiText', () => {
	it('says "geschwärzt" while the bridge blacks out, or nobody knows', () => {
		for (const redaction of [true, null]) {
			app.llmRedaction = redaction;
			expect(aiText('ai.extract')).toContain('– geschwärzt, nie die Datei –');
		}
	});

	it('says the text stays on the computer for a model there', () => {
		app.llmRedaction = false;
		expect(aiText('ai.extract')).toContain('Ungeschwärzt, weil nichts den Rechner verlässt.');
		expect(aiText('rueckfragen.ai.what', { count: 3 })).toMatch(/^Für 3 Zahlungen/);
	});

	it('says only the verified enclave can read it, for a model in an attested enclave', () => {
		app.llmRedaction = 'enclave';
		expect(aiText('ai.extract')).toContain('in der attestierten Enklave');
		expect(aiText('ai.extract')).toContain(
			'Ungeschwärzt – lesen kann ihn nur die geprüfte Enklave.'
		);
		expect(aiText('ai.extract')).not.toContain('Rechner');
	});

	it('has an enclave twin for every hint, in both languages, that never says "on this computer"', () => {
		for (const catalogue of [de, en]) {
			for (const key of KEYS) {
				const enclave = at(catalogue, `${key}Enclave`);
				expect(typeof enclave, `${key}Enclave`).toBe('string');
				expect(enclave).not.toMatch(
					/(?<!un)geschwärzt|(?<!un)redacted|diesem Rechner|this computer/i
				);
			}
		}
	});

	it('has a local twin for every hint, in both languages, without "geschwärzt" claims', () => {
		for (const catalogue of [de, en]) {
			for (const key of KEYS) {
				const local = at(catalogue, `${key}Local`);
				expect(typeof local, `${key}Local`).toBe('string');
				expect(local).not.toMatch(/(?<!un)geschwärzt|(?<!un)redacted/i);
			}
		}
	});
});
