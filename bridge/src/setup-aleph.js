#!/usr/bin/env node
// The bridge's own key for the backup on Aleph Cloud (issue #77):
//
//   pnpm setup:aleph          make the key, or show the address of the one there is
//   pnpm setup:aleph --new    replace it (backups kept so far stay with the old account)
//
// And the keys this account lets keep backups at its expense, so that an
// application backs up from the browser without the bridge running
// (Le-Space/invoice#28, orbitdb-storage-bridge#147):
//
//   pnpm setup:aleph -- --grants                              list them
//   pnpm setup:aleph -- --authorize <address> --channel <C>   let that key send STORE on channel C
//   pnpm setup:aleph -- --revoke <address>                    take it back
//
// A grant is an entry in the account's `security` aggregate on Aleph, signed
// with this key: STORE only, on the named channel only. Aleph then charges
// this account for what that key keeps (measured 2026-10-03). The address
// comes from the application that holds the other key; it is public.
//
// The key is made here, on this machine, and goes into the keychain (service
// `belege-bridge`, account `aleph-backup`) and nowhere else; it is never
// printed. What is printed is its address: the Aleph account that pays for
// keeping the backups. Put credits on it (app.aleph.cloud, "Credits"), or send
// it ALEPH, or let a funded account pay for it – nothing else needs this key.
//
// Only `alephBackup.configured` goes to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import {
	createAlephAuthorizer,
	waitForMessage
} from '@le-space/orbitdb-storage-bridge/backends/aleph-pin';

import { addressOf, isBackupKey, newBackupKey, personalSign } from './aleph-backup.js';
import { toChecksumAddress } from './chains/evm.js';
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

/** An Aleph channel as applications name theirs: `BELEGE-BACKUP`, `INVOICE-BACKUP`. */
const CHANNEL = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

/** @param {any} grant */
const describe = (grant) =>
	`${grant.address}  ${(grant.types ?? ['every type']).join(',')}  on ${(grant.channels ?? ['every channel']).join(',')}`;

/**
 * List, give or take back the keys that may keep backups at this account's
 * expense: entries in its `security` aggregate on Aleph, signed with the
 * bridge's backup key. A grant is STORE only, on one channel; granting a key
 * another channel adds that channel to its grant.
 *
 * @param {object} deps
 * @param {{ print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {'grants' | 'authorize' | 'revoke'} deps.action
 * @param {string} [deps.address] the other key's address (authorize, revoke)
 * @param {string} [deps.channel] the channel it may send STORE on (authorize)
 * @param {string} [deps.apiHost] the Aleph API; tests point it at a fake
 * @param {typeof fetch} [deps.fetch]
 * @param {{ timeout?: number, interval?: number }} [deps.settle] how long the grant is followed
 * @returns {Promise<boolean>}
 */
export async function runAlephGrants({
	io,
	keychain,
	action,
	address,
	channel,
	apiHost,
	fetch: f = fetch,
	settle = {}
}) {
	const key = await keychain.read().then(
		(k) => (isBackupKey(k) ? String(k).trim() : null),
		() => null
	);
	if (!key) {
		io.print('There is no backup key yet: run `pnpm setup:aleph` first.');
		return false;
	}
	const owner = addressOf(key);
	const authorizer = createAlephAuthorizer({
		owner,
		sign: async (_address, message) => personalSign(key, message),
		apiHost,
		fetch: f
	});
	const show = async () => {
		const grants = await authorizer.read();
		if (grants.length === 0) io.print(`No other key may keep backups for ${owner}.`);
		else {
			io.print(`Keys that may keep backups for ${owner}:`);
			for (const grant of grants) io.print(`  ${describe(grant)}`);
		}
	};

	if (action === 'grants') {
		await show();
		return true;
	}

	if (!/^0x[0-9a-fA-F]{40}$/.test(String(address ?? ''))) {
		io.print(
			'That is not an address: 0x and 40 hexadecimal characters, as the application shows it.'
		);
		return false;
	}
	const other = toChecksumAddress(String(address));
	if (other === owner) {
		io.print('That is this account itself; it needs no grant.');
		return false;
	}

	let sent;
	if (action === 'authorize') {
		if (!CHANNEL.test(String(channel ?? ''))) {
			io.print('Name the channel the key may use, e.g. `--channel INVOICE-BACKUP`.');
			return false;
		}
		const current = (await authorizer.read()).find(
			(g) => String(g.address).toLowerCase() === other.toLowerCase()
		);
		const channels = [...new Set([...(current?.channels ?? []), String(channel)])];
		sent = await authorizer.authorize({ address: other, types: ['STORE'], channels, chain: 'ETH' });
	} else {
		sent = await authorizer.revoke(other);
	}
	const final =
		sent.status === 'pending'
			? await waitForMessage(sent.itemHash, { apiHost, fetch: f, ...settle })
			: sent;
	if (final.status !== 'processed') {
		io.print(
			`Aleph has not taken the change (${final.status}). Nothing is granted or taken back yet.`
		);
		return false;
	}
	io.print(
		action === 'authorize'
			? `${other} may now keep backups on ${channel} at this account's expense.`
			: `${other} may no longer keep backups for this account.`
	);
	await show();
	return true;
}

/** @param {string[]} argv @param {string} flag */
const valueOf = (argv, flag) => {
	const at = argv.indexOf(flag);
	return at >= 0 ? argv[at + 1] : undefined;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const argv = process.argv.slice(2);
	const action = argv.includes('--grants')
		? 'grants'
		: argv.includes('--authorize')
			? 'authorize'
			: argv.includes('--revoke')
				? 'revoke'
				: null;
	if (action) {
		try {
			const ok = await runAlephGrants({
				io: { print: (line) => console.log(line) },
				keychain: systemKeychain({ account: 'aleph-backup' }),
				action,
				address: valueOf(argv, `--${action}`),
				channel: valueOf(argv, '--channel')
			});
			process.exit(ok ? 0 : 1);
		} catch (/** @type {any} */ error) {
			console.error(`Failed: ${error.message}`);
			process.exit(1);
		}
	}
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
