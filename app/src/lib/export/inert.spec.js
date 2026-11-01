import { describe, expect, it } from 'vitest';
import { inert } from './inert.js';
import { text } from './datev.js';

describe('inert: text a spreadsheet would take for a formula', () => {
	it('gets an apostrophe in front, wherever a cell starts with = + - @ tab or CR', () => {
		for (const s of ['=1+1', '+49 30 1234', '-1+1', '-A1', '@SUM(A1)', '\t=1', '\r=1']) {
			expect(inert(s)).toBe(`'${s}`);
		}
		// A plain number is no formula: amounts keep their sign.
		for (const s of ['-39,99', '+12', '1.234,56', '-0,01']) expect(inert(s)).toBe(s);
		expect(inert('Beispiel GmbH')).toBe('Beispiel GmbH');
		expect(inert('')).toBe('');
	});

	it('in the DATEV text fields too', () => {
		expect(text('=HYPERLINK("https://example.invalid";"Rechnung")')).toBe(
			`"'=HYPERLINK(""https://example.invalid"";""Rechnung"")"`
		);
		expect(text('Stromwerk Abschlag')).toBe('"Stromwerk Abschlag"');
	});
});
