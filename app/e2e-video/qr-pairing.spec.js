// Scene 2: two devices of one passkey meet by QR code, with no relay, no
// STUN server and nothing asking Aleph – the Mac shows an invite, the phone
// scans it and shows its answer, the Mac takes it, and the books sync both
// ways over the direct connection. Two browser contexts stand for the two
// devices; each records its own video, composed side by side afterwards
// (compose.sh). The camera and the QR detector are fed by the test, as in
// e2e/device-qr.spec.js, from which the steps come.
import { test, expect } from '@playwright/test';
import { installCaptions, say } from './captions.js';

const SIZE = { width: 960, height: 720 };
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
// Made up: the answer one synced passkey gives on both devices (e2e/devices.js).
const PRF = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

/**
 * A device in QR mode with a virtual authenticator, and a camera and QR
 * detector the test feeds. Its own context, so it has its own video.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} videoDir
 */
async function device(browser, videoDir) {
	const context = await browser.newContext({
		viewport: SIZE,
		locale: 'en-GB',
		recordVideo: { dir: videoDir, size: SIZE }
	});
	await installCaptions(context);
	await context.addInitScript((prf) => {
		/** @type {any} */ (globalThis).__belegeTestPrf = prf;
		/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
		localStorage.setItem('belege.device-sync', 'on');
		if (!localStorage.getItem('belege.network-mode'))
			localStorage.setItem('belege.network-mode', 'qr');
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
	}, PRF);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: AUTHENTICATOR
	});
	return { context, page, cdp, authenticatorId };
}

/** @param {import('@playwright/test').Page} page */
async function acceptConsent(page) {
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();
}

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) =>
	page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name, exact: true })
		.click();

/** @param {import('@playwright/test').Page} page @param {'geraete' | 'backup'} id */
async function openIntegration(page, id) {
	await page.getByTestId('tab-integrationen').click();
	await expect(page).toHaveURL(/\/integrationen\/?$/);
	await page.getByTestId(`integration-${id}`).click();
	await expect(page.getByTestId('integration-title')).toBeVisible();
}

test('scene 2: two devices meet by QR code, no relay, and the books sync', async ({
	browser
}, testInfo) => {
	const mac = await device(browser, testInfo.outputPath('mac'));
	const phone = await device(browser, testInfo.outputPath('phone'));
	try {
		await mac.page.goto('/');
		await say(mac.page, 'The laptop: a passkey, and one booking in the books.', 2500);
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('Demo Studio');
		await mac.page.getByRole('button', { name: 'Create passkey' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await tab(mac.page, 'Payments');
		await mac.page.evaluate(async () => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: new Date().toISOString().slice(0, 10),
				counterparty: 'Kaffeerösterei Nordlicht GmbH',
				purpose: 'Card payment',
				amountCents: -2242
			});
		});
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
		await say(mac.page, 'One booking. The phone has the same passkey, and empty books.', 3000);

		// The same passkey on the phone, as a synced passkey is.
		const { credentials } = await mac.cdp.send('WebAuthn.getCredentials', {
			authenticatorId: mac.authenticatorId
		});
		await phone.cdp.send('WebAuthn.addCredential', {
			authenticatorId: phone.authenticatorId,
			credential: credentials[0]
		});
		const stored = await mac.page.evaluate(() => {
			/** @type {Record<string, string>} */
			const kept = {};
			for (let i = 0; i < localStorage.length; i++) {
				const k = String(localStorage.key(i));
				if (k === 'belege.webauthnCredential' || k.startsWith('webauthn-identity-proof:'))
					kept[k] = String(localStorage.getItem(k));
			}
			return kept;
		});
		await phone.page.goto('/robots.txt');
		await phone.page.evaluate((kept) => {
			for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
		}, stored);
		await phone.page.goto('/');
		await say(phone.page, 'The phone: the same passkey, nothing else.', 2500);
		await acceptConsent(phone.page);
		await phone.page.getByTestId('passkey-unlock').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await tab(phone.page, 'Payments');
		await say(
			phone.page,
			'Same DID, empty books. No relay, no server: the two must meet directly.',
			3000
		);

		// The Mac: an invite.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-qr-mode')).toBeVisible();
		await say(mac.page, 'Devices, by QR code: the laptop shows an invite.', 2000);
		await mac.page.getByTestId('devices-qr-invite').click();
		const invite = mac.page.getByTestId('devices-qr-code');
		await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
		await expect(invite.locator('svg')).toBeVisible();
		await invite.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		const offer = String(await invite.getAttribute('data-code'));
		await say(mac.page, 'The invite is a WebRTC offer, nothing more. The phone scans it.', 2500);

		// The phone scans it and shows its answer.
		await openIntegration(phone.page, 'geraete');
		await say(phone.page, 'The phone scans the invite …', 1500);
		await phone.page.getByTestId('devices-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, offer);
		const answer = phone.page.getByTestId('devices-qr-code');
		await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 30_000 });
		await answer.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		const reply = String(await answer.getAttribute('data-code'));
		await say(phone.page, '… and shows its answer, for the laptop to scan back.', 3000);

		// The Mac takes the answer.
		await say(
			mac.page,
			'The laptop takes the answer (here pasted, as the fallback beside the camera).',
			2000
		);
		await mac.page
			.getByTestId('devices-qr-paste')
			.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await mac.page.getByTestId('devices-qr-paste').fill(reply);
		await mac.page.getByTestId('devices-qr-use').click();
		await expect(mac.page.getByTestId('devices-qr-connected')).toBeVisible({ timeout: 60_000 });
		await expect(mac.page.getByTestId('devices-item-state')).toContainText(/direct/i, {
			timeout: 30_000
		});
		await say(
			mac.page,
			'Connected, directly. The phone proved the passkey; it is a known device now.',
			3000
		);
		await expect(phone.page.getByTestId('devices-item-state')).toContainText(/direct/i, {
			timeout: 60_000
		});
		await say(phone.page, 'Connected, directly. The laptop proved the passkey too.', 2500);

		// The books sync, both ways.
		await tab(phone.page, 'Payments');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });
		await say(phone.page, 'The booking arrived over the direct connection.', 3000);
		await phone.page.evaluate(async () => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: new Date().toISOString().slice(0, 10),
				counterparty: 'Stromwerk Nord AG',
				purpose: 'Instalment',
				amountCents: -5259
			});
		});
		await say(phone.page, 'A booking made on the phone …', 1500);
		await tab(mac.page, 'Payments');
		await expect(mac.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });
		await say(
			mac.page,
			'… is on the laptop. Two devices, one set of books, no server in between.',
			5000
		);
		await say(phone.page, 'Two devices, one set of books, no server in between.', 5000);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});
