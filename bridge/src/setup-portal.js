#!/usr/bin/env node
// Optional: let the bridge fill a customer portal's login form itself.
//
//   pnpm setup:portal vodafone
//
// 1. The user name (or e-mail) for the portal, into bridge.json.
// 2. The password, from a hidden prompt, into the macOS keychain (service
//    `belege-bridge`, account `portal:vodafone`). "-" stores none: you then
//    type it in the portal's window at every login.
//
// A one-time code (SMS, e-mail) and a bot check are always yours, in the
// window the bridge opens. Nothing here is needed to log in by hand.

import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { macosKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { storeSecret } from './setup-secret.js';
import { RECIPES, keychainAccount } from './portals/index.js';

/**
 * @param {object} deps
 * @param {string} deps.portal
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @returns {Promise<boolean>}
 */
export async function runPortalSetup({ portal, io, keychain, configPath }) {
	if (!Object.hasOwn(RECIPES, portal)) {
		io.print(
			`Unknown portal ${JSON.stringify(portal)}. Known: ${Object.keys(RECIPES).join(', ')}.`
		);
		return false;
	}
	const name = RECIPES[/** @type {keyof typeof RECIPES} */ (portal)].name;
	const config = await loadConfig(configPath);
	const current = config.portals[portal] ?? {};

	io.print(
		`${name}: the bridge can fill the login form for you. A code or a bot check stays yours.`
	);
	const userDefault = current.username ?? '';
	const username = (
		(await io.ask(`User name or e-mail${userDefault ? ` [${userDefault}]` : ''}: `)) || userDefault
	).trim();
	if (!username || username.length > 200 || /[\r\n]/.test(username)) {
		io.print('A user name is needed (one line).');
		return false;
	}

	const answer = await io.ask(
		'Store the password in the keychain? [Y/n] ("n": you type it at every login): '
	);
	let passwordStored = false;
	if (!/^(n|no|nein)$/i.test(answer.trim())) {
		passwordStored = await storeSecret({
			io,
			keychain,
			what: `${name} password`,
			account: keychainAccount(portal)
		});
	}

	config.portals = { ...config.portals, [portal]: { ...current, username, passwordStored } };
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath}${passwordStored ? '' : ' (no password stored)'}.`);
	io.print('Restart the bridge (pnpm bridge), then Integrationen → Kundenportale → Anmelden.');
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const portal = process.argv[2] ?? '';
	try {
		const saved = await runPortalSetup({
			portal,
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: keychainAccount(portal) }),
			configPath: defaultConfigPath()
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
