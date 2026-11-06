// One person in front of Belege, driven through the UI only (#625).
//
// A production build has no test hooks: no `window.__belegeE2E`, no PRF
// override, no "Testbuchung anlegen", no skipping of the passkey steps. So the
// agent does what a person does: Chrome's virtual authenticator (over CDP)
// answers the passkey prompts, "Weiter" is clicked between them, a booking
// comes in as a bank statement file, and everything it checks is what the page
// shows. The same code drives a local Chromium and one on an Aleph VM.

const DEFAULT_TIMEOUT = 120_000;

/** Timestamped live progress line, so the CI log shows what the run is doing. */
export function progress(message) {
	console.log(`[remote-collab ${new Date().toISOString()}] ${message}`);
}

const PEER_ID = /\b(12D3KooW[1-9A-HJ-NP-Za-km-z]{44,48}|Qm[1-9A-HJ-NP-Za-km-z]{44})\b/;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BelegeAgent {
	/**
	 * @param {{ name: string, browser: import('playwright').Browser, appUrl: string, timeout?: number }} options
	 */
	constructor({ name, browser, appUrl, timeout = DEFAULT_TIMEOUT }) {
		this.name = name;
		this.browser = browser;
		this.appUrl = appUrl;
		this.timeout = timeout;
		/** @type {import('playwright').BrowserContext | null} */
		this.context = null;
		/** @type {import('playwright').Page | null} */
		this.page = null;
		/** @type {string[]} */
		this.log = [];
		/** @type {Record<string, unknown>} */
		this.facts = {};
		/** Unlocked as a member (the books of another), for an unlock after a reload. */
		this.member = false;
		/** A page's code failed to load since the last reload (see waitForBooking). */
		this.routeFailed = false;
		this.routeReloads = 0;
	}

	/** A fresh profile, a virtual authenticator with PRF, the app opened. */
	async open() {
		// German, as the app's own E2E suite reads it; the texts asserted below are German.
		this.context = await this.browser.newContext({
			locale: 'de-DE',
			viewport: { width: 1280, height: 900 }
		});
		this.page = await this.context.newPage();
		this.page.on('console', (message) => {
			const type = message.type();
			const text = message.text();
			if (type !== 'error' && type !== 'warning' && !/relay|dial|sync|libp2p/i.test(text)) return;
			this.log.push(`[${type}] ${text.slice(0, 500)}`);
			if (this.log.length > 200) this.log.shift();
			// The gateway answers 429 now and then; a page whose code was refused
			// stays broken in this document, however often it is opened again.
			if (/Failed to fetch dynamically imported module|Importing a module script failed/.test(text))
				this.routeFailed = true;
			// The app looks for a bridge on this machine; there is none here.
			const bridgeProbe = /127\.0\.0\.1:8765|net::ERR_FAILED|status of 404/.test(text);
			if (type === 'error' && !bridgeProbe) {
				progress(`[${this.name} console.${type}] ${text.slice(0, 300)}`);
			}
		});
		this.page.on('pageerror', (error) => progress(`[${this.name} pageerror] ${error.message}`));

		await this.addVirtualAuthenticator();
		progress(`[${this.name}] opening ${this.appUrl}`);
		await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });
		this.facts.userAgent = await this.page.evaluate(() => navigator.userAgent);
		this.facts.release = await this.release();
		progress(`[${this.name}] app release ${this.facts.release || 'unknown'}`);
	}

	/**
	 * A platform authenticator with PRF, resident keys and user verification
	 * (as app/e2e/webauthn.js, without the E2E-only skip of the steps). It needs
	 * a CDP session: over `chromium.connect` to the Aleph VM that goes through
	 * the Playwright protocol, and if it does not, the run says so here.
	 */
	async addVirtualAuthenticator() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		let cdp;
		try {
			cdp = await page.context().newCDPSession(page);
			await cdp.send('WebAuthn.enable');
			const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
				options: {
					protocol: 'ctap2',
					ctap2Version: 'ctap2_1',
					transport: 'internal',
					hasResidentKey: true,
					hasUserVerification: true,
					isUserVerified: true,
					hasLargeBlob: true,
					hasPrf: true,
					automaticPresenceSimulation: true
				}
			});
			this.facts.virtualAuthenticator = 'ok';
			this.facts.authenticatorId = authenticatorId;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.facts.virtualAuthenticator = `failed: ${message}`;
			throw new Error(
				`${this.name}: no virtual authenticator over this browser connection (CDP WebAuthn): ${message}`
			);
		}
		this.cdp = cdp;
	}

	/** The release the footer names (`v0.28.0`), or '' when it names none. */
	async release() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		const footer = page.getByTestId('release');
		await footer.waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
		return ((await footer.textContent().catch(() => '')) ?? '').trim();
	}

	/** The consent screen: "Eigene Geräte" switched on, then "Verstanden". */
	async acceptConsentWithDevices() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		const dialog = page.getByTestId('consent-modal');
		await dialog.waitFor({ state: 'visible', timeout: this.timeout });
		// The switch sits in the network section, folded on a first visit.
		const network = dialog.getByTestId('consent-network');
		if ((await network.getAttribute('open')) === null) {
			await network.locator('summary').first().click();
		}
		const devices = dialog.getByTestId('consent-devices');
		if ((await devices.getAttribute('data-state')) !== 'on') {
			await devices.locator('label').first().click();
			await waitForAttribute(devices, 'data-state', 'on', 15_000);
		}
		await dialog.getByTestId('consent-proceed').click();
		await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
		this.facts.deviceSyncAtConsent = 'on';
	}

	/**
	 * "Passkey anlegen", and "Weiter" between the prompts (the steps dialog of
	 * #429, which only E2E builds can skip).
	 *
	 * @param {string} label
	 */
	async createPasskey(label) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await page.getByTestId('passkey-label').fill(label);
		await page.getByTestId('passkey-create').click();
		await this.throughPasskeySteps(page.getByTestId('own-did'));
		this.facts.did = await page.getByTestId('own-did').getAttribute('data-did');
	}

	/**
	 * Unlock after a reload: the books chosen on the unlock screen.
	 *
	 * @param {{ member?: boolean }} [options]
	 */
	async reloadAndUnlock({ member = false } = {}) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		this.member = member;
		this.routeFailed = false;
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.getByTestId('passkey-unlock').waitFor({ state: 'visible', timeout: this.timeout });
		if (member) await page.getByTestId('open-books-member').check();
		await page.getByTestId('passkey-unlock').click();
		await this.throughPasskeySteps(
			member ? page.getByTestId('member-books') : page.getByTestId('own-did')
		);
	}

	/**
	 * Click "Weiter" on every step until `done` shows; a passkey error ends it.
	 *
	 * @param {import('playwright').Locator} done
	 */
	async throughPasskeySteps(done) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		const deadline = Date.now() + this.timeout;
		let steps = 0;
		while (Date.now() < deadline) {
			if (await done.isVisible().catch(() => false)) {
				this.facts.passkeySteps = steps;
				return;
			}
			const error = page.getByTestId('passkey-error');
			if (await error.isVisible().catch(() => false)) {
				throw new Error(`${this.name}: passkey error: ${(await error.textContent())?.trim()}`);
			}
			const next = page.getByTestId('passkey-step-continue');
			if (await next.isVisible().catch(() => false)) {
				await next.click();
				steps += 1;
			}
			await sleep(250);
		}
		throw new Error(`${this.name}: the passkey flow did not finish within ${this.timeout} ms`);
	}

	/** @param {string} id e.g. 'bank', 'geraete', 'zusammenarbeit' */
	async openIntegration(id) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await page.getByTestId('tab-integrationen').click();
		await page.waitForURL(/\/integrationen\/?$/, { timeout: 30_000 });
		await page.getByTestId(`integration-${id}`).click();
		await page.getByTestId('integration-title').waitFor({ state: 'visible', timeout: 30_000 });
	}

	/**
	 * A booking, entered as a person does without a bank connection: a
	 * statement file chosen under Integrationen → Bank.
	 *
	 * @param {{ name: string, mimeType: string, buffer: Buffer }} file
	 */
	async importStatement(file) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await this.openIntegration('bank');
		await page.getByTestId('camt-file').setInputFiles(file);
		const result = page.getByTestId('camt-result').last();
		const error = page.getByTestId('camt-error');
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			if (await error.isVisible().catch(() => false)) {
				throw new Error(`${this.name}: statement refused: ${(await error.textContent())?.trim()}`);
			}
			const text = (await result.textContent().catch(() => '')) ?? '';
			if (/Neu: 1\b/.test(text)) return text.trim();
			await sleep(250);
		}
		throw new Error(`${this.name}: the statement did not import within 60 s`);
	}

	/** Zahlungen, every payment listed (an empty list has no filter yet). */
	async openPayments() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await page.getByTestId('tab-zahlungen').click();
		await page.waitForURL(/\/zahlungen\/?$/, { timeout: 30_000 });
		await this.showAllPayments();
	}

	async showAllPayments() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		const all = page.getByTestId('filter-all');
		if (
			(await all.isVisible().catch(() => false)) &&
			(await all.getAttribute('aria-pressed')) !== 'true'
		) {
			await all.click().catch(() => {});
		}
	}

	/**
	 * Wait until Zahlungen lists a payment with this text.
	 *
	 * @param {string} text
	 * @param {number} [timeout]
	 */
	async waitForBooking(text, timeout = this.timeout) {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await this.openPayments();
		const row = page.getByTestId('transaction').filter({ hasText: text });
		const deadline = Date.now() + timeout;
		let reopened = Date.now();
		while (Date.now() < deadline) {
			if (
				await row
					.first()
					.isVisible()
					.catch(() => false)
			)
				return;
			// Zahlungen's code was refused (a 429 from the gateway): only a reload
			// brings it back, and with it the unlock. Not the sync's fault.
			if (this.routeFailed && this.routeReloads < 3) {
				this.routeReloads += 1;
				this.facts.routeReloads = this.routeReloads;
				progress(`[${this.name}] a page's code did not load; reloading (${this.routeReloads}/3)`);
				await sleep(10_000);
				await this.reloadAndUnlock({ member: this.member });
				await this.openPayments();
				reopened = Date.now();
				continue;
			}
			// The first payment brings the filter along.
			await this.showAllPayments();
			// The list follows the books live; opening it again now and then
			// costs nothing and rules out a filter that changed under it.
			if (Date.now() - reopened > 30_000) {
				await this.openPayments();
				reopened = Date.now();
			}
			await sleep(500);
		}
		throw new Error(`${this.name}: no payment "${text}" in Zahlungen within ${timeout} ms`);
	}

	/**
	 * What the network menu says: the badge's state, own devices, the relay
	 * lights of the mode the node runs in (their title names the relays).
	 */
	async networkStatus() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		const badge = page.getByTestId('local-only');
		const status = {
			badge: await badge.getAttribute('data-state').catch(() => null),
			title: await badge.getAttribute('title').catch(() => null),
			/** @type {string | null} */
			devices: null,
			/** @type {{ kind: string | null, state: string | null, text: string, relays: string }[]} */
			lights: []
		};
		await badge.click();
		const menu = page.getByTestId('network-menu');
		try {
			await menu.waitFor({ state: 'visible', timeout: 10_000 });
			status.devices =
				(await menu
					.getByTestId('network-devices-state')
					.textContent({ timeout: 2_000 })
					.catch(() => null)) ?? null;
			for (const light of await menu.locator('[data-testid^="relay-light-"]').all()) {
				status.lights.push({
					kind: ((await light.getAttribute('data-testid')) ?? '').replace('relay-light-', ''),
					state: await light.getAttribute('data-state'),
					text: ((await light.textContent()) ?? '').trim(),
					relays: (await light.getAttribute('title')) ?? ''
				});
			}
		} finally {
			if (await menu.isVisible().catch(() => false)) await badge.click();
		}
		return status;
	}

	/**
	 * Wait for a place at a public Le Space relay, as the network menu's light
	 * shows it (since #609). A build without the light is reported, not failed,
	 * unless `require` is set.
	 *
	 * @param {{ require?: boolean, timeout?: number }} [options]
	 */
	async waitForPublicRelay({ require = false, timeout = this.timeout } = {}) {
		const started = Date.now();
		const deadline = started + timeout;
		let status = await this.networkStatus();
		while (Date.now() < deadline) {
			const light = status.lights.find((l) => l.kind === 'public');
			if (light?.state === 'up') return status;
			// A light that never appears in 20 s: a build from before #609.
			if (!status.lights.length && !require && Date.now() - started > 20_000) {
				progress(`[${this.name}] this build shows no relay light; not waiting for it`);
				return status;
			}
			await sleep(2_000);
			status = await this.networkStatus();
		}
		throw new Error(
			`${this.name}: no public relay within ${timeout} ms (network menu: ${JSON.stringify(status)})`
		);
	}

	/**
	 * Integrationen → Eigene Geräte: this device's id, the devices it knows and
	 * how they are connected, how many entries came and went.
	 */
	async devices() {
		const page = /** @type {import('playwright').Page} */ (this.page);
		await this.openIntegration('geraete');
		const self =
			(await page
				.getByTestId('devices-self')
				.textContent({ timeout: 10_000 })
				.catch(() => '')) ?? '';
		const items = [];
		for (const item of await page.getByTestId('devices-item').all()) {
			const text = ((await item.textContent()) ?? '').replace(/\s+/g, ' ').trim();
			items.push({
				peerId: PEER_ID.exec(text)?.[1] ?? null,
				state: ((await item.getByTestId('devices-item-state').textContent()) ?? '').trim(),
				last: ((await item.getByTestId('devices-item-last').textContent()) ?? '').trim()
			});
		}
		const log = page.getByTestId('sync-log-line');
		return {
			self: PEER_ID.exec(self)?.[1] ?? (self.trim() || null),
			reachable: (
				(await page
					.getByTestId('devices-reachable')
					.textContent({ timeout: 2_000 })
					.catch(() => '')) ?? ''
			).trim(),
			devices: items,
			syncLog: {
				in: await log.and(page.locator('[data-direction="in"]')).count(),
				out: await log.and(page.locator('[data-direction="out"]')).count()
			}
		};
	}

	/** What a failed run keeps: the network menu, the devices, the console's tail. */
	async diagnostics() {
		/** @type {Record<string, unknown>} */
		const out = { facts: this.facts, url: this.page?.url() ?? null, log: this.log.slice(-60) };
		if (!this.page) return out;
		// One after the other: both open menus and pages of the same tab.
		out.network = await this.networkStatus().catch((error) => `unavailable: ${error.message}`);
		out.devices = await this.devices().catch((error) => `unavailable: ${error.message}`);
		return out;
	}

	/** @param {string} path */
	async screenshot(path) {
		await this.page?.screenshot({ path, fullPage: true });
	}

	async close() {
		await this.context?.close();
	}
}

/**
 * @param {import('playwright').Locator} locator
 * @param {string} name
 * @param {string} value
 * @param {number} timeout
 */
async function waitForAttribute(locator, name, value, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if ((await locator.getAttribute(name).catch(() => null)) === value) return;
		await sleep(200);
	}
	throw new Error(`${name} did not become "${value}" within ${timeout} ms`);
}
