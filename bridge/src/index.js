// Wires config, keychain, pairing, Hibiscus, mail and the LLM into a running bridge.

import { loadConfig, saveConfig, defaultConfigPath } from './config.js';
import { createHibiscusClient } from './hibiscus.js';
import { macosKeychain } from './keychain.js';
import { createPairing } from './pairing.js';
import { createBridgeServer } from './server.js';
import { createMailClient } from './mail/imap.js';
import { domainOf } from './mail/auth-results.js';
import { createExtractor } from './llm/extract.js';
import { createMailAssist } from './llm/assist.js';
import { createRateService } from './rates.js';
import { createMatchAssist } from './llm/match-assist.js';
import { createKrakenClient, parseKrakenCredentials } from './kraken.js';
import { buildRecipes, createPortalManager, keychainAccount } from './portals/index.js';
import { macosPasswordDialog } from './portals/credentials.js';
import { dirname, join } from 'node:path';

export { createBridgeServer, LOOPBACK } from './server.js';
export { createPairing, hashToken } from './pairing.js';
export {
	createHibiscusClient,
	peerFingerprint,
	normalizeFingerprint,
	PinMismatchError
} from './hibiscus.js';
export { macosKeychain, memoryKeychain, KeychainError } from './keychain.js';
export { loadConfig, saveConfig, defaultConfig, defaultConfigPath } from './config.js';
export * from './normalize.js';
export { createMailClient } from './mail/imap.js';
export { createExtractor, checkExtraction } from './llm/extract.js';
export { redact } from './llm/redact.js';
export { createRateService, RATE_SOURCES, RateError } from './rates.js';
export { createKrakenClient, KrakenError, parseAsset } from './kraken.js';
export { createPortalManager, buildRecipes, isPdf } from './portals/index.js';

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {import('./keychain.js').Keychain} [options.keychain] the Hibiscus password
 * @param {import('./keychain.js').Keychain} [options.mailKeychain] the mail password
 * @param {import('./keychain.js').Keychain} [options.llmKeychain] the LLM API key
 * @param {import('./keychain.js').Keychain} [options.coingeckoKeychain] an optional CoinGecko demo key
 * @param {import('./keychain.js').Keychain} [options.krakenKeychain] the Kraken API key, JSON { key, secret }
 * @param {number} [options.krakenPageDelayMs] pause between Kraken ledger pages (tests: 0)
 * @param {typeof fetch} [options.rateFetch] fetch for the exchange-rate sources (tests hand in a fake)
 * @param {(portalId: string) => import('./keychain.js').Keychain} [options.portalKeychain] a portal's password
 * @param {'auto' | 'always'} [options.portalHeadless] `always` for tests: no window ever opens
 * @param {boolean} [options.portalLoopback] a new portal may start on http://127.0.0.1 (tests only)
 * @param {import('./portals/credentials.js').AskPassword} [options.portalPasswordDialog]
 *   asks for a portal's password on this Mac ("Zugangsdaten speichern"); tests hand in a fake
 * @param {boolean} [options.forcePairingCode] issue a code even when already paired
 * @param {number} [options.port] overrides the config
 * @param {(line: string) => void} [options.print] the console; gets the pairing code
 * @param {(line: string) => void} [options.log]
 */
export async function startBridge({
	configPath = defaultConfigPath(),
	keychain = macosKeychain(),
	mailKeychain = macosKeychain({ account: 'imap' }),
	llmKeychain = macosKeychain({ account: 'llm' }),
	coingeckoKeychain = macosKeychain({ account: 'coingecko' }),
	krakenKeychain = macosKeychain({ account: 'kraken' }),
	krakenPageDelayMs,
	rateFetch = fetch,
	portalKeychain = (id) => macosKeychain({ account: keychainAccount(id) }),
	portalHeadless = 'auto',
	portalLoopback = false,
	portalPasswordDialog = macosPasswordDialog(),
	forcePairingCode = false,
	port,
	print = (line) => console.log(line),
	log = (line) => console.error(`[bridge] ${line}`)
} = {}) {
	const config = await loadConfig(configPath);

	const pairing = createPairing({
		getHashes: () => config.pairedTokens,
		saveHashes: async (hashes) => {
			config.pairedTokens = hashes;
			await saveConfig(config, configPath);
		}
	});

	const { host, port: hibiscusPort, certSha256, ibanSuffixes } = config.hibiscus;
	const ready = Boolean(certSha256 && ibanSuffixes.length > 0);
	if (!ready) {
		log(
			'Hibiscus is not set up (no pinned certificate or no IBAN suffix): run `pnpm --filter @belege/bridge setup:hibiscus`.'
		);
	}
	const client = ready
		? createHibiscusClient({
				host,
				port: hibiscusPort,
				certSha256: /** @type {string} */ (certSha256),
				getPassword: () => keychain.read()
			})
		: null;

	const mail =
		config.mail.host && config.mail.user
			? createMailClient({ config: config.mail, getPassword: () => mailKeychain.read() })
			: null;
	if (!mail) log('Mail is not set up: run `pnpm setup:mail`.');

	// Our own addresses are blacked out before text goes to the LLM.
	const ownDomains = [
		...new Set(
			[domainOf(config.mail.user), domainOf(config.mail.accountingAddress)].filter(Boolean)
		)
	];
	const llm = config.llm.configured
		? createExtractor({ config: config.llm, getKey: () => llmKeychain.read(), ownDomains })
		: null;
	if (!llm) log('No LLM is set up: run `pnpm setup:llm`.');
	const matchAssist = llm
		? createMatchAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains } })
		: null;
	const assist =
		llm && mail
			? createMailAssist({ llm, mail, redaction: { terms: config.llm.redactTerms, ownDomains } })
			: null;

	// Customer portals: a browser with a profile per portal next to bridge.json.
	// Recorded recipes ("Portal aufzeichnen") are kept next to them.
	const recipesDir = join(dirname(configPath), 'recipes');
	const portals = createPortalManager({
		recipes: buildRecipes(config.portals, { recipesDir, log, allowLoopback: portalLoopback }),
		dir: join(dirname(configPath), 'portals'),
		recipesDir,
		rebuild: (id) =>
			buildRecipes(config.portals, { recipesDir, log, allowLoopback: portalLoopback })[id],
		allowLoopback: portalLoopback,
		headless: portalHeadless,
		visibleFetch: (id) => config.portals[id]?.headless === false,
		// "Zugangsdaten speichern": the user name into bridge.json, the password
		// (from the native dialog, never from the app) into the keychain.
		credentialStore: {
			has: (id) => Boolean(config.portals[id]?.username && config.portals[id]?.passwordStored),
			async save(id, { username, password }) {
				await portalKeychain(id).write(password);
				config.portals = {
					...config.portals,
					[id]: { ...(config.portals[id] ?? {}), username, passwordStored: true }
				};
				await saveConfig(config, configPath);
			},
			async remove(id) {
				await portalKeychain(id).remove?.();
				const { username: _u, passwordStored: _p, ...rest } = config.portals[id] ?? {};
				const next = { ...config.portals };
				if (Object.keys(rest).length) next[id] = rest;
				else delete next[id];
				config.portals = next;
				await saveConfig(config, configPath);
			}
		},
		askPassword: portalPasswordDialog,
		credentials: async (id) => {
			const p = config.portals[id];
			if (!p?.username || !p.passwordStored) return null;
			try {
				return { username: p.username, password: await portalKeychain(id).read() };
			} catch {
				log(`portal ${id}: no password in the keychain; the user logs in by hand`);
				return null;
			}
		},
		log
	});

	const bridge = createBridgeServer({
		config,
		pairing,
		hibiscus: client ? () => client : null,
		mail,
		llm,
		assist,
		matchAssist,
		// Reads the keychain entry to see that there is one; the value stays here.
		llmKeyPresent: async () => {
			try {
				return Boolean(await llmKeychain.read());
			} catch {
				return false;
			}
		},
		portals,
		kraken: config.kraken.configured
			? createKrakenClient({
					baseUrl: config.kraken.baseUrl,
					pageDelayMs: krakenPageDelayMs,
					getCredentials: async () => parseKrakenCredentials(await krakenKeychain.read())
				})
			: null,
		rates: createRateService({
			fetch: rateFetch,
			coingeckoKey: () => coingeckoKeychain.read().catch(() => null)
		}),
		log
	});
	const address = await bridge.listen({ port: port ?? config.bridge.port });
	print(`belege bridge listening on http://${address.host}:${address.port}`);
	print(`Allowed app origins: ${config.appOrigins.join(', ') || '(none)'}`);

	if (forcePairingCode || !pairing.isPaired()) {
		const code = pairing.issueCode();
		print(`Pairing code (valid 10 minutes, once): ${code}`);
		print('Enter it in the app under Integrationen → Bridge koppeln.');
	}

	return {
		...bridge,
		address,
		config,
		pairing,
		portals,
		close() {
			portals.close();
			return bridge.close();
		}
	};
}
