// The production build, as deploy.yml makes it, in a browser (#536): built
// without VITE_E2E, so the page has no test hook to ask and the spec gets by
// with what a person has – the passkey, the page, a file.
//
//   pnpm --filter @belege/app run test:production
//
// A config of its own: the suite in e2e/ needs the hooks of the E2E build
// (playwright.config.js), this one must not have them. One spec.
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PRODUCTION_PORT || 4398);

export default defineConfig({
	testDir: 'e2e-production',
	outputDir: 'test-results/production',
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 30_000 },
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		// Empty, whatever the shell that starts this has set: not an E2E build.
		env: { VITE_E2E: '' },
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: {
		baseURL: `http://localhost:${port}`,
		locale: 'de-DE',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
