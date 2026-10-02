#!/usr/bin/env node
// The bridge's own key for the backup on Aleph Cloud (issue #77):
//
//   pnpm setup:aleph          make the key, or show the address of the one there is
//   pnpm setup:aleph --new    replace it (backups kept so far stay with the old account)
//
// The key is made here, on this machine, and goes into the keychain (service
// `belege-bridge`, account `aleph-backup`) and nowhere else; it is never
// printed. What is printed is its address: the Aleph account that pays for
// keeping the backups. Put credits on it (app.aleph.cloud, "Credits"), or send
// it ALEPH, or let a funded account pay for it – nothing else needs this key.
//
// Only `alephBackup.configured` goes to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import { addressOf, isBackupKey, newBackupKey } from './aleph-backup.js';
import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { systemKeychain } from './keychain.js';
import { ask, closePrompts } from './prompt.js';
import { yes } from './setup-secret.js';

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {boolean} [deps.replace] `--new`
 * @param {() => string} [deps.makeKey]
 * @returns {Promise<boolean>} whether a key is in place now
 */
export async function runAlephSetup({
	io,
	keychain,
	configPath,
	replace = false,
	makeKey = newBackupKey
}) {
	const config = await loadConfig(configPath);
	const stored = await keychain.read().then(
		(k) => (isBackupKey(k) ? String(k).trim() : null),
		() => null
	);

	if (stored && !replace) {
		if (!config.alephBackup.configured) {
			config.alephBackup = { configured: true };
			await saveConfig(config, configPath);
		}
		io.print(`The backup key is in the keychain. Its Aleph account: ${addressOf(stored)}`);
		io.print('`pnpm setup:aleph --new` replaces it.');
		return true;
	}
	if (stored && replace) {
		io.print(
			'A new key means a new Aleph account. Backups kept so far stay with the old one, and are kept only while it has credits.'
		);
		if (!yes((await io.ask('Replace the backup key? [y/N]: ')) || 'n')) {
			io.print('Nothing changed.');
			return true;
		}
	}

	const key = makeKey();
	await keychain.write(key);
	config.alephBackup = { configured: true };
	await saveConfig(config, configPath);
	io.print(
		'A backup key is made and stored in the keychain (service belege-bridge, account aleph-backup).'
	);
	io.print(`Its Aleph account: ${addressOf(key)}`);
	io.print(
		'Aleph keeps a backup only while this account can pay: put credits on it (app.aleph.cloud → Credits) or send it ALEPH.'
	);
	io.print(`Saved ${configPath}. Restart the bridge (pnpm bridge) to use it.`);
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const ok = await runAlephSetup({
			io: { ask, print: (line) => console.log(line) },
			keychain: systemKeychain({ account: 'aleph-backup' }),
			configPath: defaultConfigPath(),
			replace: process.argv.includes('--new')
		});
		closePrompts();
		process.exit(ok ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
