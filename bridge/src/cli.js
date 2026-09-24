#!/usr/bin/env node
// Start the bridge.
//
//   pnpm --filter @belege/bridge start            # prints a pairing code until one client is paired
//   pnpm --filter @belege/bridge start -- --pair  # a new code, to pair another browser
//
// Options: --config <path> (default ~/.config/belege/bridge.json or
// $BELEGE_BRIDGE_CONFIG), --port <n>.
//
// --test-mode is for the E2E suite: the master password comes from
// $BELEGE_BRIDGE_TEST_PASSWORD instead of the keychain, and it refuses to run
// on the real config file.

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './index.js';
import { defaultConfigPath } from './config.js';
import { memoryKeychain } from './keychain.js';

const args = process.argv.slice(2);
/** @param {string} name */
const value = (name) => {
	const i = args.indexOf(name);
	return i > -1 ? args[i + 1] : undefined;
};

const testMode = args.includes('--test-mode');
const configPath = resolve(value('--config') ?? defaultConfigPath());
const port = value('--port') ? Number(value('--port')) : undefined;

let keychain;
if (testMode) {
	if (configPath === join(homedir(), '.config', 'belege', 'bridge.json')) {
		console.error(
			'--test-mode refuses the real config file; pass --config or BELEGE_BRIDGE_CONFIG.'
		);
		process.exit(1);
	}
	console.error('[bridge] TEST MODE: password from BELEGE_BRIDGE_TEST_PASSWORD, not the keychain.');
	keychain = memoryKeychain(process.env.BELEGE_BRIDGE_TEST_PASSWORD ?? null);
}

try {
	const bridge = await startBridge({
		configPath,
		keychain,
		port,
		forcePairingCode: args.includes('--pair')
	});
	const stop = async () => {
		await bridge.close();
		process.exit(0);
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
} catch (/** @type {any} */ error) {
	console.error(`Cannot start the bridge: ${error.message}`);
	process.exit(1);
}
