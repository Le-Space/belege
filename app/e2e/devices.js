// Two devices of one passkey, for the device specs: two browser contexts
// stand for a Mac and a phone (see device-sync.spec.js for why both get the
// PRF answer through the E2E-only hook).
import { expect } from '@playwright/test';

import { acceptConsent } from './consent.js';

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
 * @param {{ mode?: 'public' | 'qr' }} [options] where devices meet (#148), as this browser keeps it
 */
export async function device(browser, { mode = 'public' } = {}) {
	const context = await browser.newContext();
	await context.addInitScript(
		({ prf, mode }) => {
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			localStorage.setItem('belege.device-sync', 'on');
			localStorage.setItem('belege.network-mode', mode);
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
		{ prf: PRF, mode }
	);
	const page = await context.newPage();
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
