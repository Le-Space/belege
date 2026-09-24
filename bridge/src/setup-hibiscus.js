#!/usr/bin/env node
// Set the bridge up for a local Hibiscus:
//
//   pnpm --filter @belege/bridge setup:hibiscus
//
// 1. Host and port of Jameica's web server (loopback only).
// 2. Its certificate fingerprint, shown for you to compare with Jameica's and
//    pinned on "yes" (trust on first use). Nothing is sent before that.
// 3. The IBAN suffixes that may leave the bridge; every other account stays in.
// 4. The Hibiscus master password, from a hidden prompt, into the macOS
//    keychain (service `belege-bridge`, account `hibiscus`). Never argv, never a file.
// 5. Optionally, one test call that lists how many accounts are allowed.
//
// Non-secret settings go to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { createHibiscusClient, normalizeFingerprint, peerFingerprint } from './hibiscus.js';
import { macosKeychain } from './keychain.js';
import { ibanAllowed, maskIban } from './normalize.js';
import { ask, askHidden, closePrompts } from './prompt.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** @param {string} answer */
const yes = (answer) => /^(y|yes|j|ja)$/i.test(answer.trim());

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {typeof peerFingerprint} [deps.fingerprintOf]
 * @param {string} [deps.envPassword] HIBISCUS_PASSWORD from the repo's .env (phase 0), offered once
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runSetup({
	io,
	keychain,
	configPath,
	fingerprintOf = peerFingerprint,
	envPassword
}) {
	const config = await loadConfig(configPath);
	const h = config.hibiscus;

	const host = (await io.ask(`Hibiscus host [${h.host}]: `)) || h.host;
	if (!LOOPBACK_HOSTS.has(host)) {
		io.print(
			`Refusing ${host}: the master password only goes to Jameica on this machine (127.0.0.1).`
		);
		return false;
	}
	const portAnswer = await io.ask(`Hibiscus port [${h.port}]: `);
	const port = portAnswer ? Number(portAnswer) : h.port;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		io.print(`Not a port: ${portAnswer}`);
		return false;
	}

	// Trust on first use: show, compare, pin. Only a TLS handshake so far.
	const seen = normalizeFingerprint(await fingerprintOf({ host, port }));
	io.print(`\nCertificate fingerprint (SHA-256) presented by ${host}:${port}:\n  ${seen}\n`);
	if (
		h.certSha256 &&
		normalizeFingerprint(h.certSha256) === seen &&
		h.host === host &&
		h.port === port
	) {
		io.print('Same as the pinned one.');
	} else {
		if (h.certSha256) io.print('This is NOT the fingerprint pinned so far.');
		io.print('Compare it with the one Jameica shows for its web server certificate.');
		if (!yes(await io.ask('Does it match? [y/N]: '))) {
			io.print('Nothing stored. Run this again once you have checked the certificate.');
			return false;
		}
	}

	const current = h.ibanSuffixes.join(',');
	const suffixAnswer = await io.ask(
		`IBAN suffixes that may leave the bridge, comma-separated (e.g. the last 4 digits)${current ? ` [${current}]` : ''}: `
	);
	const suffixes = (suffixAnswer || current)
		.split(',')
		.map((s) => s.replace(/\s/g, '').toUpperCase())
		.filter(Boolean);
	if (!suffixes.length || suffixes.some((s) => !/^[0-9A-Z]{4,34}$/.test(s))) {
		io.print(
			'At least one suffix of 4 or more letters/digits is needed; without it no account leaves the bridge.'
		);
		return false;
	}

	const origins = config.appOrigins.join(',');
	const originAnswer = await io.ask(`App origins allowed to call the bridge [${origins}]: `);
	const appOrigins = (originAnswer || origins)
		.split(',')
		.map((s) => s.trim().replace(/\/$/, ''))
		.filter(Boolean);
	for (const origin of appOrigins) {
		let ok = false;
		try {
			ok = new URL(origin).origin === origin;
		} catch {}
		if (!ok) {
			io.print(`Not an origin: ${origin}`);
			return false;
		}
	}

	const stored = await keychain.read().then(
		() => true,
		() => false
	);
	let password = '';
	if (!stored && envPassword) {
		// The phase-0 spikes read it from .env; move it where the bridge looks.
		if (
			yes(
				(await io.ask('HIBISCUS_PASSWORD found in .env. Store it in the keychain? [Y/n]: ')) || 'y'
			)
		) {
			password = envPassword;
		}
	}
	// Empty keeps the stored password – but only when there is one. The first
	// run used to offer that too, and a plain Enter ended the setup with an error.
	for (let tries = 0; !password && tries < 3; tries++) {
		password = await io.askHidden(
			stored
				? 'Jameica master password (hidden; empty keeps the stored one): '
				: 'Jameica master password (hidden; none is stored yet): '
		);
		if (!password && stored) break;
		if (!password) io.print('No password is stored yet, so it cannot be kept – please type it.');
	}
	if (password) {
		await keychain.write(password);
		io.print('Password stored in the keychain (service belege-bridge, account hibiscus).');
		if (password === envPassword) {
			io.print(
				'You can now delete HIBISCUS_PASSWORD from .env: the bridge reads only the keychain.'
			);
		}
	} else if (stored) {
		io.print('Keeping the password already in the keychain.');
	} else {
		io.print('Nothing stored: no password given.');
		return false;
	}

	config.hibiscus = { host, port, certSha256: seen, ibanSuffixes: suffixes };
	config.appOrigins = appOrigins;
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath}`);

	if (yes((await io.ask('Test the connection now? [y/N]: ')) || 'n')) {
		const client = createHibiscusClient({
			host,
			port,
			certSha256: seen,
			getPassword: () => keychain.read()
		});
		const all = await client.accounts();
		const allowed = all.filter((k) => ibanAllowed(k.iban, suffixes));
		io.print(`${all.length} account(s) in Hibiscus, ${allowed.length} allowed:`);
		for (const k of allowed) io.print(`  ${maskIban(k.iban)}`);
	}
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const configPath = defaultConfigPath();
	try {
		process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
	} catch {
		// no .env: nothing to offer
	}
	try {
		const saved = await runSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain(),
			configPath,
			envPassword: process.env.HIBISCUS_PASSWORD || undefined
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
