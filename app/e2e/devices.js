// Two devices of one passkey, for the device specs: two browser contexts
// stand for a Mac and a phone (see device-sync.spec.js for why both get the
// PRF answer through the E2E-only hook).
import { expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openDevicesAdvanced, openIntegration } from './integrations.js';

const AUTHENTICATOR = {
	protocol: 'ctap2',
	ctap2Version: 'ctap2_1',
	transport: 'internal',
	hasResidentKey: true,
	hasUserVerification: true,
	isUserVerified: true,
	hasLargeBlob: true,
	hasPrf: true,
	automaticPresenceSimulation: true
};
// Made up: the answer one synced passkey gives on both devices.
const PRF = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

/**
 * A device with device sync switched on, a virtual authenticator, and a camera
 * and QR detector the test feeds.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {{ mode?: 'public' | 'qr' | 'lan', lanRelay?: string, syncedPrf?: boolean, prf?: number[] }} [options] where devices meet
 *   (#148), as this browser keeps it, and the own bridge's relay it knows;
 *   `syncedPrf`: every passkey prompt that asks for PRF gets the same answer
 *   in this browser as in the other, as a synced passkey gives it – also the
 *   identity provider's own, which a restore asks and which a credential
 *   copied into another virtual authenticator cannot answer (#957);
 *   `prf`: this device's own passkey answers so instead of the shared answer –
 *   a device with a passkey of its own (#962)
 */
export async function device(browser, options = {}) {
	const context = await browser.newContext();
	return equip(context, await context.newPage(), options);
}

/**
 * What `device` gives a browser, for a context made elsewhere (a recorded
 * scene's, e2e-video/): its init scripts take hold at the page's next navigation.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {Parameters<typeof device>[1]} [options]
 */
export async function equip(
	context,
	page,
	{ mode = 'public', lanRelay = '', syncedPrf = false, prf = PRF } = {}
) {
	if (syncedPrf) {
		await context.addInitScript((prf) => {
			const container = navigator.credentials;
			for (const name of /** @type {const} */ (['create', 'get'])) {
				const ask = container[name].bind(container);
				container[name] = async (/** @type {any} */ options) => {
					const credential = /** @type {any} */ (await ask(options));
					const asked = options?.publicKey?.extensions?.prf;
					if (!credential || !asked) return credential;
					const results = credential.getClientExtensionResults.bind(credential);
					const first = Uint8Array.from(prf).buffer;
					credential.getClientExtensionResults = () => {
						const r = results();
						return { ...r, prf: { ...r.prf, enabled: true, results: { first } } };
					};
					return credential;
				};
			}
		}, prf);
	}
	// BENCH_LIBP2P_DEBUG=libp2p:connection-monitor* switches libp2p's own
	// logging on in the page (its logger reads `localStorage.debug`); the
	// resilience benchmark keeps what the console then says (bench/).
	const debug = process.env.BENCH_LIBP2P_DEBUG ?? '';
	await context.addInitScript(
		({ prf, mode, lanRelay, debug }) => {
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			if (debug) localStorage.setItem('debug', debug);
			// No "Weiter" between the passkey prompts (#429), as addVirtualAuthenticator does.
			/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
			localStorage.setItem('belege.device-sync', 'on');
			// Only the first time: a mode chosen in the menu must survive a reload.
			if (!localStorage.getItem('belege.network-mode')) {
				localStorage.setItem('belege.network-mode', mode);
			}
			if (lanRelay && !localStorage.getItem('belege.lan-relay')) {
				localStorage.setItem('belege.lan-relay', lanRelay);
			}
			// A camera and a QR detector for "QR-Code scannen": the camera shows a
			// blank canvas, the detector reads whatever the test put in __scanValue.
			/** @type {any} */ (globalThis).BarcodeDetector = class {
				async detect() {
					const value = /** @type {any} */ (globalThis).__scanValue;
					return value ? [{ rawValue: value }] : [];
				}
			};
			navigator.mediaDevices.getUserMedia = async () => {
				const canvas = document.createElement('canvas');
				canvas.width = 64;
				canvas.height = 64;
				canvas.getContext('2d')?.fillRect(0, 0, 64, 64);
				return canvas.captureStream(5);
			};
		},
		{ prf, mode, lanRelay, debug }
	);
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: AUTHENTICATOR
	});
	return { context, page, cdp, authenticatorId };
}

/**
 * The Mac's passkey on the phone, as a synced passkey is, and the phone
 * unlocked with it.
 *
 * @param {Awaited<ReturnType<typeof device>>} mac
 * @param {Awaited<ReturnType<typeof device>>} phone
 * @param {string} did the Mac's
 */
export async function samePasskey(mac, phone, did) {
	const { credentials } = await mac.cdp.send('WebAuthn.getCredentials', {
		authenticatorId: mac.authenticatorId
	});
	await phone.cdp.send('WebAuthn.addCredential', {
		authenticatorId: phone.authenticatorId,
		credential: credentials[0]
	});
	// A phone that has unlocked with it before: its stored credential (public
	// parts only) is there. Restoring from scratch asks the provider for the
	// PRF itself, which the copied virtual credential cannot answer.
	const stored = await mac.page.evaluate(() => {
		/** @type {Record<string, string>} */
		const kept = {};
		for (let i = 0; i < localStorage.length; i++) {
			const k = String(localStorage.key(i));
			if (k === 'belege.webauthnCredential' || k.startsWith('webauthn-identity-proof:')) {
				kept[k] = String(localStorage.getItem(k));
			}
		}
		return kept;
	});
	await phone.page.goto('/robots.txt');
	await phone.page.evaluate((kept) => {
		for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
	}, stored);
	await phone.page.goto('/');
	await acceptConsent(phone.page);
	await phone.page.getByTestId('passkey-unlock').click();
	await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
}

/** Made up: the PRF answer of a device's own passkey (#962). @param {number} n */
export const prfOf = (n) => Array.from({ length: 32 }, (_, i) => (i * 29 + n * 53) % 256);

/**
 * A device with a passkey of its own, meeting the others by QR only.
 *
 * @param {import('@playwright/test').Browser} browser @param {number} n
 */
export const ownDevice = (browser, n) => device(browser, { mode: 'qr', prf: prfOf(n) });

/**
 * Every request these browsers send beyond this machine, and every WebSocket:
 * the specs of the own network expect the list to stay empty.
 *
 * @param {Awaited<ReturnType<typeof device>>[]} devices
 * @param {{ localSockets?: boolean }} [options] `localSockets`: a WebSocket to
 *   this machine counts as local too – the own bridge's node runs here (#599)
 */
export function recordOutside(devices, { localSockets = false } = {}) {
	/** @type {string[]} */
	const outside = [];
	// This machine's own servers (the page, the test bridge) do not count.
	const local = (/** @type {string} */ url) =>
		/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
	for (const d of devices) {
		d.context.on('request', (r) => {
			if (!local(r.url())) outside.push(r.url());
		});
		d.page.on('websocket', (ws) => {
			if (!localSockets || !local(ws.url())) outside.push(`websocket ${ws.url()}`);
		});
	}
	return outside;
}

/**
 * A new device with its own passkey asks the laptop, by its QR invite; the
 * laptop answers "Zulassen" (or "Ablehnen") after comparing both devices' ids.
 *
 * @param {Awaited<ReturnType<typeof device>>} laptop
 * @param {Awaited<ReturnType<typeof device>>} fresh
 * @param {string} label the new passkey's name
 * @param {boolean} [allow]
 */
export async function joinOwn(laptop, fresh, label, allow = true) {
	await fresh.page.goto('/');
	await acceptConsent(fresh.page);
	await fresh.page.getByTestId('own-join-open').locator('summary').click();
	await fresh.page.getByTestId('own-join-label').fill(label);
	await fresh.page.getByTestId('own-join-start').click();

	await openIntegration(laptop.page, 'geraete');
	// With a device known, the invite is under "Erweitert".
	await openDevicesAdvanced(laptop.page);
	await laptop.page.getByTestId('devices-qr-invite').click();
	const invite = laptop.page.getByTestId('devices-qr-code');
	await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
	await fresh.page
		.getByTestId('own-join-paste')
		.fill(String(await invite.getAttribute('data-code')));
	await fresh.page.getByTestId('own-join-use').click();

	const answer = fresh.page.getByTestId('own-join-code');
	await expect(answer).toBeVisible({ timeout: 30_000 });
	await laptop.page
		.getByTestId('devices-qr-paste')
		.fill(String(await answer.getAttribute('data-code')));
	await laptop.page.getByTestId('devices-qr-use').click();

	const dialog = laptop.page.getByTestId('handover-dialog');
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	// Both screens name both devices alike.
	const here = String(await fresh.page.getByTestId('own-join-compare').textContent());
	for (const id of String(await laptop.page.getByTestId('handover-compare').textContent()).match(
		/…\S{6}/g
	) ?? []) {
		expect(here).toContain(id);
	}
	await laptop.page.getByTestId(allow ? 'handover-allow' : 'handover-deny').click();
	await expect(dialog).toBeHidden();
}
