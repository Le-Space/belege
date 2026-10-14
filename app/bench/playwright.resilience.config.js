// The resilience benchmark (bench/resilience.bench.js): the E2E build served
// on a port of its own, the local test relay for the device scenarios, the
// test bridge's address baked in for the recovery scenario. Not part of
// `test:e2e` or CI: run it by hand with `pnpm bench:resilience`
// (docs/resilience-report.md).
import { defineConfig, devices } from '@playwright/test';
import { relayAddr } from '../e2e/relay.js';

const port = Number(process.env.BENCH_PORT || 4396);
process.env.E2E_BRIDGE_PORT ||= '4397';
const bridgePort = Number(process.env.E2E_BRIDGE_PORT);
// The relay the devices meet through: the local test relay (e2e/relay.js), or
// an outside one named by BENCH_RELAY_ADDR — a Le Space relay on Aleph, say —
// to measure a real relay's circuit limits rather than the library's defaults.
const relay = process.env.BENCH_RELAY_ADDR?.trim() || (await relayAddr());

export default defineConfig({
	testDir: '.',
	testMatch: 'resilience.bench.js',
	globalSetup: '../e2e/global-setup.js',
	retries: 0,
	workers: 1,
	timeout: 60 * 60 * 1000,
	expect: { timeout: 10 * 60 * 1000 },
	reporter: 'list',
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		cwd: '..',
		env: {
			VITE_E2E: 'true',
			VITE_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
			VITE_RELAY_ADDRS: relay
		},
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: { baseURL: `http://localhost:${port}`, locale: 'de-DE', trace: 'off', video: 'off' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
