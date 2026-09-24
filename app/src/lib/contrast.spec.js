// Every token pair the app sets text in, in both themes, against WCAG AA
// (4.5:1 for normal text). Read from app.css itself, so a changed token is a
// failing test rather than a page somebody cannot read. The brand's own light
// values miss AA in places (see app.css); this is what keeps them out of text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** @param {string} selector */
function tokens(selector) {
	const start = css.indexOf(`${selector} {`);
	const block = css.slice(start, css.indexOf('}', start));
	/** @type {Record<string, string>} */
	const out = {};
	for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
		out[name] = value;
	}
	return out;
}

/** @param {string} hex */
function luminance(hex) {
	const channel = (/** @type {number} */ i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** @param {string} a @param {string} b */
function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['heading', 'text', 'faint', 'link', 'danger', 'success'];
const GROUNDS = ['bg', 'surface', 'surface-2'];

describe.each([
	['light', tokens(':root')],
	['dark', tokens('.dark')]
])('text contrast, %s theme', (_theme, palette) => {
	for (const fg of TEXT) {
		for (const bg of GROUNDS) {
			it(`${fg} on ${bg} is at least 4.5:1`, () => {
				expect(palette[fg], fg).toMatch(/^#/);
				expect(palette[bg], bg).toMatch(/^#/);
				expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
			});
		}
	}
});

describe('fixed pairs', () => {
	const theme = css.slice(css.indexOf('@theme inline'));
	/** @param {string} name */
	const scale = (name) => {
		const match = theme.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
		return match?.[1] ?? '';
	};
	it.each([
		['white on the coral button', '#ffffff', scale('coral-700')],
		['white on the coral button, hovered', '#ffffff', scale('coral-800')],
		['white on the chosen filter', '#ffffff', scale('cyan-800')],
		['the active tab on the page', scale('cyan-800'), tokens(':root').bg],
		['the "Technisch" tag', scale('infra-800'), scale('infra-200')],
		['the "geplant" chip', scale('data-800'), scale('data-100')]
	])('%s is at least 4.5:1', (_name, fg, bg) => {
		expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
	});
});
