// The portal connector with a real Chromium (Playwright, headless) against the
// fake Kundenportal: login by recipe, a code and a bot check handed to the
// "user", the session across runs, the invoice list (the portal's JSON API
// with the page's own headers, else the page), downloads and the PDF check,
// an expired session, one run at a time, logout, and the endpoints.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPortalManager, buildRecipes, isPdf } from '../src/portals/index.js';
import { RECIPES, parseRow, validateDefinition } from '../src/portals/index.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import {
	CUSTOMER_NUMBER,
	FAKE_API_KEY,
	FAKE_PORTAL_PASSWORD,
	FAKE_PORTAL_USER,
	sampleInvoices,
	startFakePortal
} from './support/fake-portal.js';
import { makePdf } from './support/synthetic-pdf.js';
import { request } from './support/http.js';

const CREDS = { username: FAKE_PORTAL_USER, password: FAKE_PORTAL_PASSWORD };
const thisMonth = new Date().toISOString().slice(0, 7);
const longAgo = '2000-01';

describe('the Vodafone recipe on its own', () => {
	const def = RECIPES.vodafone;

	test('reads one row of an invoice list', () => {
		assert.deepEqual(
			parseRow(
				def.dom.fields,
				'Rechnung September 2026\nRechnungsdatum\n03.09.2026\nRechnungsnummer\nVK-202609-4711\nRechnungsbetrag\n1.039,99 €'
			),
			{
				date: '2026-09-03',
				period: '2026-09',
				amountCents: 103999,
				invoiceNumber: 'VK-202609-4711'
			}
		);
		assert.deepEqual(parseRow(def.dom.fields, 'Ihre Rechnung vom 01.03.2026 über 19,90 EUR'), {
			date: '2026-03-01',
			period: '2026-03',
			amountCents: 1990,
			invoiceNumber: null
		});
	});

	test('is data: steps, selectors and rules in one JSON file, marked unverified', () => {
		assert.equal(def.verified, false);
		assert.deepEqual(JSON.parse(JSON.stringify(def)), def, 'JSON through and through');
		assert.deepEqual(def.strategies, ['api', 'dom']);
		assert.match(
			'Rechnung herunterladen',
			new RegExp(def.dom.downloadText.re, def.dom.downloadText.flags)
		);
		for (const key of ['username', 'password', 'submit', 'otp', 'captcha', 'loggedIn']) {
			assert.ok(def.selectors[key].length > 0, key);
		}
		// The password step is marked, so neither the log nor a later recorder keeps it.
		const secret = def.login.filter((s) => s.secret);
		assert.deepEqual(
			secret.map((s) => s.value),
			['$password']
		);
		assert.match(buildRecipes({}).vodafone.version, /unverified/);
	});

	test('a recipe the engine cannot run is refused, with the place', () => {
		const broken = structuredClone(def);
		broken.login = broken.login.map((s) => ({ ...s, secret: false }));
		assert.throws(() => validateDefinition(broken), /must be secret/);
		assert.throws(() => validateDefinition({ ...def, baseUrl: 'http://www.vodafone.de' }), /https/);
		assert.throws(
			() => validateDefinition({ ...def, login: [{ do: 'type', target: 'username' }] }),
			/login\[0\]\.do/
		);
		assert.throws(
			() => validateDefinition({ ...def, login: [{ do: 'fill', target: 'nothing' }] }),
			/login\[0\]\.target/
		);
	});

	test('a PDF is a PDF by its bytes', () => {
		assert.equal(isPdf(makePdf(['x'])), true);
		assert.equal(isPdf(Buffer.from('<!doctype html><title>Fehler</title>')), false);
		assert.equal(isPdf(Buffer.from('%PDF')), false);
	});

	test('a base URL other than loopback is ignored', () => {
		assert.equal(
			buildRecipes({ vodafone: { baseUrl: 'https://evil.example' } }).vodafone.loginUrl,
			'https://www.vodafone.de/meinvodafone/account/login'
		);
		assert.equal(
			buildRecipes({ vodafone: { baseUrl: 'http://127.0.0.1:9' } }).vodafone.loginUrl,
			'http://127.0.0.1:9/meinvodafone/account/login'
		);
	});
});

describe('portal manager with Chromium against the fake portal', () => {
	/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
	/** @type {string} */ let dir;
	/** @type {string[]} */ const logs = [];

	/**
	 * @param {{ creds?: typeof CREDS | null, onUserNeeded?: any, loginTimeoutMs?: number }} [o]
	 */
	const manager = ({ creds = CREDS, onUserNeeded, loginTimeoutMs } = {}) =>
		createPortalManager({
			recipes: buildRecipes({ vodafone: { baseUrl: portal.url } }),
			dir,
			credentials: async () => creds,
			headless: 'always',
			onUserNeeded,
			loginTimeoutMs,
			log: (l) => logs.push(l)
		});

	before(async () => {
		portal = await startFakePortal();
		dir = await mkdtemp(join(tmpdir(), 'belege-portals-'));
	});
	after(async () => {
		await portal?.close();
		await rm(dir, { recursive: true, force: true });
	});

	test('never logged in: listed as never, and a fetch asks for a login first', async () => {
		const m = manager();
		const [p] = await m.list();
		assert.equal(p.id, 'vodafone');
		assert.equal(p.name, 'Vodafone MeinKabel');
		assert.equal(p.state, 'never');
		await assert.rejects(m.fetch('vodafone', { since: longAgo }), { code: 'PORTAL_NEEDS_LOGIN' });
		await assert.rejects(m.login('nope'), { code: 'PORTAL_UNKNOWN' });
	});

	test('login by recipe with stored credentials: cookies rejected, "Angemeldet bleiben" ticked', async () => {
		const m = manager();
		const result = await m.login('vodafone');
		assert.equal(result.state, 'logged-in');
		assert.deepEqual(portal.state.logins, [{ usernameOk: true, passwordOk: true, remember: true }]);
		assert.deepEqual(portal.state.consent, ['necessary'], 'only the necessary cookies');
		assert.equal((await m.list())[0].state, 'logged-in');
		const mode = (await stat(join(dir, 'vodafone', 'profile'))).mode & 0o777;
		assert.equal(mode, 0o700);
		assert.equal((await stat(join(dir, 'vodafone'))).mode & 0o777, 0o700);
	});

	test('the session persists: a second run lists and downloads without logging in', async () => {
		const m = manager({ creds: null });
		const result = await m.fetch('vodafone', { since: longAgo });
		assert.equal(portal.state.logins.length, 1, 'no second login');
		assert.equal(result.invoices.length, 3);
		assert.deepEqual(result.errors, []);
		const expected = sampleInvoices();
		assert.deepEqual(
			result.invoices.map((i) => [i.id, i.date, i.period, i.invoiceNumber, i.amountCents]),
			expected.map((e) => [
				e.number,
				e.date,
				e.date.slice(0, 7),
				e.number,
				Math.round(Number(e.gross.replace(',', '.')) * 100)
			])
		);
		const bytes = await m.invoice('vodafone', expected[0].number);
		assert.equal(isPdf(bytes), true);
		assert.equal(bytes.length, result.invoices[0].size);
		assert.match(result.invoices[0].sha256, /^[0-9a-f]{64}$/);
		await assert.rejects(m.invoice('vodafone', 'VK-NOT-THERE'), { code: 'PORTAL_UNKNOWN_INVOICE' });
		const [p] = await m.list();
		assert.equal(p.lastRun?.ok, true);
		assert.equal(p.lastRun?.count, 3);
		// Listed through the portal's API, with the headers the page itself sent.
		assert.ok(logs.includes('portal vodafone: strategy api: 3 invoice(s)'));
		const calls = portal.state.apiCalls.map((c) => [
			c.path.replace(/\/(DOC|EVN)-.*/, '/…'),
			c.authorized
		]);
		assert.ok(calls.some(([path, ok]) => path.endsWith('/invoice') && ok));
		assert.ok(
			calls.every(([, ok]) => ok),
			'every API call carried the session'
		);
		assert.ok(
			portal.state.apiCalls.every((c) => !c.path.includes('EVN-')),
			'the invoice document, not the call list'
		);
	});

	test('without the API the page is read instead: same invoices', async () => {
		portal.setApi(false);
		try {
			const before = logs.length;
			const result = await manager({ creds: null }).fetch('vodafone', { since: longAgo });
			assert.deepEqual(
				result.invoices.map((i) => [i.id, i.date, i.amountCents]),
				sampleInvoices().map((e) => [
					e.number,
					e.date,
					Math.round(Number(e.gross.replace(',', '.')) * 100)
				])
			);
			const lines = logs.slice(before);
			assert.ok(lines.includes('portal vodafone: strategy api unavailable (no api headers seen)'));
			assert.ok(lines.includes('portal vodafone: strategy dom: 3 invoice(s)'));
		} finally {
			portal.setApi(true);
		}
	});

	test('since and known: only the months asked for, and nothing twice', async () => {
		const m = manager({ creds: null });
		const before = portal.state.downloads;
		const recent = await m.fetch('vodafone', { since: thisMonth });
		assert.equal(recent.invoices.length, 1);
		const known = sampleInvoices().map((i) => i.number);
		const again = await m.fetch('vodafone', { since: longAgo, known });
		assert.equal(again.invoices.length, 0);
		assert.equal(again.skipped, 3);
		assert.equal(portal.state.downloads, before + 1, 'known invoices are not downloaded');
	});

	test('a download that is not a PDF is refused, the others still come', async () => {
		const list = sampleInvoices();
		list[1] = { ...list[1], body: '<!doctype html><p>Wartungsarbeiten</p>' };
		portal.setInvoices(list);
		try {
			const result = await manager({ creds: null }).fetch('vodafone', { since: longAgo });
			assert.deepEqual(result.errors, [{ id: list[1].number, code: 'PORTAL_NOT_PDF' }]);
			assert.equal(result.invoices.length, 2);
		} finally {
			portal.setInvoices(sampleInvoices());
		}
	});

	test('an expired session without a password is detected: needs-login', async () => {
		portal.expireSessions();
		const m = manager({ creds: null });
		await assert.rejects(m.fetch('vodafone', { since: longAgo }), {
			code: 'PORTAL_NEEDS_LOGIN',
			reason: 'expired'
		});
		assert.equal((await m.list())[0].state, 'needs-login');
	});

	test('an expired session with a password is renewed headless', async () => {
		const logins = portal.state.logins.length;
		const result = await manager().fetch('vodafone', { since: thisMonth });
		assert.equal(result.invoices.length, 1);
		assert.equal(portal.state.logins.length, logins + 1);
	});

	test('a one-time code is never typed by the bridge: headless it needs the user', async () => {
		portal.expireSessions();
		portal.setOtp('246810');
		try {
			await assert.rejects(manager().fetch('vodafone', { since: longAgo }), {
				code: 'PORTAL_NEEDS_LOGIN',
				reason: 'otp'
			});
		} finally {
			portal.setOtp(null);
		}
	});

	test('login with a one-time code: the bridge fills the password, the user types the code', async () => {
		portal.expireSessions();
		portal.setOtp('246810');
		/** @type {string[]} */
		const reasons = [];
		try {
			const m = manager({
				onUserNeeded: async (/** @type {any} */ { reason, page }) => {
					reasons.push(reason);
					// What the person does in the window.
					await page.getByLabel('Sicherheitscode').fill('246810');
					await page.getByRole('button', { name: 'Bestätigen' }).click();
				}
			});
			const result = await m.login('vodafone');
			assert.equal(result.state, 'logged-in');
			assert.deepEqual(reasons, ['otp']);
		} finally {
			portal.setOtp(null);
		}
	});

	test('a bot check is left to the user: the bridge fills nothing', async () => {
		portal.expireSessions();
		portal.setCaptcha(true);
		const logins = portal.state.logins.length;
		/** @type {string[]} */
		const reasons = [];
		try {
			const m = manager({
				onUserNeeded: async (/** @type {any} */ { reason, page }) => {
					reasons.push(reason);
					assert.equal(portal.state.logins.length, logins, 'the recipe did not submit');
					assert.equal(await page.getByLabel(/Benutzername/).inputValue(), '');
					await page.getByLabel(/Benutzername/).fill(FAKE_PORTAL_USER);
					await page.getByLabel('Passwort').fill(FAKE_PORTAL_PASSWORD);
					await page.getByLabel('Ich bin kein Roboter').check();
					await page.getByRole('button', { name: 'Anmelden' }).click();
				}
			});
			assert.equal((await m.login('vodafone')).state, 'logged-in');
			assert.deepEqual(reasons, ['captcha']);
		} finally {
			portal.setCaptcha(false);
		}
	});

	test('a login nobody completes times out; one can be cancelled', async () => {
		portal.expireSessions();
		await assert.rejects(manager({ creds: null, loginTimeoutMs: 1500 }).login('vodafone'), {
			code: 'PORTAL_LOGIN_TIMEOUT'
		});
		const m = manager({ creds: null });
		const waiting = m.login('vodafone');
		await new Promise((r) => setTimeout(r, 1500));
		assert.deepEqual(m.cancel('vodafone'), { cancelled: true });
		await assert.rejects(waiting, { code: 'PORTAL_CANCELLED' });
	});

	test('one run at a time per portal', async () => {
		const m = manager({ creds: null });
		const waiting = m.login('vodafone');
		await new Promise((r) => setTimeout(r, 300));
		assert.equal((await m.list())[0].running, 'login');
		await assert.rejects(m.fetch('vodafone', { since: longAgo }), { code: 'PORTAL_BUSY' });
		await assert.rejects(m.logout('vodafone'), { code: 'PORTAL_BUSY' });
		m.cancel('vodafone');
		await assert.rejects(waiting, { code: 'PORTAL_CANCELLED' });
	});

	test('logout ends the session on the portal and deletes the profile', async () => {
		const m = manager();
		await m.login('vodafone');
		const logouts = portal.state.logouts;
		assert.deepEqual(await m.logout('vodafone'), { state: 'never' });
		assert.equal(portal.state.logouts, logouts + 1);
		await assert.rejects(stat(join(dir, 'vodafone')), { code: 'ENOENT' });
		assert.equal((await m.list())[0].state, 'never');
	});

	test('the log names steps and counts, never the password or page content', () => {
		assert.ok(logs.length > 5);
		const all = logs.join('\n');
		for (const secret of [
			FAKE_PORTAL_PASSWORD,
			FAKE_PORTAL_USER,
			CUSTOMER_NUMBER,
			'Wartungsarbeiten',
			'Bearer',
			FAKE_API_KEY
		]) {
			assert.equal(all.includes(secret), false, secret);
		}
	});
});

describe('portal endpoints', () => {
	const APP = 'http://localhost:5173';
	/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string} */ let dir;
	/** @type {string} */ let token;
	/** @type {string[]} */ const printed = [];
	/** @type {string[]} */ const logs = [];
	/** @type {string[]} */ const bodies = [];

	before(async () => {
		portal = await startFakePortal();
		dir = await mkdtemp(join(tmpdir(), 'belege-portal-api-'));
		const configPath = join(dir, 'bridge.json');
		await saveConfig(
			{
				...defaultConfig(),
				appOrigins: [APP],
				portals: {
					vodafone: { username: FAKE_PORTAL_USER, passwordStored: true, baseUrl: portal.url }
				}
			},
			configPath
		);
		const keychain = memoryKeychain(FAKE_PORTAL_PASSWORD);
		bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			portalKeychain: () => keychain,
			portalHeadless: 'always',
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logs.push(l)
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
		await portal?.close();
		await rm(dir, { recursive: true, force: true });
	});

	/** @param {string} path @param {{ method?: string, body?: unknown, auth?: boolean }} [o] */
	async function call(path, { method = 'GET', body, auth = true } = {}) {
		const res = await request(bridge.address.port, path, {
			method,
			body,
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) }
		});
		bodies.push(res.text);
		return res;
	}

	test('every portal endpoint needs the token', async () => {
		for (const [method, path] of [
			['GET', '/portals'],
			['POST', '/portals/vodafone/login'],
			['POST', '/portals/vodafone/cancel'],
			['POST', `/portals/vodafone/fetch?since=${longAgo}`],
			['GET', '/portals/vodafone/invoice?ref=X'],
			['POST', '/portals/vodafone/logout']
		]) {
			const res = await call(path, { method, auth: false });
			assert.equal(res.status, 401, `${method} ${path}`);
		}
		assert.equal(portal.state.requests.length, 0, 'nothing reached the portal');
	});

	test('list → login → fetch → invoice bytes → logout', async () => {
		const list = await call('/portals');
		assert.equal(list.status, 200);
		assert.equal(list.json.portals[0].state, 'never');

		const early = await call(`/portals/vodafone/fetch?since=${longAgo}`, { method: 'POST' });
		assert.equal(early.status, 409);
		assert.equal(early.json.code, 'PORTAL_NEEDS_LOGIN');

		const login = await call('/portals/vodafone/login', { method: 'POST' });
		assert.equal(login.status, 200, login.text);
		assert.equal(login.json.state, 'logged-in');

		const fetched = await call(`/portals/vodafone/fetch?since=${longAgo}`, {
			method: 'POST',
			body: { known: [sampleInvoices()[2].number] }
		});
		assert.equal(fetched.status, 200, fetched.text);
		assert.equal(fetched.json.invoices.length, 2);
		assert.equal(fetched.json.skipped, 1);

		const id = fetched.json.invoices[0].id;
		const res = await request(bridge.address.port, `/portals/vodafone/invoice?ref=${id}`, {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.equal(res.status, 200);
		assert.equal(res.headers['content-type'], 'application/pdf');
		assert.match(res.text, /^%PDF-/);

		const out = await call('/portals/vodafone/logout', { method: 'POST' });
		assert.equal(out.json.state, 'never');
		assert.equal((await call('/portals')).json.portals[0].state, 'never');
	});

	test('bad parameters are refused before a browser starts', async () => {
		const before = portal.state.requests.length;
		for (const [method, path, status] of [
			['POST', '/portals/vodafone/fetch', 400],
			['POST', '/portals/vodafone/fetch?since=2026-13', 400],
			['POST', '/portals/vodafone/fetch?since=09.2026', 400],
			['GET', '/portals/vodafone/invoice?ref=../../etc', 400],
			['GET', '/portals/vodafone/fetch?since=2026-01', 405],
			['POST', '/portals/other/login', 404],
			['POST', '/portals/Vodafone%2F..%2Fx/login', 404]
		]) {
			const res = await call(/** @type {string} */ (path), {
				method: /** @type {string} */ (method)
			});
			assert.equal(res.status, status, `${method} ${path}`);
		}
		assert.equal(portal.state.requests.length, before);
	});

	test('health says portals are there; no response or log carries the password or page content', async () => {
		const health = await call('/health', { auth: false });
		assert.equal(health.json.portals.available, true);
		const everything = [...bodies, ...logs, ...printed].join('\n');
		for (const secret of [FAKE_PORTAL_PASSWORD, CUSTOMER_NUMBER]) {
			assert.equal(everything.includes(secret), false, secret);
		}
	});
});
