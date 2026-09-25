#!/usr/bin/env node
// Start the bridge.
//
//   pnpm --filter @belege/bridge start            # prints a pairing code until one client is paired
//   pnpm --filter @belege/bridge start -- --pair  # a new code, to pair another browser
//
//   pnpm --filter @belege/bridge start -- --list-pairings | --revoke <n> | --revoke-all
//                                                  # manage paired devices, then exit (pairings.js)
//
// Options: --config <path> (default ~/.config/belege/bridge.json or
// $BELEGE_BRIDGE_CONFIG), --port <n>.
//
// --test-mode is for the E2E suite: the secrets come from environment
// variables instead of the keychain ($BELEGE_BRIDGE_TEST_PASSWORD for Hibiscus,
// $BELEGE_BRIDGE_TEST_IMAP_PASSWORD, $BELEGE_BRIDGE_TEST_LLM_KEY,
// $BELEGE_BRIDGE_TEST_PORTAL_PASSWORD), portal browsers never open a window,
// the portal password dialog never opens either (it answers
// $BELEGE_BRIDGE_TEST_PORTAL_DIALOG, or is cancelled without it), and it
// refuses to run on the real config file.

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './index.js';
import { defaultConfigPath } from './config.js';
import { memoryKeychain } from './keychain.js';
import { managePairings } from './pairings.js';

const args = process.argv.slice(2);
/** @param {string} name */
const value = (name) => {
	const i = args.indexOf(name);
	return i > -1 ? args[i + 1] : undefined;
};

const testMode = args.includes('--test-mode');
const configPath = resolve(value('--config') ?? defaultConfigPath());
const port = value('--port') ? Number(value('--port')) : undefined;

const pairingAction = args.includes('--list-pairings')
	? 'list'
	: args.includes('--revoke-all')
		? 'revoke-all'
		: args.includes('--revoke')
			? 'revoke'
			: null;
if (pairingAction) {
	process.exit(
		await managePairings({
			configPath,
			action: pairingAction,
			index: Number(value('--revoke'))
		})
	);
}

let keychain;
let mailKeychain;
let llmKeychain;
/** @type {((id: string) => import('./keychain.js').Keychain) | undefined} */
let portalKeychain;
/** @type {import('./portals/credentials.js').AskPassword | undefined} */
let portalPasswordDialog;
if (testMode) {
	if (configPath === join(homedir(), '.config', 'belege', 'bridge.json')) {
		console.error(
			'--test-mode refuses the real config file; pass --config or BELEGE_BRIDGE_CONFIG.'
		);
		process.exit(1);
	}
	console.error('[bridge] TEST MODE: secrets from BELEGE_BRIDGE_TEST_*, not the keychain.');
	keychain = memoryKeychain(process.env.BELEGE_BRIDGE_TEST_PASSWORD ?? null);
	mailKeychain = memoryKeychain(process.env.BELEGE_BRIDGE_TEST_IMAP_PASSWORD ?? null, 'imap');
	llmKeychain = memoryKeychain(process.env.BELEGE_BRIDGE_TEST_LLM_KEY ?? null, 'llm');
	const portalPassword = memoryKeychain(process.env.BELEGE_BRIDGE_TEST_PORTAL_PASSWORD ?? null);
	portalKeychain = () => portalPassword;
	portalPasswordDialog = async () => process.env.BELEGE_BRIDGE_TEST_PORTAL_DIALOG ?? null;
}

try {
	const bridge = await startBridge({
		configPath,
		keychain,
		mailKeychain,
		llmKeychain,
		portalKeychain,
		portalPasswordDialog,
		// Test mode: a new portal may start on a fake portal on this machine.
		portalLoopback: testMode,
		portalHeadless: testMode ? 'always' : 'auto',
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
