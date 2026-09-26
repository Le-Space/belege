// The books benchmark (bench/books.bench.js): the E2E build, served on a
// port of its own, one worker, long timeouts. Not part of `test:e2e` or CI:
// run it by hand with `pnpm bench:books` (docs/performance.md).
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.BENCH_PORT || 4395);

export default defineConfig({
	testDir: '.',
	testMatch: '*.bench.js',
	retries: 0,
	workers: 1,
	// 50 000 bookings take a while to write, let alone to read.
	timeout: 4 * 60 * 60 * 1000,
	expect: { timeout: 30 * 60 * 1000 },
	reporter: 'list',
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		cwd: '..',
		env: { VITE_E2E: 'true', VITE_BRIDGE_URL: 'http://127.0.0.1:1' },
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: { baseURL: `http://localhost:${port}`, trace: 'off', video: 'off' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
