// The web app's two standing rules about what the page may run (AGENTS.md,
// "Web app"; #535, audit plan #209):
//   - no `{@html}` anywhere – not "none with third-party input": none, so
//     nobody has to judge where a string came from;
//   - a Content-Security-Policy without `unsafe-eval` and without inline or
//     foreign scripts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import { cspDirectives } from '../../csp.js';
import { CREDITS_URL } from './credits/credits.js';
import Qr from './Qr.svelte';

const SRC = fileURLToPath(new URL('..', import.meta.url));
/** @param {string} dir @returns {string[]} */
const filesIn = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? filesIn(path) : [path];
	});

describe('no raw HTML', () => {
	it('no component renders `{@html}`, and none switches the lint rule off', () => {
		const found = filesIn(SRC)
			.filter((file) => /\.svelte$/.test(file))
			.filter((file) => {
				// Without comments: Qr.svelte's own says why there is none.
				const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) =>
					/eslint-disable/.test(c) ? c : ''
				);
				return /\{@html\b|no-at-html-tags/.test(text);
			})
			.map((file) => relative(SRC, file));
		expect(found).toEqual([]);
	});

	it('nothing runs text as code: no eval, no Function from a string, no script made by hand', () => {
		const found = filesIn(SRC)
			.filter((file) => /\.(js|svelte)$/.test(file) && !/\.spec\.js$/.test(file))
			.filter((file) =>
				/\beval\s*\(|\bnew Function\s*\(|createElement\(\s*['"]script['"]\s*\)|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(
					readFileSync(file, 'utf8')
				)
			)
			.map((file) => relative(SRC, file));
		expect(found).toEqual([]);
	});

	it('a QR code of a hostile text is squares and nothing else', () => {
		const hostile = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
		const { body } = render(Qr, { props: { text: hostile } });
		const markup = body.replace(/<!--.*?-->/g, '');
		expect(markup).toMatch(
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+" shape-rendering="crispEdges"><rect fill="white" width="\d+" height="\d+"><\/rect><path fill="black" d="(M\d+,\d+h1v1h-1z)+"><\/path><\/svg>$/
		);
		expect(markup).not.toContain('script');
		expect(markup).not.toContain('onerror');
	});
});

describe('the Content-Security-Policy', () => {
	const policy = cspDirectives();

	it('lets no script run but the app’s own files', () => {
		expect(policy['default-src']).toEqual(['none']);
		expect(policy['script-src']).toEqual(['self', 'wasm-unsafe-eval']);
		expect(policy['object-src']).toEqual(['none']);
		expect(policy['base-uri']).toEqual(['self']);
		expect(policy['form-action']).toEqual(['none']);
		// Nowhere: code from a string, or anything inline but a style attribute.
		for (const [directive, sources] of Object.entries(policy)) {
			expect(sources, directive).not.toContain('unsafe-eval');
			if (directive !== 'style-src-attr') expect(sources, directive).not.toContain('unsafe-inline');
			expect(sources, directive).not.toContain('*');
		}
		// Scripts, styles, fonts and workers come from nowhere else – no scheme, no host.
		for (const directive of ['script-src', 'style-src', 'font-src', 'worker-src']) {
			expect(policy[directive].filter((s) => /[:.]/.test(s))).toEqual([]);
		}
	});

	it('frames the payment page of Le Space Credits and nothing else; this machine only in a test build', () => {
		expect(policy['frame-src']).toEqual([CREDITS_URL]);
		expect(cspDirectives({ e2e: true })['frame-src']).toEqual([CREDITS_URL, 'http://127.0.0.1:*']);
	});

	it('connects in the clear to this machine only', () => {
		const clear = policy['connect-src'].filter((s) => /^(http|ws):/.test(s));
		expect(clear.every((s) => /^(http|ws):\/\/(127\.0\.0\.1|localhost):\*$/.test(s))).toBe(true);
	});
});
