// "Neues Portal aufzeichnen" with a real Chromium (Playwright, headless)
// against a fake vendor the bridge ships no recipe for: a site on
// 127.0.0.1 and its invoice pages on another host (localhost), as a SaaS
// shows invoices on invoice.stripe.com. From a name and a start URL the
// bridge makes a local portal, the "user" logs in in the recording window
// and clicks to one invoice and downloads it; the other host must be
// confirmed before the recipe is saved (local-<slug>.json, 0600), the
// recorded invoice is handed out, the portal is listed as the user's own,
// a later fetch replays the route (and logs in with stored credentials),
// a host that was not confirmed is never visited, and "Portal entfernen"
// deletes recipe and profile.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	buildRecipes,
	checkName,
	checkStart,
	createPortalManager,
	isPdf,
	localId,
	validateOverride
} from '../src/portals/index.js';
import { parseLooseRow } from '../src/portals/recipe.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import {
	VENDOR_CUSTOMER,
	VENDOR_PASSWORD,
	VENDOR_USER,
	startFakeVendor
} from './support/fake-vendor.js';
import { request } from './support/http.js';

const longAgo = '2000-01';
const ID = 'local-beispiel-cloud';

describe('a new portal: name, start page, id', () => {
	test('the id is local- and a slug; a taken one gets -2, -3', () => {
		const none = new Set();
		assert.equal(localId('Anthropic', 'claude.ai', none), 'local-anthropic');
		assert.equal(localId('Müller & Söhne GmbH', 'x.de', none), 'local-muller-sohne-gmbh');
		assert.equal(localId('Straße', 'x.de', none), 'local-strasse');
		assert.equal(localId('!!!', 'www.claude.ai', none), 'local-claude-ai');
		const taken = new Set(['local-anthropic', 'local-anthropic-2']);
		assert.equal(localId('Anthropic', 'claude.ai', taken), 'local-anthropic-3');
		// A bundled id never collides: they have no prefix.
		assert.equal(localId('vodafone', 'vodafone.de', new Set(['vodafone'])), 'local-vodafone');
		const long = localId('Ein sehr langer Name für einen Anbieter mit Portal', 'x.de', none);
		assert.ok(long.length <= 37 && /^local-[a-z0-9-]+[a-z0-9]$/.test(long), long);
	});

	test('the name is one plain line; the start page https, without query, user or long numbers', () => {
		assert.equal(checkName('  Anthropic \n PBC '), 'Anthropic PBC');
		for (const bad of ['', 'x'.repeat(61), 'rechnung@anthropic.com', 'Kunde 1234567', 42]) {
			assert.throws(() => checkName(bad), { code: 'PORTAL_NEW_INVALID', reason: 'name' });
		}
		assert.deepEqual(checkStart('https://claude.ai'), {
			baseUrl: 'https://claude.ai',
			start: '/',
			host: 'claude.ai'
		});
		assert.deepEqual(checkStart('https://claude.ai/settings/billing?token=abc#x'), {
			baseUrl: 'https://claude.ai',
			start: '/settings/billing',
			host: 'claude.ai'
		});
		for (const bad of [
			'http://claude.ai',
			'claude.ai',
			'https://user:pw@claude.ai',
			'https://claude.ai:8443/',
			'https://claude.ai/kunde/1234567',
			'javascript:alert(1)',
			'http://127.0.0.1:8080/'
		]) {
			assert.throws(() => checkStart(bad), { code: 'PORTAL_NEW_INVALID', reason: 'url' }, bad);
		}
		assert.equal(
			checkStart('http://127.0.0.1:8080/x', { allowLoopback: true }).baseUrl,
			'http://127.0.0.1:8080'
		);
	});

	test('dates and amounts in German and English formats', () => {
		assert.deepEqual(
			parseLooseRow('Invoice number ABCD-0001 · Paid September 3, 2026 · Amount paid $20.00'),
			{ date: '2026-09-03', period: '2026-09', amountCents: 2000, invoiceNumber: 'ABCD-0001' }
		);
		assert.deepEqual(parseLooseRow('Rechnung vom 03.09.2026 · Betrag 1.039,99 €'), {
			date: '2026-09-03',
			period: '2026-09',
			amountCents: 103999,
			invoiceNumber: null
		});
		assert.equal(parseLooseRow('3. März 2026, 12,50 EUR').date, '2026-03-03');
		assert.equal(parseLooseRow('Abrechnung Juli 2026').period, '2026-07');
	});

	test('a local recipe has a local block; a route host must be one of allowedHosts', () => {
		const patch = {
			id: 'local-x',
			version: 'local+rec.2026-09-25',
			verified: false,
			local: { name: 'X', baseUrl: 'https://x.example', start: '/' },
			allowedHosts: ['invoice.stripe.com'],
			route: [
				{ do: 'click', target: { role: 'link', name: { re: '^Billing$', flags: 'i' } } },
				{
					do: 'click',
					target: { role: 'button', name: { re: '^Download$', flags: 'i' } },
					host: 'invoice.stripe.com'
				}
			],
			dom: { downloadControls: [{ role: 'button', name: { re: '^PDF$', flags: 'i' } }] }
		};
		assert.equal(validateOverride(structuredClone(patch), 'local-x').id, 'local-x');
		/** @param {(p: any) => void} change */
		const refused = (change) => {
			const p = structuredClone(patch);
			change(p);
			try {
				validateOverride(p, p.id);
			} catch (/** @type {any} */ error) {
				return error.step;
			}
			assert.fail('accepted');
		};
		assert.equal(
			refused((p) => (p.allowedHosts = [])),
			'route[1]'
		);
		assert.equal(
			refused((p) => delete p.local),
			'local'
		);
		assert.equal(
			refused((p) => (p.id = 'vodafone')),
			'local'
		);
		assert.equal(
			refused((p) => (p.local.name = 'kunde@example.test')),
			'local.name'
		);
		assert.equal(
			refused((p) => (p.local.baseUrl = 'http://x.example')),
			'local'
		);
		assert.equal(
			refused((p) => (p.allowedHosts = ['https://evil.example/'])),
			'allowedHosts'
		);
		assert.equal(
			refused((p) => (p.local.name = 'Kunde 1234567')),
			'local.name'
		);
	});
});

describe('recording a new portal with Chromium against the fake vendor', () => {
	/** @type {Awaited<ReturnType<typeof startFakeVendor>>} */ let vendor;
	/** @type {string} */ let dir;
	/** @type {string} */ let recipesDir;
	/** @type {string[]} */ const logs = [];
	/** @type {import('playwright').Page | null} */ let window = null;
	/** @type {{ username: string, password: string } | null} */ let creds = null;

	const recipes = () => buildRecipes({}, { recipesDir, allowLoopback: true });
	const manager = () =>
		createPortalManager({
			recipes: recipes(),
			dir: join(dir, 'portals'),
			recipesDir,
			rebuild: (id) => recipes()[id],
			credentials: async () => creds,
			headless: 'always',
			allowLoopback: true,
			onUserNeeded: ({ reason, page }) => {
				if (reason === 'record') window = page;
			},
			log: (l) => logs.push(l)
		});
	/** @type {ReturnType<typeof manager>} */ let m;
	/** @type {any} */ let saved;

	before(async () => {
		vendor = await startFakeVendor();
		dir = await mkdtemp(join(tmpdir(), 'belege-new-portal-'));
		recipesDir = join(dir, 'recipes');
		m = manager();
	});
	after(async () => {
		m?.close();
		await vendor?.close();
		await rm(dir, { recursive: true, force: true });
	});

	test('the user logs in in the window and clicks to one invoice on another host', async () => {
		const started = await m.recordNew({ name: 'Beispiel Cloud', startUrl: `${vendor.url}/` });
		assert.deepEqual(started, { id: ID, recording: true });
		const listed = (await m.list()).find((p) => p.id === ID);
		assert.equal(listed?.source, 'local');
		assert.equal(listed?.pending, true);
		assert.equal(listed?.running, 'record');
		const page = /** @type {import('playwright').Page} */ (window);

		// Before the login: a click on the public start page, dropped when the login page comes.
		await page.getByRole('link', { name: 'Anmelden' }).click();
		await page.waitForURL(/\/login$/);
		await page.getByRole('button', { name: 'Passwort anzeigen' }).click();
		await page.getByLabel('E-Mail').fill(VENDOR_USER);
		await page.getByLabel('Passwort', { exact: true }).fill(VENDOR_PASSWORD);
		await page.getByRole('button', { name: 'Anmelden' }).click();
		await page.waitForURL(`${vendor.url}/`);

		// Logged in: to the invoices, which open in a new window on the invoice host.
		await page.getByRole('link', { name: 'Einstellungen' }).click();
		await page.waitForURL(/\/settings$/);
		await page.getByRole('tab', { name: 'Abrechnung' }).click();
		await page.waitForURL(/\/settings\/billing$/);
		const [invoicePage] = await Promise.all([
			page.context().waitForEvent('page'),
			page.getByRole('link', { name: 'Rechnung ansehen' }).first().click()
		]);
		await invoicePage.waitForLoadState('domcontentloaded');
		await Promise.all([
			invoicePage.waitForEvent('download'),
			invoicePage.getByRole('button', { name: 'Rechnung herunterladen' }).click()
		]);

		const r = await m.recordStop(ID);
		assert.equal(r.download, true);
		assert.equal(r.invoice, true, 'the downloaded invoice is kept');
		assert.deepEqual(r.hosts, ['localhost']);
		assert.ok(r.pausedOnLogin >= 2, 'the clicks on the login page are not recorded');
		assert.deepEqual(
			r.steps.filter((s) => s.kind === 'click'),
			[
				{ kind: 'click', role: 'link', label: 'Einstellungen', download: false, usable: true },
				{ kind: 'click', role: 'tab', label: 'Abrechnung', download: false, usable: true },
				{ kind: 'click', role: 'link', label: 'Rechnung ansehen', download: false, usable: true },
				{
					kind: 'click',
					role: 'button',
					label: 'Rechnung herunterladen',
					download: true,
					usable: true,
					host: 'localhost'
				}
			]
		);
		assert.ok(r.steps.some((s) => s.kind === 'page' && s.host === 'localhost'));
		const text = JSON.stringify(r);
		for (const secret of [VENDOR_USER, VENDOR_PASSWORD, VENDOR_CUSTOMER, ...vendor.tokens]) {
			assert.equal(text.includes(secret), false, secret);
		}
	});

	test('the other host must be confirmed before it is saved', async () => {
		await assert.rejects(m.recordSave(ID), {
			code: 'PORTAL_HOSTS_UNCONFIRMED',
			step: 'localhost'
		});
		await assert.rejects(m.recordSave(ID, { hosts: ['evil.example'] }), {
			code: 'PORTAL_HOSTS_UNCONFIRMED'
		});
		saved = await m.recordSave(ID, { hosts: ['localhost'] });
		assert.equal(saved.saved, true);
		assert.equal(saved.route, 3);
		assert.deepEqual(saved.allowedHosts, ['localhost']);
	});

	test('saved as local-<slug>.json (0600); the recorded invoice is handed out', async () => {
		const file = join(recipesDir, `${ID}.json`);
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		const text = await readFile(file, 'utf8');
		const patch = JSON.parse(text);
		assert.deepEqual(patch.local, { name: 'Beispiel Cloud', baseUrl: vendor.url, start: '/' });
		assert.deepEqual(patch.allowedHosts, ['localhost']);
		assert.deepEqual(
			patch.route.map((/** @type {any} */ s) => s.target.name.re),
			['^Einstellungen$', '^Abrechnung$', '^Rechnung ansehen$']
		);
		assert.deepEqual(patch.dom.downloadControls, [
			{ role: 'button', name: { re: '^Rechnung herunterladen$', flags: 'i' } }
		]);
		for (const secret of [VENDOR_USER, VENDOR_PASSWORD, VENDOR_CUSTOMER, ...vendor.tokens]) {
			assert.equal(text.includes(secret), false, secret);
		}
		assert.equal(saved.invoices.length, 1);
		const [inv] = saved.invoices;
		assert.match(inv.id, /^recorded-[0-9a-f]{12}$/);
		const bytes = await m.invoice(ID, inv.id);
		assert.equal(isPdf(bytes), true);
		assert.equal(bytes.length, inv.size);
		assert.deepEqual(m.recipeExport(ID), patch);

		const p = (await m.list()).find((x) => x.id === ID);
		assert.equal(p?.name, 'Beispiel Cloud');
		assert.equal(p?.source, 'local');
		assert.equal(p?.pending, false);
		assert.equal(p?.recorded, true);
		assert.equal(p?.state, 'logged-in', 'the window was logged in');
	});

	test('a fresh bridge lists it and fetches by the route, on the confirmed host', async () => {
		const fresh = manager();
		assert.ok((await fresh.list()).some((p) => p.id === ID && p.source === 'local'));
		const before = vendor.state.invoiceRequests.length;
		const result = await fresh.fetch(ID, { since: longAgo });
		assert.deepEqual(result.errors, []);
		assert.equal(result.invoices.length, 1, 'the route opens the newest invoice');
		const [inv] = result.invoices;
		assert.equal(inv.date, '2026-09-03');
		assert.equal(inv.amountCents, 2000);
		assert.equal(inv.invoiceNumber, 'BC-2026-0903');
		assert.equal(isPdf(await fresh.invoice(ID, inv.id)), true);
		assert.ok(
			vendor.state.invoiceRequests.slice(before).some((r) => /^GET \/i\/[0-9a-f]+\/pdf$/.test(r))
		);
	});

	test('a host that was not confirmed is never visited by the replay', async () => {
		const file = join(recipesDir, `${ID}.json`);
		const original = await readFile(file, 'utf8');
		try {
			await writeFile(file, JSON.stringify({ ...JSON.parse(original), allowedHosts: [] }));
			const before = vendor.state.invoiceRequests.length;
			const result = await manager().fetch(ID, { since: longAgo });
			assert.deepEqual(result.invoices, []);
			assert.deepEqual(
				vendor.state.invoiceRequests.slice(before),
				[],
				'no request reached the invoice host'
			);
		} finally {
			await writeFile(file, original, { mode: 0o600 });
		}
	});

	test('an expired session is logged in with stored credentials when a password field is shown', async () => {
		vendor.expireSessions();
		vendor.setPublicHome(false);
		creds = { username: VENDOR_USER, password: VENDOR_PASSWORD };
		try {
			const logins = vendor.state.logins.length;
			const result = await manager().fetch(ID, { since: longAgo });
			assert.equal(result.invoices.length, 1);
			assert.deepEqual(vendor.state.logins.slice(logins), [{ usernameOk: true, passwordOk: true }]);
		} finally {
			creds = null;
		}
	});

	test("without a password field the login is the user's: needs-login", async () => {
		vendor.expireSessions();
		vendor.setPublicHome(true);
		creds = { username: VENDOR_USER, password: VENDOR_PASSWORD };
		try {
			const logins = vendor.state.logins.length;
			await assert.rejects(manager().fetch(ID, { since: longAgo }), {
				code: 'PORTAL_NEEDS_LOGIN'
			});
			assert.equal(vendor.state.logins.length, logins, 'no form was filled');
		} finally {
			creds = null;
		}
	});

	test('the same name again gets -2; discarded before it was saved, it is gone', async () => {
		const again = await m.recordNew({ name: 'Beispiel Cloud', startUrl: vendor.url });
		assert.equal(again.id, `${ID}-2`);
		assert.deepEqual(await m.recordDiscard(again.id), { discarded: true });
		assert.equal(
			(await m.list()).some((p) => p.id === again.id),
			false
		);
		await assert.rejects(stat(join(dir, 'portals', again.id)), { code: 'ENOENT' });
		await assert.rejects(m.recordNew({ name: 'X', startUrl: 'http://evil.example/' }), {
			code: 'PORTAL_NEW_INVALID'
		});
	});

	test('Portal entfernen: recipe file and profile deleted; a bundled portal cannot be removed', async () => {
		await assert.rejects(m.remove('vodafone'), { code: 'PORTAL_NOT_LOCAL' });
		assert.ok(await stat(join(dir, 'portals', ID)));
		assert.deepEqual(await m.remove(ID), { removed: true });
		await assert.rejects(stat(join(recipesDir, `${ID}.json`)), { code: 'ENOENT' });
		await assert.rejects(stat(join(dir, 'portals', ID)), { code: 'ENOENT' });
		assert.equal(
			(await m.list()).some((p) => p.id === ID),
			false
		);
		assert.equal(recipes()[ID], undefined);
	});

	test('a loopback start page counts in tests only; the log has no value, no page content', async () => {
		await writeFile(
			join(recipesDir, 'local-loop.json'),
			JSON.stringify({
				id: 'local-loop',
				version: 'local+rec.2026-09-25',
				verified: false,
				local: { name: 'Loop', baseUrl: vendor.url, start: '/' },
				route: [],
				dom: { downloadControls: [{ role: 'button', name: { re: '^PDF$', flags: 'i' } }] }
			})
		);
		/** @type {string[]} */
		const lines = [];
		assert.equal(
			buildRecipes({}, { recipesDir, log: (l) => lines.push(l) })['local-loop'],
			undefined
		);
		assert.deepEqual(lines, [
			'portal local-loop: local recipe ignored (PORTAL_RECIPE_REJECTED at local.baseUrl)'
		]);
		assert.ok(recipes()['local-loop']);
		const all = logs.join('\n');
		for (const secret of [VENDOR_USER, VENDOR_PASSWORD, VENDOR_CUSTOMER, ...vendor.tokens]) {
			assert.equal(all.includes(secret), false, secret);
		}
	});
});

describe('new portal endpoints', () => {
	const APP = 'http://localhost:5173';
	/** @type {Awaited<ReturnType<typeof startFakeVendor>>} */ let vendor;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string} */ let dir;
	/** @type {string} */ let token;
	/** @type {string[]} */ const printed = [];

	before(async () => {
		vendor = await startFakeVendor();
		dir = await mkdtemp(join(tmpdir(), 'belege-new-portal-api-'));
		const configPath = join(dir, 'bridge.json');
		await saveConfig({ ...defaultConfig(), appOrigins: [APP] }, configPath);
		bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			portalKeychain: () => memoryKeychain(null),
			portalPasswordDialog: async () => null,
			portalHeadless: 'always',
			portalLoopback: true,
			port: 0,
			print: (l) => printed.push(l),
			log: () => {}
		});
		const code = printed.map((l) => /Pairing code[^:]*: (\S+)/.exec(l)?.[1]).find(Boolean);
		token = (
			await request(bridge.address.port, '/pair', {
				method: 'POST',
				headers: { origin: APP },
				body: { code }
			})
		).json.token;
	});
	after(async () => {
		await bridge?.close();
		await vendor?.close();
		await rm(dir, { recursive: true, force: true });
	});

	/** @param {string} path @param {{ method?: string, auth?: boolean, body?: unknown }} [o] */
	const call = (path, { method = 'POST', auth = true, body } = {}) =>
		request(bridge.address.port, path, {
			method,
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
			body
		});

	test('need the token; a bad name or start page is refused before any window opens', async () => {
		assert.equal((await call('/portals/new', { auth: false, body: {} })).status, 401);
		assert.equal((await call('/portals/new', { method: 'GET' })).status, 405);
		const bad = await call('/portals/new', { body: { name: 'X', startUrl: 'ftp://x.example' } });
		assert.equal(bad.status, 400);
		assert.equal(bad.json.code, 'PORTAL_NEW_INVALID');
		assert.equal(bad.json.reason, 'url');
		assert.equal(vendor.state.requests.length, 0);
		assert.equal((await call('/portals/vodafone/remove')).json.code, 'PORTAL_NOT_LOCAL');
	});

	test('new → listed as local and pending → stop → save refused without a download → discard: gone', async () => {
		const started = await call('/portals/new', {
			body: { name: 'Beispiel Cloud', startUrl: `${vendor.url}/` }
		});
		assert.equal(started.status, 200, started.text);
		assert.deepEqual(started.json, { id: ID, recording: true });
		const list = await call('/portals', { method: 'GET' });
		const p = list.json.portals.find((/** @type {any} */ x) => x.id === ID);
		assert.equal(p.source, 'local');
		assert.equal(p.pending, true);
		assert.equal(p.name, 'Beispiel Cloud');
		assert.equal(p.host, new URL(vendor.url).host);
		const stop = await call(`/portals/${ID}/record/stop`);
		assert.equal(stop.status, 200);
		assert.deepEqual(stop.json.hosts, []);
		const save = await call(`/portals/${ID}/record/save`, { body: { hosts: [] } });
		assert.equal(save.json.code, 'PORTAL_RECORDING_NO_DOWNLOAD');
		assert.deepEqual((await call(`/portals/${ID}/record/discard`)).json, { discarded: true });
		const after = await call('/portals', { method: 'GET' });
		assert.equal(
			after.json.portals.some((/** @type {any} */ x) => x.id === ID),
			false
		);
	});
});
