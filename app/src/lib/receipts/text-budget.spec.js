// The head and tail of a receipt's text that is too long (#975). Made-up text only.
import { describe, expect, it } from 'vitest';

import { MAX_TEXT, OMITTED, fitText } from './text-budget.js';

const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s).length;

describe('fitText', () => {
	it('a text that fits goes whole', () => {
		expect(fitText('Wolkenfabrik Hosting GmbH', { maxBytes: 1000 })).toEqual({
			text: 'Wolkenfabrik Hosting GmbH',
			shortened: false
		});
	});

	it('too many bytes: head and tail within the budget, the marker between', () => {
		const text = `ANFANG ${'Position 12,34 EUR\n'.repeat(5000)} ENDE`;
		const { text: out, shortened } = fitText(text, { maxBytes: 10_000 });
		expect(shortened).toBe(true);
		expect(bytes(out)).toBeLessThanOrEqual(10_000);
		expect(out.startsWith('ANFANG')).toBe(true);
		expect(out.endsWith('ENDE')).toBe(true);
		expect(out).toContain(OMITTED);
		// Two thirds for the head.
		expect(out.indexOf(OMITTED)).toBeGreaterThan(out.length / 2);
	});

	it('too many characters: at most MAX_TEXT, however many bytes are free', () => {
		const text = 'x'.repeat(MAX_TEXT * 2);
		const { text: out } = fitText(text, { maxBytes: 10 * 1024 * 1024 });
		expect(out.length).toBeLessThanOrEqual(MAX_TEXT);
	});

	it('counts bytes, not characters, and cuts no character in half', () => {
		const text = `${'Ä'.repeat(20_000)}😀${'Ö'.repeat(20_000)}`;
		const { text: out } = fitText(text, { maxBytes: 30_001 });
		expect(bytes(out)).toBeLessThanOrEqual(30_001);
		expect(out).not.toMatch(
			/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
		);
	});
});
