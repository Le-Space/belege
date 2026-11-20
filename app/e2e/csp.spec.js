// The Content-Security-Policy is in every built page and the browser holds
// the page to it (#535, audit plan #209): an inline script does not run,
// `eval` throws, a script from another host is not loaded – while the app's
// own start script, named by its hash, runs.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { acceptConsent } from './consent.js';

/** @param {string} html @returns {Record<string, string[]>} the policy of a page, by directive */
function policyOf(html) {
	const meta = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"/i.exec(html);
	expect(meta, 'the page carries a policy').not.toBeNull();
	return Object.fromEntries(
		String(meta?.[1])
			.split(';')
			.map((part) => part.trim().split(/\s+/))
			.map(([directive, ...sources]) => [directive, sources])
	);
}

test('every built page carries the policy, with the hash of its start script', async () => {
	// The files as they are published: the start page and the fallback every
	// other route is served from. (`vite preview` renders the fallback itself
	// and sends the policy as a header; a gateway serves these files.)
	for (const file of ['index.html', '200.html']) {
		const policy = policyOf(readFileSync(new URL(`../build/${file}`, import.meta.url), 'utf8'));
		expect(policy['default-src'], file).toEqual(["'none'"]);
		const [self, wasm, ...hashes] = policy['script-src'];
		expect([self, wasm], file).toEqual(["'self'", "'wasm-unsafe-eval'"]);
		expect(hashes.length, file).toBeGreaterThan(0);
		for (const hash of hashes) expect(hash, file).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
		expect(policy['object-src'], file).toEqual(["'none'"]);
		expect(policy['base-uri'], file).toEqual(["'self'"]);
		expect(policy['form-action'], file).toEqual(["'none'"]);
	}
	// The English entry is a static page with one script of its own.
	const entry = readFileSync(new URL('../build/en/index.html', import.meta.url), 'utf8');
	expect(policyOf(entry)).toEqual({
		'default-src': ["'none'"],
		'script-src': ["'self'"],
		'base-uri': ["'none'"],
		'form-action': ["'none'"]
	});
	expect(entry).not.toMatch(/<script>|<script(?![^>]*\bsrc=)/);
});

test('the English entry still opens the app in English', async ({ page }) => {
	await page.goto('/en/');
	await expect(page).toHaveURL(/\/$/);
	expect(await page.evaluate(() => localStorage.getItem('belege.locale'))).toBe('en');
});

test('the theme script, a file now, still sets the theme before the app starts', async ({
	page
}) => {
	await page.addInitScript(() => localStorage.setItem('belege.theme', 'dark'));
	await page.goto('/');
	await expect(page.locator('html')).toHaveClass(/\bdark\b/);
	await page.addInitScript(() => localStorage.setItem('belege.theme', 'light'));
	await page.reload();
	await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});

test('the browser holds the page to it', async ({ page }) => {
	/** @type {string[]} */
	const refused = [];
	await page.exposeFunction('noteViolation', (/** @type {string} */ v) => refused.push(v));
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) =>
			/** @type {any} */ (window).noteViolation(`${e.effectiveDirective} ${e.blockedURI}`)
		);
	});
	await page.goto('/');
	// The app's own start script ran: the page is there.
	await acceptConsent(page);
	await expect(page.getByTestId('passkey-label')).toBeVisible();

	const tried = await page.evaluate(async () => {
		/** @type {Record<string, unknown>} */
		const out = {};
		// An inline script, as injected markup would bring one.
		const inline = document.createElement('script');
		inline.textContent = 'window.__inlineRan = true';
		document.head.append(inline);
		out.inlineRan = /** @type {any} */ (window).__inlineRan === true;
		// Text run as code. From a timer: code a test evaluates directly is let
		// off the policy by the browser's debugging protocol.
		out.eval = await new Promise((resolve) =>
			setTimeout(() => {
				try {
					(0, eval)('1');
					resolve('ran');
				} catch (e) {
					resolve(/** @type {Error} */ (e).name);
				}
			}, 0)
		);
		// A script from another host.
		out.foreign = await new Promise((resolve) => {
			const foreign = document.createElement('script');
			foreign.src = 'https://example.com/x.js';
			foreign.onload = () => resolve('loaded');
			foreign.onerror = () => resolve('refused');
			document.head.append(foreign);
		});
		// An event handler in markup.
		const div = document.createElement('div');
		div.setAttribute('onclick', 'window.__handlerRan = true');
		document.body.append(div);
		div.click();
		out.handlerRan = /** @type {any} */ (window).__handlerRan === true;
		return out;
	});
	expect(tried).toEqual({
		inlineRan: false,
		eval: 'EvalError',
		foreign: 'refused',
		handlerRan: false
	});
	await expect
		.poll(() => refused.filter((v) => /^script-src/.test(v)).length)
		.toBeGreaterThanOrEqual(3);
});
