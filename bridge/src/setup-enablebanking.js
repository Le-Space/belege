#!/usr/bin/env node
// Connect the bridge to your own Enable Banking application (issue #224):
//
//   pnpm setup:enablebanking
//
// 1. In Enable Banking's Control Panel, register an application. Its redirect
//    URL is the app's page `https://belege.le-space.de/integrationen/bank/verbunden`
//    (or the same page on your own domain), environment Production. Link your
//    own accounts there ("Link accounts"): that activates the application in
//    restricted mode, for exactly those accounts. The panel either makes the key in
//    the browser and hands out a private key file (.pem) to download, or takes
//    a certificate of your own (`openssl req -x509 -newkey rsa:4096 -nodes
//    -keyout private.key -out public.crt …`): then the .crt goes to the panel
//    and private.key is the file asked for here.
// 2. This asks for the id, the path of the key file and the redirect URL
//    (EB_APP_ID, EB_KEY_PATH and EB_REDIRECT_URL from the repo's .env are
//    offered as defaults; none of them is secret).
// 3. A test call (GET /application) says whether the key is accepted, which
//    environment it is, whether the application is active yet, and whether
//    the redirect URL is registered.
// 4. The key is sealed into a file beside the configuration; the key to that
//    file goes into the keychain or the Windows Credential Manager
//    (sealed-file.js). The key file you downloaded is not changed: keep it
//    somewhere safe, Enable Banking cannot hand it out again.
//
// Then link a bank in the app, and say which of its accounts may leave the
// bridge:
//
//   pnpm setup:enablebanking -- --accounts
//
// Only `enablebanking.{configured, appId, redirectUrl, ibanSuffixes}` goes to
// ~/.config/belege/bridge.json (0600). The key is never printed.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, redirectUrlOf, saveConfig } from './config.js';
import {
	createEnableBankingClient,
	EnableBankingError,
	enableBankingSecrets,
	isApplicationId,
	parsePrivateKey
} from './enablebanking.js';
import { systemKeychain } from './keychain.js';
import { ask, closePrompts } from './prompt.js';
import { loadRepoEnv } from './setup-secret.js';

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain the key to the sealed file
 * @param {string} deps.configPath
 * @param {(path: string) => Promise<string>} [deps.readKeyFile]
 * @param {(params: { appId: string, privateKey: string, baseUrl: string }) => Promise<import('./enablebanking.js').Application>} [deps.check]
 * @param {{ EB_APP_ID?: string, EB_KEY_PATH?: string, EB_REDIRECT_URL?: string }} [deps.env]
 * @returns {Promise<boolean>} true when the key was sealed and the configuration saved
 */
export async function runEnableBankingSetup({
	io,
	keychain,
	configPath,
	readKeyFile = (path) => readFile(path, 'utf8'),
	check = testCall,
	env = {}
}) {
	const config = await loadConfig(configPath);
	const current = config.enablebanking;
	io.print('Your own Enable Banking application: its id, its private key file, its redirect URL.');

	const idDefault = current.appId ?? env.EB_APP_ID?.trim() ?? '';
	const appId = (
		(await io.ask(`Application id${idDefault ? ` [${idDefault}]` : ''}: `)) || idDefault
	).trim();
	if (!isApplicationId(appId)) {
		io.print('That is not an application id (as the Control Panel shows it); nothing changed.');
		return false;
	}

	const pathDefault = env.EB_KEY_PATH?.trim() ?? '';
	const keyPath = (
		(await io.ask(
			`Path of the private key file (.pem or .key, not the .crt)${pathDefault ? ` [${pathDefault}]` : ''}: `
		)) || pathDefault
	)
		.trim()
		// A file dragged into the terminal comes quoted, or with escaped spaces.
		.replace(/^(['"])(.*)\1$/, '$2')
		.replace(/\\ /g, ' ')
		.replace(/^(~|\$HOME)(?=$|\/)/, homedir());
	if (!keyPath) {
		io.print('No key file given; nothing changed.');
		return false;
	}
	let privateKey;
	try {
		privateKey = await readKeyFile(keyPath);
	} catch (/** @type {any} */ error) {
		const why =
			error?.code === 'ENOENT'
				? 'there is no file there'
				: error?.code === 'EACCES'
					? 'it may not be read'
					: error?.code === 'EISDIR'
						? 'that is a folder'
						: 'it cannot be read';
		io.print(
			`${keyPath}: ${why}. Give the path without quotes; ~ is your home folder, a relative path starts in bridge/. Nothing changed.`
		);
		return false;
	}
	if (/-----BEGIN CERTIFICATE-----/.test(privateKey)) {
		io.print(
			'That is the public certificate you gave Enable Banking. The bridge needs the private key it was made with (the file openssl wrote with -keyout, e.g. private.key or a .pem); nothing changed.'
		);
		return false;
	}
	try {
		parsePrivateKey(privateKey);
	} catch (/** @type {any} */ error) {
		io.print(`${error.message} Nothing changed.`);
		return false;
	}

	const redirectDefault = current.redirectUrl;
	const redirectAnswer =
		(await io.ask(
			`Redirect URL, as registered [${env.EB_REDIRECT_URL?.trim() || redirectDefault}]: `
		)) ||
		env.EB_REDIRECT_URL?.trim() ||
		redirectDefault;
	const redirectUrl = redirectUrlOf(redirectAnswer);
	if (!redirectUrl) {
		io.print('A redirect URL is https (or http on this machine); nothing changed.');
		return false;
	}

	let application;
	try {
		application = await check({ appId, privateKey, baseUrl: current.baseUrl });
	} catch (error) {
		const reason = error instanceof EnableBankingError ? error.message : 'the test call failed.';
		io.print(`Enable Banking did not accept the key: ${reason} Nothing changed.`);
		return false;
	}
	io.print(
		`The key works: application "${application.name}", ${application.environment || 'environment not given'}, ${
			application.active ? 'active' : 'not active yet'
		}.`
	);
	if (!application.active) {
		io.print(
			'To activate it for your own accounts: link them in the Control Panel ("Link accounts"). The application is then active in restricted mode, for exactly those accounts.'
		);
	}
	if (/sandbox/i.test(application.environment)) {
		io.print(
			'A sandbox application reaches test banks only. For your own accounts, register a production application.'
		);
	}
	if (!application.redirectUrls.includes(redirectUrl)) {
		io.print(
			`Note: ${redirectUrl} is not among the application's redirect URLs (${
				application.redirectUrls.join(', ') || 'none'
			}). The bank could not send you back; add it in the Control Panel.`
		);
	}

	const secrets = enableBankingSecrets({ configPath, keychain });
	/** @type {Record<string, unknown>} */ let sessions = {};
	if (current.configured && current.appId === appId) {
		// The same application: the banks linked so far stay linked.
		sessions = await secrets
			.read()
			.then((/** @type {any} */ s) =>
				s?.sessions && typeof s.sessions === 'object' ? s.sessions : {}
			)
			.catch(() => ({}));
	}
	await secrets.write({ privateKey, sessions });
	config.enablebanking = { ...current, configured: true, appId, redirectUrl };
	await saveConfig(config, configPath);
	io.print(
		`Saved ${configPath}; the key is sealed beside it. Restart the bridge (pnpm bridge) to use it.`
	);
	io.print(
		`Keep ${keyPath} somewhere safe, or delete it: Enable Banking cannot hand it out again.`
	);
	return true;
}

/**
 * `pnpm setup:enablebanking -- --accounts`: which linked accounts may leave
 * the bridge. Lists them (bank, name, last four of the IBAN) and asks for the
 * IBAN suffixes, as setup:hibiscus does; every other account stays here.
 *
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain the key to the sealed file
 * @param {string} deps.configPath
 * @returns {Promise<boolean>} true when the list was saved
 */
export async function runEnableBankingAccounts({ io, keychain, configPath }) {
	const config = await loadConfig(configPath);
	if (!config.enablebanking.configured) {
		io.print('Enable Banking is not set up yet: run pnpm setup:enablebanking first.');
		return false;
	}
	const sealed = /** @type {any} */ (await enableBankingSecrets({ configPath, keychain }).read());
	const accounts = Object.values(sealed.sessions ?? {}).flatMap((/** @type {any} */ r) =>
		(Array.isArray(r.accounts) ? r.accounts : []).map((/** @type {any} */ a) => ({
			bank: String(r.bank ?? ''),
			name: String(a.name ?? ''),
			iban: String(a.iban ?? ''),
			currency: String(a.currency ?? '')
		}))
	);
	if (!accounts.length) {
		io.print('No bank is linked yet: link one in the app under Integrationen → Bank first.');
		return false;
	}
	const current = config.enablebanking.ibanSuffixes;
	io.print('Linked accounts:');
	for (const a of accounts) {
		const allowed = current.some((x) => a.iban.endsWith(x));
		io.print(
			`  ${allowed ? '[x]' : '[ ]'} ${a.bank} · ${a.name || '–'} · ····${a.iban.slice(-4)} · ${a.currency}`
		);
	}
	const answer = (
		await io.ask(
			`IBAN suffixes that may leave the bridge, comma-separated (e.g. the last 4 digits; "-" for none)${current.length ? ` [${current.join(',')}]` : ''}: `
		)
	).trim();
	const suffixes =
		answer === '-'
			? []
			: (answer || current.join(','))
					.split(',')
					.map((x) => x.replace(/\s/g, '').toUpperCase())
					.filter(Boolean);
	if (suffixes.some((x) => !/^[0-9A-Z]{4,34}$/.test(x))) {
		io.print('A suffix is 4 or more letters or digits; nothing changed.');
		return false;
	}
	config.enablebanking = { ...config.enablebanking, ibanSuffixes: suffixes };
	await saveConfig(config, configPath);
	const leaving = accounts.filter((a) => suffixes.some((x) => a.iban.endsWith(x)));
	io.print(
		`Saved: ${leaving.length} of ${accounts.length} account(s) may leave the bridge. Restart the bridge (pnpm bridge) to use it.`
	);
	return true;
}

/** @param {{ appId: string, privateKey: string, baseUrl: string }} params */
async function testCall({ appId, privateKey, baseUrl }) {
	const client = createEnableBankingClient({
		appId,
		baseUrl,
		getPrivateKey: async () => privateKey
	});
	return client.application();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	const { EB_APP_ID, EB_KEY_PATH, EB_REDIRECT_URL } = process.env;
	try {
		const io = { ask, print: (/** @type {string} */ line) => console.log(line) };
		const keychain = systemKeychain({ account: 'enablebanking' });
		const saved = process.argv.includes('--accounts')
			? await runEnableBankingAccounts({ io, keychain, configPath: defaultConfigPath() })
			: await runEnableBankingSetup({
					io,
					keychain,
					configPath: defaultConfigPath(),
					env: { EB_APP_ID, EB_KEY_PATH, EB_REDIRECT_URL }
				});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
