// Ported from Le-Space/simple-todo apps/invoice01 (playwright.config.js) at 56647d5.
// Changed: no relay and no shared e2e-kit server script; the app is built
// with VITE_E2E=true and served by `vite preview` on a port of its own, and
// Playwright never reuses a server it did not start (simple-todo#197: a
// suite once tested another branch's preview that happened to be running).
// Since UCEP: a circuit relay on this machine (e2e/relay.js, global-setup.js)
// for the invoicing-app spec; the app is built with its address.
import { defineConfig, devices } from '@playwright/test';
import { relayAddr } from './e2e/relay.js';
import { BRIDGE_SPECS, viaStream } from './e2e/bridge.js';

const port = Number(process.env.E2E_PORT || 4391);
// The bridge the bank-import spec starts (in test mode, against a fake
// Hibiscus). The app is built to call it there; the spec reads the same value.
process.env.E2E_BRIDGE_PORT ||= '4392';
const bridgePort = Number(process.env.E2E_BRIDGE_PORT);
// The UCEP spec's relay (e2e/relay.js, started in global-setup.js); the app is
// built to reach paired apps through it.
const relay = await relayAddr();

// E2E_BRIDGE_VIA=stream (#575): the specs that pair a bridge, with device sync
// on from the start, pairing by invitation, and every later call over the
// stream to the bridge's own node – HTTP to the bridge refused (e2e/bridge.js).
const streamOnly = viaStream
	? {
			testMatch: BRIDGE_SPECS.map((name) => `${name}.spec.js`),
			storageState: {
				cookies: [],
				origins: [
					{
						origin: `http://localhost:${port}`,
						localStorage: [{ name: 'belege.device-sync', value: 'on' }]
					}
				]
			}
		}
	: null;

export default defineConfig({
	testDir: 'e2e',
	...(streamOnly ? { testMatch: streamOnly.testMatch } : {}),
	globalSetup: './e2e/global-setup.js',
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 30_000 },
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		env: {
			VITE_E2E: 'true',
			VITE_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
			VITE_RELAY_ADDRS: relay
		},
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: {
		baseURL: `http://localhost:${port}`,
		// The suite reads German; with English complete, an English browser would start in English (#192).
		locale: 'de-DE',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'on-first-retry',
		...(streamOnly ? { storageState: streamOnly.storageState } : {})
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
