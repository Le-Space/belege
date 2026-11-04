// Where the second browser runs: a local Chromium, or Chromium on a
// short-lived Aleph VM (relay-button's playwright-runner RootFS), reached over
// authenticated WSS. Modelled on Le-Space/simple-todo e2e/remote/providers.mjs.
import { chromium } from 'playwright';
import { connectAlephChromium, PLAYWRIGHT_RUNNER_VERSION } from '@le-space/playwright';

/** Client and VM must run exactly this Playwright; the RootFS pin says the same. */
export const PLAYWRIGHT_VERSION = '1.61.1';
export { PLAYWRIGHT_RUNNER_VERSION };

export async function createLocalBrowser() {
	return chromium.launch({ headless: true });
}

/**
 * @param {{ wsEndpoint?: string, versionUrl?: string, secret?: string }} options
 */
export async function createAlephBrowser({ wsEndpoint, versionUrl, secret }) {
	if (!wsEndpoint || !versionUrl || !secret) {
		throw new Error(
			'The Aleph provider needs ALEPH_PLAYWRIGHT_WS_ENDPOINT, ALEPH_PLAYWRIGHT_VERSION_URL and ALEPH_PLAYWRIGHT_SECRET.'
		);
	}
	if (PLAYWRIGHT_RUNNER_VERSION !== PLAYWRIGHT_VERSION) {
		throw new Error(
			`@le-space/playwright expects Playwright ${PLAYWRIGHT_RUNNER_VERSION} on the VM, this client is ${PLAYWRIGHT_VERSION}.`
		);
	}
	return connectAlephChromium({
		chromium: { connect: (endpoint, options) => chromium.connect(endpoint, options) },
		wsEndpoint,
		versionUrl,
		secret,
		expectedVersion: PLAYWRIGHT_VERSION,
		timeoutMs: 120_000
	});
}
