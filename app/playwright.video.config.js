// The demo recordings (e2e-video/): the app built as for the specs, one
// browser at 1920×1080, English, and a video of every page. Not part of
// `pnpm test:e2e`; run with `pnpm exec playwright test -c playwright.video.config.js`.
import { defineConfig, devices } from '@playwright/test';
import { relayAddr } from './e2e/relay.js';

const port = Number(process.env.E2E_PORT || 4391);
process.env.E2E_BRIDGE_PORT ||= '4392';
const bridgePort = Number(process.env.E2E_BRIDGE_PORT);
const relay = await relayAddr();
// A frame of the viewport's own size: Playwright records a viewport as it is
// and never scales it up. DEMO_RES is the frame height (1080 by default; 1440
// or 2160 for a sharper film — YouTube gives a 1080p upload a thin bitrate,
// text stays crisp only from 1440p up). The app is laid out for a laptop, not
// for a wide window, so the scene kit enlarges the page (root font size,
// 1.5× at 1080p, and with the frame: DEMO_ZOOM), and sizes its captions,
// pointer and cards the same way.
const height = Number(process.env.DEMO_RES || 1080);
const viewport = { width: Math.round((height * 16) / 9), height };
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
