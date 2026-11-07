// SPDX-License-Identifier: AGPL-3.0-or-later
// The same scenario in Node and in Chromium, compared (Le-Space/eigenbeleg-agent#6).
//
// A scenario is a module whose default export is an async function that
// returns something JSON can carry. `sameInChromium` runs it in Node, then
// bundles it with Vite for a browser (the `browser` export condition, no
// polyfills) and runs it in Chromium through Playwright; the two results
// must be deep-equal. A `node:` import or a Node built-in anywhere in the
// bundle fails the build, a `Buffer` or `process` the page.
//
// Chromium for Playwright: `pnpm exec playwright install chromium` once. In
// CI (`CI` set) a missing browser fails the test; elsewhere it is skipped.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTINS = new Set(builtinModules);

/** Refuses Node built-ins: a package that needs one does not run in a browser. */
const noNodeBuiltins = {
	name: 'le-space:no-node-builtins',
	enforce: /** @type {const} */ ('pre'),
	/** @param {string} id @param {string | undefined} importer */
	resolveId(id, importer) {
		if (id.startsWith('node:') || BUILTINS.has(id) || BUILTINS.has(id.split('/')[0]))
			throw new Error(`a Node-only import in a browser build: '${id}' from ${importer}`);
		return null;
	}
};

/** @param {string} dir */
function serve(dir) {
	/** @type {Record<string, string>} */
	const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
	const server = createServer(async (req, res) => {
		const path = normalize(
			join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
		);
		if (!path.startsWith(dir)) return void res.writeHead(403).end();
		try {
			const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
			res
				.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
				.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	return /** @type {Promise<{ url: string, close: () => void }>} */ (
		new Promise((resolve) =>
			server.listen(0, '127.0.0.1', () =>
				resolve({
					url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`,
					close: () => server.close()
				})
			)
		)
	);
}

/**
 * Bundles the scenario for a browser and runs it in Chromium.
 *
 * @param {URL} scenario
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ result: unknown } | { skipped: string }>}
 */
export async function runInChromium(scenario, { timeoutMs = 60_000 } = {}) {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch().catch((/** @type {Error} */ e) => {
		if (process.env.CI) throw e;
		return null;
	});
	if (!browser)
		return { skipped: 'no Chromium for Playwright (pnpm exec playwright install chromium)' };
	const { build } = await import('vite');
	// The real path: Vite resolves symlinks (macOS: /var → /private/var).
	const root = await realpath(await mkdtemp(join(tmpdir(), 'le-space-browser-')));
	/** @type {{ url: string, close: () => void } | undefined} */
	let site;
	try {
		await writeFile(
			join(root, 'index.html'),
			'<!doctype html><meta charset="utf-8"><title>scenario</title><script type="module" src="./entry.js"></script>'
		);
		await writeFile(
			join(root, 'entry.js'),
			[
				`import run from ${JSON.stringify(fileURLToPath(scenario))};`,
				'Promise.resolve().then(run).then(',
				'  (r) => (window.result = { ok: JSON.parse(JSON.stringify(r ?? null)) }),',
				'  (e) => (window.result = { error: String(e?.stack ?? e) })',
				');'
			].join('\n')
		);
		await build({
			root,
			base: './',
			logLevel: 'silent',
			configFile: false,
			plugins: [noNodeBuiltins],
			build: { outDir: join(root, 'dist'), emptyOutDir: true, minify: false, target: 'es2022' }
		});
		site = await serve(join(root, 'dist'));
		const page = await browser.newPage();
		/** @type {string[]} */
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.goto(`${site.url}index.html`);
		await page.waitForFunction(() => /** @type {any} */ (window).result, null, {
			timeout: timeoutMs
		});
		const out = await page.evaluate(() => /** @type {any} */ (window).result);
		assert.deepEqual(errors, [], 'the page threw');
		if (out.error) throw new Error(`in Chromium: ${out.error}`);
		return { result: out.ok };
	} finally {
		await browser.close();
		site?.close();
		await rm(root, { recursive: true, force: true });
	}
}

/**
 * Bundles modules for a browser as `runInChromium` does (Vite, the `browser`
 * condition, no Node built-ins) and returns the code: what a web app that
 * imports them would ship. Everything they export is kept, the default too.
 * With `treeshake: false` every module they import is in it whole: the
 * module graph, as a dev server or a bundler that cannot shake loads it.
 *
 * @param {string[]} modules absolute paths or file URLs
 * @param {{ treeshake?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function bundleForBrowser(modules, { treeshake = true } = {}) {
	const { build } = await import('vite');
	const root = await realpath(await mkdtemp(join(tmpdir(), 'le-space-bundle-')));
	try {
		const entry = join(root, 'entry.js');
		const paths = modules.map((m) => (m.startsWith('file:') ? fileURLToPath(m) : m));
		await writeFile(
			entry,
			[
				...paths.map((p, i) => `import * as m${i} from ${JSON.stringify(p)};`),
				`export { ${paths.map((_, i) => `m${i}`).join(', ')} };`
			].join('\n')
		);
		const out = await build({
			root,
			logLevel: 'silent',
			configFile: false,
			plugins: [noNodeBuiltins],
			build: {
				write: false,
				minify: false,
				target: 'es2022',
				lib: { entry, formats: ['es'], fileName: 'bundle' },
				rollupOptions: { treeshake }
			}
		});
		const results = /** @type {any[]} */ (Array.isArray(out) ? out : [out]);
		return results
			.flatMap((r) => r.output)
			.map((/** @type {any} */ c) => (c.type === 'chunk' ? c.code : String(c.source)))
			.join('\n');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/**
 * Runs the scenario in Node and in Chromium; both must give the same.
 *
 * @param {import('node:test').TestContext} t
 * @param {URL} scenario a module whose default export is an async function
 */
export async function sameInChromium(t, scenario) {
	const { default: run } = await import(scenario.href);
	const inNode = JSON.parse(JSON.stringify((await run()) ?? null));
	const browser = await runInChromium(scenario);
	if ('skipped' in browser) return t.skip(browser.skipped);
	assert.deepEqual(browser.result, inNode);
	return inNode;
}
