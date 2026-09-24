// Ported from Le-Space/simple-todo apps/invoice01 (playwright.config.js) at 56647d5.
// Changed: no relay and no shared e2e-kit server script; the app is built
// with VITE_E2E=true and served by `vite preview` on a port of its own, and
// Playwright never reuses a server it did not start (simple-todo#197: a
// suite once tested another branch's preview that happened to be running).
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 4391);

export default defineConfig({
	testDir: 'e2e',
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 30_000 },
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		env: { VITE_E2E: 'true' },
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: {
		baseURL: `http://localhost:${port}`,
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
