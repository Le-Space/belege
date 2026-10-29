// The demo recordings (e2e-video/): the app built as for the specs, one
// browser at 1920×1080, English, and a video of every page. Not part of
// `pnpm test:e2e`; run with `pnpm exec playwright test -c playwright.video.config.js`.
import { defineConfig, devices } from '@playwright/test';
import { relayAddr } from './e2e/relay.js';

const port = Number(process.env.E2E_PORT || 4391);
process.env.E2E_BRIDGE_PORT ||= '4392';
const bridgePort = Number(process.env.E2E_BRIDGE_PORT);
const relay = await relayAddr();
// A 1080p frame of a 1080p viewport. The page itself is enlarged 1.5× by the
// scene kit (root font size, DEMO_ZOOM): Playwright records a viewport as it
// is and never scales it up, and the app is laid out for a laptop, not for a
// 1920-wide window.
const viewport = { width: 1920, height: 1080 };
const size = viewport;

export default defineConfig({
	testDir: 'e2e-video',
	outputDir: 'e2e-video/results',
	globalSetup: './e2e/global-setup.js',
	retries: 0,
	workers: 1,
	timeout: 900_000,
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
		// A target that never appears fails in half a minute, not after the
		// whole scene's budget — the video would be 15 minutes of nothing.
		actionTimeout: 30_000,
		// DEMO_LANG=de records the German app; the scenes pick their lines by it.
		locale: process.env.DEMO_LANG === 'de' ? 'de-DE' : 'en-GB',
		viewport,
		video: { mode: 'on', size },
		screenshot: 'off',
		trace: 'off'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } }]
});
