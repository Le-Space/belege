// Ported from Le-Space/simple-todo apps/invoice01 (playwright.config.js) at 56647d5.
// Changed: no relay and no shared e2e-kit server script; the app is built
// with VITE_E2E=true and served by `vite preview` on a port of its own, and
// Playwright never reuses a server it did not start (simple-todo#197: a
// suite once tested another branch's preview that happened to be running).
// Since UCEP: a circuit relay on this machine (e2e/relay.js, global-setup.js)
// for the invoicing-app spec; the app is built with its address.
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { parseShard, shardOf } from '../scripts/e2e-shards.mjs';
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

// E2E_SPECS=bridge: only the specs that pair a bridge, over HTTP – what CI
// runs for a pull request that changes the bridge and not the app
// (scripts/ci-changes.mjs). A push to main and a release run every spec.
const bridgeSpecsOnly = process.env.E2E_SPECS === 'bridge';
const everySpec = readdirSync(new URL('./e2e/', import.meta.url))
	.filter((file) => file.endsWith('.spec.js'))
	.map((file) => file.slice(0, -'.spec.js'.length))
	.sort();
const narrowed = streamOnly || bridgeSpecsOnly;
const specs = narrowed ? BRIDGE_SPECS.filter((name) => everySpec.includes(name)) : everySpec;

// E2E_SHARD=3/5: the third of five runners. The specs are dealt out by the
// time they take (e2e/durations.json, scripts/e2e-shards.mjs), so the runners
// finish together; Playwright's own --shard deals them out by count.
const shard = parseShard(process.env.E2E_SHARD);
const mine = shard
	? shardOf(
			specs,
			JSON.parse(readFileSync(new URL('./e2e/durations.json', import.meta.url), 'utf8')),
			shard
		)
	: specs;
// By the file's whole name: `export` is not `export-month`. A shard without a
// spec matches nothing (CI passes --pass-with-no-tests).
const testMatch =
	shard || narrowed
		? mine.length
			? mine.map((name) => new RegExp(`[\\\\/]e2e[\\\\/]${name}\\.spec\\.js$`))
			: [/^$/]
		: null;

export default defineConfig({
	testDir: 'e2e',
	...(testMatch ? { testMatch } : {}),
	globalSetup: './e2e/global-setup.js',
	// E2E_REPORT: also a JSON report, which CI keeps and reads for the tests
	// that passed only on a second try (scripts/e2e-report.mjs).
	...(process.env.E2E_REPORT
		? {
				reporter: [
					[process.env.CI ? 'dot' : 'list'],
					['json', { outputFile: process.env.E2E_REPORT }]
				]
			}
		: {}),
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
		// Two browsers of one test meet over WebRTC. Without a media permission
		// Chromium offers only the address of the default route; behind a VPN that
		// is the tunnel's, which does not reach itself, and the two never connect.
		// With one it offers every interface. The app never asks for a microphone.
		permissions: ['microphone'],
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'on-first-retry',
		...(streamOnly ? { storageState: streamOnly.storageState } : {})
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
