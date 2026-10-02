// Wires config, keychain, pairing, Hibiscus, mail and the LLM into a running bridge.

import { loadConfig, saveConfig, defaultConfigPath } from './config.js';
import { createHibiscusClient } from './hibiscus.js';
import { systemKeychain } from './keychain.js';
import { createPairing } from './pairing.js';
import { createBridgeServer } from './server.js';
import { createMailClient } from './mail/imap.js';
import { domainOf } from './mail/auth-results.js';
import { createExtractor } from './llm/extract.js';
import { createMailAssist } from './llm/assist.js';
import { createRateService } from './rates.js';
import { createDexRates } from './dex-rate.js';
import { createMatchAssist } from './llm/match-assist.js';
import { createTransferAssist } from './llm/transfer-assist.js';
import { createVendorAssist } from './llm/vendor-assist.js';
import { createKrakenClient, parseKrakenCredentials } from './kraken.js';
import { createEnableBankingClient, enableBankingSecrets } from './enablebanking.js';
import { createEnableBankingLinks } from './enablebanking-links.js';
import { createWalletService } from './chains/index.js';
import { ALEPH_API, createAlephClient } from './aleph.js';
import { createAlephBackup } from './aleph-backup.js';
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
export { macosKeychain, systemKeychain, memoryKeychain, KeychainError } from './keychain.js';
export { windowsKeychain } from './windows-keychain.js';
export { loadConfig, saveConfig, defaultConfig, defaultConfigPath } from './config.js';
export * from './normalize.js';
export { createMailClient } from './mail/imap.js';
export { createExtractor, checkExtraction } from './llm/extract.js';
export { redact } from './llm/redact.js';
export { createRateService, RATE_SOURCES, RateError } from './rates.js';
export { createKrakenClient, KrakenError, parseAsset } from './kraken.js';
export {
	createEnableBankingClient,
	EnableBankingError,
	enableBankingSecrets
} from './enablebanking.js';
export {
	createWalletService,
	CHAINS,
	publicChains,
	WalletError,
	isCosmosAddress,
	isEvmAddress,
	bech32Encode,
	moduleAddress,
	toChecksumAddress
} from './chains/index.js';
export { createPortalManager, buildRecipes, isPdf } from './portals/index.js';

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {import('./keychain.js').Keychain} [options.keychain] the Hibiscus password
 * @param {import('./keychain.js').Keychain} [options.mailKeychain] the mail password
 * @param {import('./keychain.js').Keychain} [options.llmKeychain] the LLM API key
 * @param {import('./keychain.js').Keychain} [options.coingeckoKeychain] an optional CoinGecko demo key
 * @param {import('./keychain.js').Keychain} [options.krakenKeychain] the Kraken API key, JSON { key, secret }
 * @param {import('./keychain.js').Keychain} [options.enablebankingKeychain] the key to the sealed Enable Banking file
 * @param {import('./keychain.js').Keychain} [options.alchemyKeychain] an optional Alchemy API key (own EVM wallets)
 * @param {(network: string) => string} [options.alchemyBaseUrl] tests: a fake Alchemy on 127.0.0.1
 * @param {string} [options.alephApi] tests: a fake Aleph API on 127.0.0.1, the default for /aleph
 * @param {import('./keychain.js').Keychain} [options.alephBackupKeychain] the backup key (setup:aleph)
 * @param {string} [options.alephIngestUrl] tests: a fake of Aleph's IPFS host on 127.0.0.1
 * @param {typeof fetch} [options.backupFetch] fetch for the backup's upload (tests hand in a fake)
 * @param {number} [options.krakenPageDelayMs] pause between Kraken ledger pages (tests: 0)
 * @param {typeof fetch} [options.rateFetch] fetch for the exchange-rate sources (tests hand in a fake)
 * @param {Record<string, string> | null} [options.fixedRates] tests only: EUR per unit by asset,
 *   answered for every day instead of asking CoinGecko, Kraken or the ECB (source `manual`)
 * @param {typeof fetch} [options.walletFetch] fetch for the chain nodes (tests hand in a fake)
 * @param {import('./keychain.js').Keychain} [options.bitcoinKeychain] the Bitcoin zpub (read only)
 * @param {number} [options.bitcoinPauseMs] between Esplora requests (tests: 0)
 * @param {boolean} [options.walletLoopback] a wallet may name an endpoint on http://127.0.0.1 (tests only)
 * @param {(portalId: string) => import('./keychain.js').Keychain} [options.portalKeychain] a portal's password
 * @param {'auto' | 'always'} [options.portalHeadless] `always` for tests: no window ever opens
 * @param {boolean} [options.portalLoopback] a new portal may start on http://127.0.0.1 (tests only)
 * @param {import('./portals/credentials.js').AskPassword} [options.portalPasswordDialog]
 *   asks for a portal's password on this Mac ("Zugangsdaten speichern"); tests hand in a fake
 * @param {boolean} [options.lanRelayLoopback] the LAN relay may listen on 127.0.0.1 (tests only)
 * @param {boolean} [options.forcePairingCode] issue a code even when already paired
 * @param {number} [options.port] overrides the config
 * @param {(line: string) => void} [options.print] the console; gets the pairing code
 * @param {(line: string) => void} [options.log]
 */
export async function startBridge({
	configPath = defaultConfigPath(),
	keychain = systemKeychain(),
	mailKeychain = systemKeychain({ account: 'imap' }),
	llmKeychain = systemKeychain({ account: 'llm' }),
	coingeckoKeychain = systemKeychain({ account: 'coingecko' }),
	krakenKeychain = systemKeychain({ account: 'kraken' }),
	enablebankingKeychain = systemKeychain({ account: 'enablebanking' }),
	alchemyKeychain = systemKeychain({ account: 'alchemy' }),
	alchemyBaseUrl,
	alephApi,
	alephBackupKeychain = systemKeychain({ account: 'aleph-backup' }),
	alephIngestUrl,
	backupFetch = fetch,
	krakenPageDelayMs,
	rateFetch = fetch,
	fixedRates = null,
	walletFetch = fetch,
	bitcoinKeychain = systemKeychain({ account: 'bitcoin' }),
	bitcoinPauseMs,
	walletLoopback = false,
	portalKeychain = (id) => systemKeychain({ account: keychainAccount(id) }),
	portalHeadless = 'auto',
	portalLoopback = false,
	portalPasswordDialog = macosPasswordDialog(),
	lanRelayLoopback = false,
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
	const transferAssist = llm
		? createTransferAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains } })
		: null;
	const vendorAssist = llm
		? createVendorAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains } })
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

	const rates = fixedRates
		? /** @type {ReturnType<typeof createRateService>} */ (
				/** @type {unknown} */ (fixedRateService(fixedRates))
			)
		: createRateService({
				fetch: rateFetch,
				coingeckoKey: () => coingeckoKeychain.read().catch(() => null),
				// A token CoinGecko does not price: its pool at the block, through the Alchemy key (#163).
				dex: createDexRates({
					fetch: walletFetch,
					alchemyKey: () => alchemyKeychain.read().catch(() => null),
					...(alchemyBaseUrl ? { alchemyBaseUrl } : {})
				})
			});
	// The relay for own devices in the own network (#148), when set up; the
	// bridge runs on without it when it cannot start.
	/** @type {Awaited<ReturnType<typeof import('./lan-relay.js').startLanRelay>> | null} */
	let lanRelay = null;
	if (config.lanRelay.host) {
		try {
			const { startLanRelay } = await import('./lan-relay.js');
			lanRelay = await startLanRelay({
				host: config.lanRelay.host,
				port: config.lanRelay.port,
				dir: join(dirname(configPath), 'lan-relay'),
				allowLoopback: lanRelayLoopback,
				log
			});
		} catch (/** @type {any} */ error) {
			log(`${error.message} – run \`pnpm setup:relay\` again, or switch it off there.`);
		}
	}

	const enablebankingSecrets = enableBankingSecrets({
		configPath,
		keychain: enablebankingKeychain
	});
	const enablebankingClient =
		config.enablebanking.configured && config.enablebanking.appId
			? createEnableBankingClient({
					appId: config.enablebanking.appId,
					baseUrl: config.enablebanking.baseUrl,
					// Opened on every request, so a key set up again counts at once.
					getPrivateKey: async () =>
						/** @type {import('./enablebanking.js').EnableBankingSecrets} */ (
							await enablebankingSecrets.read()
						).privateKey
				})
			: null;

	const bridge = createBridgeServer({
		config,
		lanRelay: lanRelay
			? { addr: lanRelay.addr, stats: lanRelay.stats }
			: config.lanRelay.host
				? { addr: null, stats: () => ({ reservations: 0, connections: 0 }) }
				: null,
		pairing,
		hibiscus: client ? () => client : null,
		mail,
		llm,
		assist,
		matchAssist,
		transferAssist,
		vendorAssist,
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
		enablebanking: enablebankingClient,
		enablebankingLinks: enablebankingClient
			? createEnableBankingLinks({
					client: enablebankingClient,
					secrets: enablebankingSecrets,
					redirectUrl: config.enablebanking.redirectUrl,
					allowedSuffixes: () => config.enablebanking.ibanSuffixes,
					log
				})
			: null,
		rates,
		// Aleph Cloud credits, read only (issue #113); valued with the same rates.
		aleph: createAlephClient({ fetch: walletFetch, rates }),
		alephLoopback: walletLoopback,
		...(alephApi ? { alephApi } : {}),
		alephBackup: config.alephBackup.configured
			? createAlephBackup({
					getKey: () => alephBackupKeychain.read(),
					apiHost: alephApi ?? ALEPH_API,
					...(alephIngestUrl ? { ingestUrl: alephIngestUrl } : {}),
					fetch: backupFetch
				})
			: null,
		wallets: createWalletService({
			fetch: walletFetch,
			allowLoopback: walletLoopback,
			getZpub: () => bitcoinKeychain.read().catch(() => null),
			bitcoinPauseMs,
			// Read on every sync, so a key set up while the bridge runs counts at once.
			alchemyKey: () => alchemyKeychain.read().catch(() => null),
			alchemyBaseUrl
		}),
		log
	});
	const address = await bridge.listen({ port: port ?? config.bridge.port });
	print(`belege bridge listening on http://${address.host}:${address.port}`);
	print(`Allowed app origins: ${config.appOrigins.join(', ') || '(none)'}`);
	if (lanRelay) {
		print(`LAN relay for own devices on ${config.lanRelay.host}, UDP ${config.lanRelay.port}`);
	}

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
		lanRelay,
		async close() {
			portals.close();
			await lanRelay?.stop().catch(() => {});
			return bridge.close();
		}
	};
}

/**
 * The same answer for every day: for the E2E suite, which must not ask the
 * real rate sources.
 *
 * @param {Record<string, string>} rates EUR per unit, by symbol
 */
function fixedRateService(rates) {
	return {
		/**
		 * A token not in the list by its contract only, never by the symbol it claims.
		 *
		 * @param {string} asset @param {string} date @param {{ contract?: string | null }} [options]
		 */
		async rate(asset, date, { contract = null } = {}) {
			const key = contract ?? asset;
			const rate = Object.hasOwn(rates, key) ? rates[key] : null;
			if (!rate) {
				throw Object.assign(new Error(`no rate source for ${asset}`), { status: 400 });
			}
			return {
				asset,
				date,
				currency: /** @type {const} */ ('EUR'),
				rate,
				usdRate: null,
				source: /** @type {const} */ ('manual'),
				at: `${date}T00:00:00Z`
			};
		}
	};
}
