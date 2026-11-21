// The bridge a spec runs against: the real one, in test mode, in a directory
// of its own, on the port the app was built for (playwright.config.js).
//
//   let bridge;
//   test.beforeAll(async () => {
//     bridge = await startBridge({ name: 'wallets', env: { BELEGE_BRIDGE_TEST_…: … } });
//   });
//   test.afterAll(() => bridge?.stop());
//   …
//   await pairBridge(page, bridge);
//
// Every spec that pairs a bridge wrote these lines out itself, each a little
// differently; some stopped the bridge without waiting for it. Apart from
// bridge.js, which playwright.config.js imports: this file loads the bridge's
// own code (its config), which the config has no use for.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { stopBridge } from './bridge.js';

/** The bridge's HTTP port: what the app was built to call. */
export const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
/** The app's origin: the one a bridge of a spec lets in. */
export const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
/** The bridge's command line. */
export const BRIDGE_CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/**
 * @typedef {object} StartedBridge
 * @property {import('node:child_process').ChildProcess} child
 * @property {string} dir the bridge's own directory; gone after `stop`
 * @property {string} configPath its `bridge.json`
 * @property {number} port
 * @property {() => string} out everything it printed so far, stdout and stderr
 * @property {() => string} code its pairing code; throws when it printed none
 * @property {() => Promise<void>} stop stops it, waits for it, removes `dir`
 */

/**
 * Starts a bridge in test mode and waits until it is ready.
 *
 * @param {object} p
 * @param {string} p.name for the directory's name: the spec's
 * @param {Record<string, any> | ((dir: string) => Record<string, any>)} [p.config]
 *   what the config has beside the defaults, the port and the app's origin;
 *   a function when it needs the directory
 * @param {Record<string, string | undefined>} [p.env] added to this process's environment
 * @param {string[]} [p.args] further arguments, e.g. `--pair`
 * @param {(at: { dir: string, configPath: string }) => Promise<void> | void} [p.before]
 *   runs when the config is written and the bridge not yet started: for what
 *   has to lie beside it, e.g. a sealed key
 * @param {string} [p.mode] `--test-mode`, or `--hosted`
 * @param {RegExp} [p.ready] what it prints when it is ready
 * @param {number} [p.timeout] how long to wait for that
 * @param {number} [p.port]
 * @returns {Promise<StartedBridge>}
 */
export async function startBridge({
	name,
	config = {},
	env = {},
	args = [],
	before,
	mode = '--test-mode',
	ready = /Pairing code/,
	timeout = 20_000,
	port = BRIDGE_PORT
}) {
	const dir = await mkdtemp(join(tmpdir(), `belege-e2e-${name}-`));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port },
			appOrigins: [APP_ORIGIN],
			...(typeof config === 'function' ? config(dir) : config)
		},
		configPath
	);
	await before?.({ dir, configPath });
	const child = spawn(process.execPath, [BRIDGE_CLI, mode, ...args, '--config', configPath], {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let printed = '';
	child.stdout?.on('data', (d) => (printed += d));
	child.stderr?.on('data', (d) => (printed += d));
	/** @type {StartedBridge} */
	const started = {
		child,
		dir,
		configPath,
		port,
		out: () => printed,
		code() {
			const m = /Pairing code[^:]*: (\S+)/.exec(printed);
			if (!m) throw new Error(`no pairing code in the bridge output:\n${printed}`);
			return m[1];
		},
		async stop() {
			await stopBridge(child);
			// The bridge's node may still let go of its files for a moment.
			await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		}
	};
	try {
		await expect.poll(() => printed, { timeout }).toMatch(ready);
	} catch (cause) {
		// A bridge that never got ready must not keep the port for the next spec.
		await started.stop();
		throw cause;
	}
	return started;
}
