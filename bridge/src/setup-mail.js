#!/usr/bin/env node
// Set the bridge up for the receipt mailbox:
//
//   pnpm setup:mail
//
// 1. IMAP host, port and user (defaults from IMAP_* in the repo's .env, if any).
// 2. The accounting address receipts are sent to (default buchhaltung@le-space.de).
// 3. The password or Mailu auth token, from a hidden prompt, into the macOS
//    keychain (service `belege-bridge`, account `imap`). Never argv, never a
//    file. IMAP_PASSWORD from .env is offered instead, once.
// 4. Optionally, one test login that counts the folders.
//
// Non-secret settings go to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import { DEFAULT_ACCOUNTING_ADDRESS, defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { macosKeychain } from './keychain.js';
import { createMailClient } from './mail/imap.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret, yes } from './setup-secret.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {Record<string, string | undefined>} [deps.env] IMAP_* from the repo's .env
 * @param {typeof createMailClient} [deps.mailClient]
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runMailSetup({
	io,
	keychain,
	configPath,
	env = {},
	mailClient = createMailClient
}) {
	const config = await loadConfig(configPath);
	const m = config.mail;

	const hostDefault = m.host ?? env.IMAP_HOST ?? '';
	const host =
		(await io.ask(`IMAP host${hostDefault ? ` [${hostDefault}]` : ''}: `)) || hostDefault;
	if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) {
		io.print(`Not a host name: ${host || '(empty)'}`);
		return false;
	}
	const portDefault = m.host ? m.port : Number(env.IMAP_PORT || m.port);
	const portAnswer = await io.ask(`IMAP port [${portDefault}]: `);
	const port = portAnswer ? Number(portAnswer) : portDefault;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		io.print(`Not a port: ${portAnswer}`);
		return false;
	}
	/** @type {'implicit' | 'starttls' | 'none'} */
	let tls = port === 993 ? 'implicit' : 'starttls';
	if (LOOPBACK_HOSTS.has(host)) {
		// Only a server on this machine (a test server) may go without TLS.
		if (yes((await io.ask('Server on this machine: without TLS? [y/N]: ')) || 'n')) tls = 'none';
	}
	const userDefault = m.user ?? env.IMAP_USER ?? '';
	const user =
		(await io.ask(`IMAP user${userDefault ? ` [${userDefault}]` : ''}: `)) || userDefault;
	if (!user) {
		io.print('An IMAP user is needed.');
		return false;
	}
	const addressDefault =
		(m.host ? m.accountingAddress : env.IMAP_ACCOUNTING_ADDRESS) ||
		m.accountingAddress ||
		DEFAULT_ACCOUNTING_ADDRESS;
	const address = (
		(await io.ask(`Accounting address receipts are sent to [${addressDefault}]: `)) ||
		addressDefault
	)
		.trim()
		.toLowerCase();
	if (!EMAIL.test(address)) {
		io.print(`Not an e-mail address: ${address}`);
		return false;
	}

	const stored = await storeSecret({
		io,
		keychain,
		what: 'IMAP password or auth token',
		account: 'imap',
		envName: 'IMAP_PASSWORD',
		envValue: env.IMAP_PASSWORD
	});
	if (!stored) return false;

	config.mail = { ...m, host, port, tls, user, accountingAddress: address };
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath}`);
	io.print('Restart the bridge (pnpm bridge) to use it.');

	if (yes((await io.ask('Test the login now? [y/N]: ')) || 'n')) {
		const client = mailClient({ config: config.mail, getPassword: () => keychain.read() });
		const { folders } = await client.check();
		io.print(`Logged in: ${folders} folder(s). Nothing was read.`);
	}
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, IMAP_ACCOUNTING_ADDRESS } = process.env;
	try {
		const saved = await runMailSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'imap' }),
			configPath: defaultConfigPath(),
			env: { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, IMAP_ACCOUNTING_ADDRESS }
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
