// The Content-Security-Policy is in every built page and the browser holds
// the page to it (#535, audit plan #209): an inline script does not run,
// `eval` throws, a script from another host is not loaded – while the app's
// own start script, named by its hash, runs. With Trusted Types, text cannot
// even be written into a script, a handler or markup without a named policy.
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
		// An inline script, as injected markup would bring one. Trusted Types
		// refuse the text before the script element is even in the page.
		const inline = document.createElement('script');
		try {
			inline.textContent = 'window.__inlineRan = true';
			document.head.append(inline);
			out.inlineText = 'taken';
		} catch (e) {
			out.inlineText = /** @type {Error} */ (e).name;
		}
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
		// A script from another host. Trusted Types refuse the URL itself; were
		// it taken, script-src would refuse to load it.
		out.foreign = await new Promise((resolve) => {
			const foreign = document.createElement('script');
			try {
				foreign.src = 'https://example.com/x.js';
			} catch (e) {
				resolve(/** @type {Error} */ (e).name);
				return;
			}
			foreign.onload = () => resolve('loaded');
			foreign.onerror = () => resolve('refused');
			document.head.append(foreign);
		});
		// An event handler in markup.
		const div = document.createElement('div');
		try {
			div.setAttribute('onclick', 'window.__handlerRan = true');
			out.handlerText = 'taken';
		} catch (e) {
			out.handlerText = /** @type {Error} */ (e).name;
		}
		document.body.append(div);
		div.click();
		out.handlerRan = /** @type {any} */ (window).__handlerRan === true;
		return out;
	});
	expect(tried).toEqual({
		inlineText: 'TypeError',
		inlineRan: false,
		eval: 'EvalError',
		foreign: 'TypeError',
		handlerText: 'TypeError',
		handlerRan: false
	});
	// Each attempt was reported, by Trusted Types or by script-src.
	await expect
		.poll(() => refused.filter((v) => /^(script-src|require-trusted-types-for)/.test(v)).length)
		.toBeGreaterThanOrEqual(4);
});

test('markup and parsing take only values a named policy made', async ({ page }) => {
	/** @type {string[]} */
	const refused = [];
	await page.exposeFunction('noteTrustedTypes', (/** @type {string} */ v) => refused.push(v));
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) => {
			if (e.effectiveDirective.includes('trusted-types')) {
				/** @type {any} */ (window).noteTrustedTypes(`${e.effectiveDirective} ${e.sample}`);
			}
		});
	});
	await page.goto('/');
	// The app itself starts and renders under the rule: Svelte's templates go
	// through its own policy.
	await acceptConsent(page);
	await expect(page.getByTestId('passkey-label')).toBeVisible();
	// A library's probe whether `eval` is allowed, `new Function('')`, is
	// refused here first; script-src would refuse it anyway (no 'unsafe-eval'),
	// and the probe expects that. Anything else would be a sink the app uses.
	expect(
		refused.filter((v) => !/^require-trusted-types-for Function\|/.test(v)),
		'the app made no value the rule refuses'
	).toEqual([]);

	// From a timer, as in the test above: the page's own code, not the debugger's.
	const tried = await page.evaluate(
		() =>
			new Promise((resolve) =>
				setTimeout(() => {
					/** @param {() => void} attempt */
					const outcome = (attempt) => {
						try {
							attempt();
							return 'taken';
						} catch (e) {
							return /** @type {Error} */ (e).name;
						}
					};
					resolve({
						// Text from outside, written into the page as markup.
						innerHTML: outcome(() => {
							document.createElement('div').innerHTML = '<img src=x onerror="1">';
						}),
						// Parsed as a document without the policy for XML.
						parse: outcome(() => {
							new DOMParser().parseFromString('<a/>', 'application/xml');
						}),
						// A policy the page does not name.
						policy: outcome(() => {
							/** @type {any} */ (window).trustedTypes.createPolicy('other', {
								createHTML: (/** @type {string} */ s) => s
							});
						})
					});
				}, 0)
			)
	);
	expect(tried).toEqual({ innerHTML: 'TypeError', parse: 'TypeError', policy: 'TypeError' });
});
