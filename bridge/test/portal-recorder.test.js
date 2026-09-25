// "Portal aufzeichnen" with a real Chromium (Playwright, headless) against the
// fake Kundenportal: the "user" clicks from the start page through "Mein
// Konto" and the "Dokumente" tab to a row and downloads one invoice with a
// button no recipe knows. The recording becomes a route (roles and names,
// digits as \d+), nothing typed and nothing on a password page is in it; it
// is refused with personal data, saved as a 0600 override, merged over the
// bundled recipe, and a later fetch replays it and downloads every invoice.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	RECIPES,
	buildRecipes,
	createPortalManager,
	describeTarget,
	isPdf,
	validateOverride
} from '../src/portals/index.js';
import { namePattern } from '../src/portals/recorder.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import {
	CUSTOMER_NUMBER,
	FAKE_PORTAL_PASSWORD,
	FAKE_PORTAL_USER,
	sampleInvoices,
	startFakePortal
} from './support/fake-portal.js';
import { request } from './support/http.js';

const CREDS = { username: FAKE_PORTAL_USER, password: FAKE_PORTAL_PASSWORD };
const TYPED = 'Geheimnotiz 4711 an kunde@example.test';
const longAgo = '2000-01';

/** A valid override, as the recorder writes one. */
const sampleOverride = () => ({
	id: 'vodafone',
	version: `${RECIPES.vodafone.version}+rec.2026-09-25`,
	verified: false,
	route: [
		{ do: 'click', target: { role: 'link', name: { re: '^Mein Konto$', flags: 'i' } } },
		{ do: 'click', target: { role: 'tab', name: { re: '^Dokumente$', flags: 'i' } } }
	],
	dom: { downloadControls: [{ role: 'button', name: { re: '^Beleg öffnen$', flags: 'i' } }] },
	recorded: {
		at: '2026-09-25T10:00:00.000Z',
		steps: [{ kind: 'click', role: 'link', label: 'Mein Konto', download: false, usable: true }]
	}
});

describe('recorded steps and the recipe they make', () => {
	test('a control becomes { role, name }, digits a \\d+ pattern, anchored', () => {
		assert.deepEqual(namePattern('Rechnung vom 01.07.2026'), {
			re: '^Rechnung vom \\d+\\.\\d+\\.\\d+$',
			flags: 'i'
		});
		const re = new RegExp(namePattern('Rechnung vom 01.07.2026').re, 'i');
		assert.match('Rechnung vom 03.11.2025', re);
		assert.doesNotMatch('Ihre Rechnung vom 03.11.2025 als PDF', re);
		assert.deepEqual(describeTarget({ role: 'link', name: '  Meine\n Rechnungen ' }), {
			role: 'link',
			label: 'Meine Rechnungen',
			target: { role: 'link', name: { re: '^Meine Rechnungen$', flags: 'i' } }
		});
		assert.equal(describeTarget({ role: 'button', name: 'Rechnung 4711' }).label, 'Rechnung #');
	});

	test('a name with an e-mail address or an IBAN is not used; a stable attribute is', () => {
		assert.deepEqual(
			describeTarget({
				role: 'link',
				name: 'kunde@example.test',
				attrs: { 'automation-id': 'profile_link' }
			}).target,
			{ css: '[automation-id="profile_link"]' }
		);
		assert.equal(
			describeTarget({ role: 'button', name: 'DE89 3704 0044 0532 0130 00' }).target,
			null
		);
		assert.deepEqual(describeTarget({ role: 'button', name: '', id: 'download-btn' }).target, {
			css: '#download-btn'
		});
		// An id or attribute with digits names a record, not a control.
		assert.equal(describeTarget({ role: 'button', name: '', id: 'row4711' }).target, null);
		assert.equal(
			describeTarget({ role: 'button', name: '', attrs: { 'data-testid': 'doc-900123' } }).target,
			null
		);
		// A role the recorder does not know is no role.
		assert.equal(describeTarget({ role: 'textbox', name: 'Suche' }).target, null);
	});

	test('an override with personal data or another shape is refused, saying where', () => {
		assert.equal(validateOverride(sampleOverride(), 'vodafone').id, 'vodafone');
		/** @param {(o: any) => void} change */
		const refused = (change) => {
			const o = sampleOverride();
			change(o);
			try {
				validateOverride(o, 'vodafone');
			} catch (/** @type {any} */ error) {
				assert.equal(error.code, 'PORTAL_RECIPE_REJECTED');
				return [error.step, error.reason];
			}
			assert.fail('accepted');
		};
		assert.deepEqual(
			refused((o) => (o.route[0].target.name.re = '^Vertrag 900123456$')),
			['route[0].target.name.re', 'digits']
		);
		assert.deepEqual(
			refused((o) => (o.recorded.steps[0].label = 'kunde@example.test')),
			['recorded.steps[0].label', 'email']
		);
		assert.deepEqual(
			refused(
				(o) => (o.dom.downloadControls[0] = { css: '[title="DE89 3704 0044 0532 0130 00"]' })
			),
			['dom.downloadControls[0].css', 'iban']
		);
		assert.deepEqual(
			refused((o) => (o.route[0] = { do: 'fill', target: { css: '#x' }, value: 'x' })),
			['route[0]', 'shape']
		);
		assert.deepEqual(
			refused((o) => (o.login = [])),
			['login', 'shape']
		);
		assert.deepEqual(
			refused((o) => (o.id = 'other')),
			['id', 'shape']
		);
	});

	test('a saved override is merged over the bundled recipe; a bad one is ignored', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'belege-recipes-'));
		try {
			await writeFile(join(dir, 'vodafone.json'), JSON.stringify(sampleOverride()));
			const recipe = buildRecipes({}, { recipesDir: dir }).vodafone;
			assert.deepEqual(recipe.definition.route, sampleOverride().route);
			assert.deepEqual(recipe.definition.dom.downloadControls, [
				{ role: 'button', name: { re: '^Beleg öffnen$', flags: 'i' } },
				...RECIPES.vodafone.dom.downloadControls
			]);
			assert.match(recipe.version, /\+rec\.2026-09-25 \(unverified\)$/);
			assert.deepEqual(recipe.definition.login, RECIPES.vodafone.login, 'the login is untouched');
			assert.equal(RECIPES.vodafone.route, undefined, 'the bundled recipe is unchanged');

			const bad = sampleOverride();
			bad.recorded.steps[0].label = 'Rechnung an kunde@example.test';
			await writeFile(join(dir, 'vodafone.json'), JSON.stringify(bad));
			/** @type {string[]} */
			const lines = [];
			const plain = buildRecipes({}, { recipesDir: dir, log: (l) => lines.push(l) }).vodafone;
			assert.equal(plain.definition.route, undefined);
			assert.deepEqual(lines, [
				'portal vodafone: recorded recipe ignored (PORTAL_RECIPE_REJECTED at recorded.steps[0].label)'
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('recording with Chromium against the fake portal', () => {
	/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
	/** @type {string} */ let dir;
	/** @type {string} */ let recipesDir;
	/** @type {string[]} */ const logs = [];
	/** @type {import('playwright').Page | null} */ let window = null;

	const recipes = () => buildRecipes({ vodafone: { baseUrl: portal.url } }, { recipesDir });
	const manager = () =>
		createPortalManager({
			recipes: recipes(),
			dir: join(dir, 'portals'),
			recipesDir,
			rebuild: (id) => recipes()[id],
			credentials: async () => CREDS,
			headless: 'always',
			onUserNeeded: ({ reason, page }) => {
				if (reason === 'record') window = page;
			},
			log: (l) => logs.push(l)
		});
	/** @type {ReturnType<typeof manager>} */ let m;

	before(async () => {
		portal = await startFakePortal();
		dir = await mkdtemp(join(tmpdir(), 'belege-recorder-'));
		recipesDir = join(dir, 'recipes');
		m = manager();
		assert.equal((await m.login('vodafone')).state, 'logged-in');
	});
	after(async () => {
		m?.close();
		await portal?.close();
		await rm(dir, { recursive: true, force: true });
	});

	test('the path to the invoices is recorded: clicks, not inputs, nothing on a password page', async () => {
		const [p] = await m.list();
		assert.equal(p.recordable, true);
		assert.equal(p.recorded, false);
		assert.deepEqual(await m.recordStart('vodafone'), { recording: true });
		assert.equal((await m.list())[0].running, 'record');
		await assert.rejects(m.fetch('vodafone', { since: longAgo }), { code: 'PORTAL_BUSY' });
		const page = /** @type {import('playwright').Page} */ (window);
		assert.ok(page, 'the window is open');

		// A detour to a page with a password field: nothing there is recorded.
		await page.goto(`${portal.url}/meinvodafone/services/konto/passwort`);
		await page.getByLabel('Neues Passwort').fill(FAKE_PORTAL_PASSWORD);
		await page.getByRole('button', { name: 'Speichern' }).click();
		await page.getByRole('link', { name: 'Zurück' }).click();
		await page.waitForURL(/\/konto$/);

		// From the start page: what the user does to get to the invoices.
		await page.goto(portal.url);
		await page.getByRole('link', { name: 'Mein Konto' }).click();
		await page.waitForURL(/\/konto$/);
		await page.getByLabel('Suche').click();
		await page.getByLabel('Suche').fill(TYPED);
		await page.getByLabel('Notiz').pressSequentially('Kundennummer 123456');
		// The user's own e-mail address as a link: not a usable name.
		await page.getByRole('link', { name: FAKE_PORTAL_USER }).click();
		await page.waitForLoadState('domcontentloaded');
		await page.getByRole('tab', { name: 'Dokumente' }).click();
		await page.waitForURL(/\/belege$/);
		await page
			.getByRole('button', { name: /^Rechnung vom/ })
			.first()
			.click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Beleg öffnen' }).first().click()
		]);
		assert.ok(download);

		const r = await m.recordStop('vodafone');
		assert.equal(r.download, true);
		assert.equal(r.pausedOnLogin, 2, '"Speichern" and "Zurück" on the password page');
		assert.deepEqual(
			r.steps.filter((s) => s.kind === 'click'),
			[
				{ kind: 'click', role: 'link', label: 'Mein Konto', download: false, usable: true },
				{ kind: 'click', role: 'link', label: '', download: false, usable: false },
				{ kind: 'click', role: 'tab', label: 'Dokumente', download: false, usable: true },
				{
					kind: 'click',
					role: 'button',
					label: 'Rechnung vom #.#.#',
					download: false,
					usable: true
				},
				{ kind: 'click', role: 'button', label: 'Beleg öffnen', download: true, usable: true }
			]
		);
		const pages = r.steps.filter((s) => s.kind === 'page').map((s) => s.path);
		assert.ok(pages.includes('/meinvodafone/services/konto'));
		assert.ok(pages.includes('/meinvodafone/services/konto/belege'));
		assert.ok(!pages.some((path) => path?.includes('passwort')), 'no password page');
		const text = JSON.stringify(r);
		for (const secret of [
			TYPED,
			'4711',
			'123456',
			FAKE_PORTAL_USER,
			FAKE_PORTAL_PASSWORD,
			CUSTOMER_NUMBER,
			'Speichern',
			'Zurück'
		]) {
			assert.equal(text.includes(secret), false, secret);
		}
		assert.equal((await m.list())[0].running, null, 'the window is closed');
		assert.equal((await m.list())[0].review, true);
	});

	test('saved: a 0600 override with the route and the download control', async () => {
		const saved = await m.recordSave('vodafone');
		assert.equal(saved.saved, true);
		assert.equal(saved.route, 3, 'the unusable click is left out');
		assert.match(saved.recipeVersion, /\+rec\.\d{4}-\d{2}-\d{2} \(unverified\)$/);
		const file = join(recipesDir, 'vodafone.json');
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		assert.equal((await stat(recipesDir)).mode & 0o777, 0o700);
		const text = await readFile(file, 'utf8');
		const patch = JSON.parse(text);
		assert.deepEqual(
			patch.route.map((/** @type {any} */ s) => s.target),
			[
				{ role: 'link', name: { re: '^Mein Konto$', flags: 'i' } },
				{ role: 'tab', name: { re: '^Dokumente$', flags: 'i' } },
				{ role: 'button', name: { re: '^Rechnung vom \\d+\\.\\d+\\.\\d+$', flags: 'i' } }
			]
		);
		assert.deepEqual(patch.dom, {
			downloadControls: [{ role: 'button', name: { re: '^Beleg öffnen$', flags: 'i' } }]
		});
		assert.equal(patch.verified, false);
		assert.equal(patch.recorded.steps.at(-1).download, true);
		for (const secret of [TYPED, FAKE_PORTAL_USER, FAKE_PORTAL_PASSWORD, CUSTOMER_NUMBER]) {
			assert.equal(text.includes(secret), false, secret);
		}
		assert.deepEqual(m.recipeExport('vodafone'), patch);
		const [p] = await m.list();
		assert.equal(p.recorded, true);
		assert.equal(p.review, false);
		await assert.rejects(m.recordSave('vodafone'), { code: 'PORTAL_NOT_RECORDED' });
	});

	test('replayed: a fresh bridge follows the route and downloads with the recorded control', async () => {
		// The page is the only way: no API, and no control the bundled recipe knows.
		portal.setApi(false);
		try {
			const before = portal.state.requests.length;
			const fresh = manager();
			const result = await fresh.fetch('vodafone', { since: longAgo });
			assert.deepEqual(
				result.invoices.map((i) => i.id),
				sampleInvoices().map((i) => i.number)
			);
			assert.deepEqual(result.errors, []);
			assert.equal(isPdf(await fresh.invoice('vodafone', result.invoices[0].id)), true);
			const requests = portal.state.requests.slice(before);
			for (const path of [
				'GET /meinvodafone/services/konto',
				'GET /meinvodafone/services/konto/belege'
			]) {
				assert.ok(requests.includes(path), path);
			}
			assert.ok(logs.includes('portal vodafone: strategy dom: 3 invoice(s)'));
		} finally {
			portal.setApi(true);
		}
	});

	test('a recording without a download cannot be saved; one can be discarded', async () => {
		await m.recordStart('vodafone');
		await m.recordStop('vodafone');
		await assert.rejects(m.recordSave('vodafone'), { code: 'PORTAL_RECORDING_NO_DOWNLOAD' });
		assert.deepEqual(await m.recordDiscard('vodafone'), { discarded: true });
		await assert.rejects(m.recordStop('vodafone'), { code: 'PORTAL_NOT_RECORDED' });

		// Discarding a running one closes the window.
		await m.recordStart('vodafone');
		assert.deepEqual(await m.recordDiscard('vodafone'), { discarded: true });
		assert.equal((await m.list())[0].running, null);
		assert.deepEqual(await m.recordDiscard('vodafone'), { discarded: false });
		// The saved recipe stays.
		assert.equal((await m.list())[0].recorded, true);
	});

	test('without a recipes directory recording is off', async () => {
		const off = createPortalManager({
			recipes: recipes(),
			dir: join(dir, 'portals'),
			credentials: async () => null,
			headless: 'always'
		});
		assert.equal((await off.list())[0].recordable, false);
		await assert.rejects(off.recordStart('vodafone'), { code: 'PORTAL_RECORDING_OFF' });
	});

	test('the log names counts and steps, never a value, a name or the page', () => {
		const all = logs.join('\n');
		assert.ok(all.includes('recording stopped: 5 click(s), download seen, 2 on a login page'));
		for (const secret of [TYPED, FAKE_PORTAL_USER, FAKE_PORTAL_PASSWORD, CUSTOMER_NUMBER]) {
			assert.equal(all.includes(secret), false, secret);
		}
	});
});

describe('recording endpoints', () => {
	const APP = 'http://localhost:5173';
	/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string} */ let dir;
	/** @type {string} */ let token;
	/** @type {string[]} */ const printed = [];

	before(async () => {
		portal = await startFakePortal();
		dir = await mkdtemp(join(tmpdir(), 'belege-recorder-api-'));
		const configPath = join(dir, 'bridge.json');
		await saveConfig(
			{
				...defaultConfig(),
				appOrigins: [APP],
				portals: { vodafone: { baseUrl: portal.url } }
			},
			configPath
		);
		bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			portalKeychain: () => memoryKeychain(null),
			portalHeadless: 'always',
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
		await portal?.close();
		await rm(dir, { recursive: true, force: true });
	});

	/** @param {string} path @param {{ method?: string, auth?: boolean }} [o] */
	const call = (path, { method = 'POST', auth = true } = {}) =>
		request(bridge.address.port, path, {
			method,
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) }
		});

	test('need the token, and the right method', async () => {
		for (const [method, path] of [
			['POST', '/portals/vodafone/record/start'],
			['POST', '/portals/vodafone/record/stop'],
			['POST', '/portals/vodafone/record/save'],
			['POST', '/portals/vodafone/record/discard'],
			['GET', '/portals/vodafone/recipe/export']
		]) {
			assert.equal((await call(path, { method, auth: false })).status, 401, path);
		}
		assert.equal((await call('/portals/vodafone/record/start', { method: 'GET' })).status, 405);
		assert.equal((await call('/portals/vodafone/recipe/export')).status, 405);
		assert.equal((await call('/portals/vodafone/record/pause')).status, 404);
		assert.equal(portal.state.requests.length, 0, 'nothing reached the portal');
	});

	test('start → stop → save refused without a download → discard; nothing to export', async () => {
		assert.equal((await call('/portals/vodafone/record/stop')).json.code, 'PORTAL_NOT_RECORDED');
		const exported = await call('/portals/vodafone/recipe/export', { method: 'GET' });
		assert.equal(exported.status, 404);
		assert.equal(exported.json.code, 'PORTAL_NO_RECORDED_RECIPE');

		const start = await call('/portals/vodafone/record/start');
		assert.equal(start.status, 200, start.text);
		const list = await request(bridge.address.port, '/portals', {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.equal(list.json.portals[0].running, 'record');
		const stop = await call('/portals/vodafone/record/stop');
		assert.equal(stop.status, 200, stop.text);
		assert.equal(stop.json.download, false);
		assert.ok(Array.isArray(stop.json.steps));
		const save = await call('/portals/vodafone/record/save');
		assert.equal(save.status, 422);
		assert.equal(save.json.code, 'PORTAL_RECORDING_NO_DOWNLOAD');
		const discard = await call('/portals/vodafone/record/discard');
		assert.deepEqual(discard.json, { discarded: true });
	});

	test('a saved override is exported as it is on disk', async () => {
		const recipesDir = join(dir, 'recipes');
		await mkdir(recipesDir, { recursive: true });
		await writeFile(join(recipesDir, 'vodafone.json'), JSON.stringify(sampleOverride()));
		const exported = await call('/portals/vodafone/recipe/export', { method: 'GET' });
		assert.equal(exported.status, 200);
		assert.deepEqual(exported.json, sampleOverride());
	});
});
