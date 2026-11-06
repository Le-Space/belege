// Wires config, keychain, pairing, Hibiscus, mail and the LLM into a running bridge.

import {
	loadConfig,
	saveConfig,
	defaultConfigPath,
	isLoopbackUrl,
	redactionOff
} from './config.js';
import { createHibiscusClient } from './hibiscus.js';
import { systemKeychain } from './keychain.js';
import { BRIDGE_AUTH_ACCOUNT, LEGACY_DEVICE_AUTH_ACCOUNT } from './node.js';
import { createPairing } from './pairing.js';
import { createBridgeServer } from './server.js';
import { createMailClient } from './mail/imap.js';
import { domainOf } from './mail/auth-results.js';
import { createExtractor } from './llm/extract.js';
import { createConfidentialFetch } from './llm/confidential.js';
import { createMailAssist } from './llm/assist.js';
import { createDexRates, createRateService } from '@le-space/rates';
import { createMatchAssist } from './llm/match-assist.js';
import { createTransferAssist } from './llm/transfer-assist.js';
import { createVendorAssist } from './llm/vendor-assist.js';
import { createKrakenClient, parseKrakenCredentials } from './kraken.js';
import { createPaperlessClient } from './paperless.js';
import { createEnableBankingClient, enableBankingSecrets } from './enablebanking.js';
import { createEnableBankingLinks } from './enablebanking-links.js';
import { createWalletService } from '@le-space/chains';
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
export { createRateService, RATE_SOURCES, RateError } from '@le-space/rates';
export { createKrakenClient, KrakenError, parseAsset } from './kraken.js';
export { createPaperlessClient, PaperlessError } from './paperless.js';
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
} from '@le-space/chains';
export { createPortalManager, buildRecipes, isPdf } from './portals/index.js';

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {import('./keychain.js').Keychain} [options.keychain] the Hibiscus password
 * @param {import('./keychain.js').Keychain} [options.mailKeychain] the mail password
 * @param {import('./keychain.js').Keychain} [options.llmKeychain] the LLM API key
 * @param {import('./keychain.js').Keychain} [options.coingeckoKeychain] an optional CoinGecko demo key
 * @param {import('./keychain.js').Keychain} [options.krakenKeychain] the Kraken API key, JSON { key, secret }
 * @param {import('./keychain.js').Keychain} [options.paperlessKeychain] the Paperless-ngx API token
 * @param {import('./keychain.js').Keychain} [options.enablebankingKeychain] the key to the sealed Enable Banking file
 * @param {import('./keychain.js').Keychain} [options.alchemyKeychain] an optional Alchemy API key (own EVM wallets)
 * @param {(network: string) => string} [options.alchemyBaseUrl] tests: a fake Alchemy on 127.0.0.1
 * @param {string} [options.alephApi] tests: a fake Aleph API on 127.0.0.1, the default for /aleph
 * @param {import('./keychain.js').Keychain} [options.alephBackupKeychain] the backup key (setup:aleph)
 * @param {string} [options.alephIngestUrl] tests: a fake of Aleph's IPFS host on 127.0.0.1
 * @param {typeof fetch} [options.backupFetch] fetch for the backup's upload (tests hand in a fake)
 * @param {number} [options.krakenPageDelayMs] pause between Kraken ledger pages (tests: 0)
 * @param {typeof fetch} [options.rateFetch] fetch for the exchange-rate sources (tests hand in a fake)
 * @param {Record<string, string | { rate: string, source?: string, at?: string }> | null} [options.fixedRates] tests only: EUR per unit by asset,
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
 * @param {boolean} [options.node] the bridge's own libp2p node (node.js, #573); false: HTTP only
 * @param {import('./keychain.js').Keychain} [options.bridgeAuthKeychain] the bridge's own key, from the handover (#575)
 * @param {import('./keychain.js').Keychain | null} [options.legacyDeviceAuthKeychain] where a build before #575 kept the books' device key: removed at start
 * @param {any[]} [options.nodeTransports] tests: the memory transport
 * @param {string[]} [options.nodeListen] tests: listen addresses
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
	paperlessKeychain = systemKeychain({ account: 'paperless' }),
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
	node: nodeWanted = true,
	bridgeAuthKeychain = systemKeychain({ account: BRIDGE_AUTH_ACCOUNT }),
	legacyDeviceAuthKeychain = systemKeychain({ account: LEGACY_DEVICE_AUTH_ACCOUNT }),
	nodeTransports,
	nodeListen,
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
	// A model on this machine gets the text as it is (#423, config.js redactionOff).
	const off = redactionOff(config.llm);
	if (config.llm.configured && off)
		log(
			config.llm.tee
				? 'LLM in the attested enclave: text is not blacked out.'
				: 'LLM on this machine: text is not blacked out.'
		);
	else if (
		config.llm.configured &&
		config.llm.redaction === 'auto' &&
		isLoopbackUrl(config.llm.baseUrl)
	)
		log(
			'LLM on 127.0.0.1: text is blacked out until `pnpm setup:llm` is told the model runs on this machine.'
		);
	// A confidential model (#416): every request to the pinned enclave, attested.
	const tee =
		config.llm.configured && config.llm.tee
			? createConfidentialFetch({ pin: config.llm.tee, baseUrl: config.llm.baseUrl })
			: null;
	if (tee)
		log(
			`LLM in a confidential VM: every request goes to the attested enclave ${config.llm.tee?.itemHash.slice(0, 12)}…`
		);
	const llm = config.llm.configured
		? createExtractor({
				config: config.llm,
				getKey: () => llmKeychain.read(),
				ownDomains,
				...(tee ? { fetch: tee.fetch } : {})
			})
		: null;
	if (!llm) log('No LLM is set up: run `pnpm setup:llm`.');
	const matchAssist = llm
		? createMatchAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains, off } })
		: null;
	const transferAssist = llm
		? createTransferAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains, off } })
		: null;
	const vendorAssist = llm
		? createVendorAssist({ llm, redaction: { terms: config.llm.redactTerms, ownDomains, off } })
		: null;
	const assist =
		llm && mail
			? createMailAssist({
					llm,
					mail,
					redaction: { terms: config.llm.redactTerms, ownDomains, off }
				})
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

	// The bridge's own libp2p node (#573): unarmed until a device hands the
	// bridge's own key over by the invitation printed below, armed after.
	/** @type {import('./node.js').BridgeNode | null} */
	let node = null;
	const nodeDir = join(dirname(configPath), 'node');
	const nodeOn = nodeWanted && config.node.enabled;
	// A build before #575 kept the books' device key here: it goes, unread.
	if (nodeOn) await legacyDeviceAuthKeychain?.remove?.().catch(() => {});
	/** The key as the keychain holds it, or null. */
	async function bridgeAuthKey() {
		try {
			const hex = await bridgeAuthKeychain.read();
			return /^[0-9a-f]{64}$/.test(hex) ? Uint8Array.from(Buffer.from(hex, 'hex')) : null;
		} catch {
			return null;
		}
	}
	/** The WebSocket port the node took: the same again after the restart at the handover, so the invitation's address stays good. */
	let wsPort = config.node.wsPort;
	async function startNode() {
		if (!nodeOn) return;
		const { startBridgeNode } = await import('./node.js');
		node = await startBridgeNode({
			dir: nodeDir,
			authKey: await bridgeAuthKey(),
			relays: config.node.relays,
			devices: config.node.devices,
			limits: config.node.limits,
			// The same table as HTTP: `request { method, path, body? }` over the stream (stream.js).
			commands: bridge.commands,
			wsPort,
			...(nodeTransports ? { transports: nodeTransports } : {}),
			...(nodeListen ? { listen: nodeListen } : {}),
			onHandover: async ({ authKey, relays, devices }) => {
				await bridgeAuthKeychain.write(Buffer.from(authKey).toString('hex'));
				config.node.relays = relays;
				config.node.devices = devices;
				await saveConfig(config, configPath);
				await node?.stop().catch(() => {});
				await startNode();
				print(`Paired with the books: the node is armed, peer ${node?.peerId ?? '?'}.`);
			},
			onDevices: async (devices) => {
				config.node.devices = devices;
				await saveConfig(config, configPath);
			},
			onUnpair: async () => {
				await disarmNode();
				print('Unpaired by a device of the books: the node waits to be paired again.');
				if (node && !node.armed) print(await node.invite());
			},
			log
		});
		const ws = node.addrs().find((a) => /^\/ip4\/127\.0\.0\.1\/tcp\/\d+\/ws/.test(a));
		if (ws) wsPort = Number(/\/tcp\/(\d+)\//.exec(ws)?.[1] ?? wsPort);
	}
	/** "Kopplung lösen": the bridge's key leaves, the node runs on unarmed. */
	async function disarmNode() {
		await bridgeAuthKeychain.remove?.().catch(() => {});
		config.node.devices = [];
		await saveConfig(config, configPath);
		await node?.stop().catch(() => {});
		await startNode();
	}
	/** What the HTTP front door tells, and does, about the node. */
	const nodeHandle = nodeOn
		? {
				status: () => ({
					enabled: true,
					armed: node?.armed ?? false,
					peerId: node?.peerId ?? null,
					addrs: node?.addrs() ?? [],
					devices: node ? node.devices().size : 0
				}),
				disarm: () => disarmNode()
			}
		: null;

	const bridge = createBridgeServer({
		config,
		node: nodeHandle,
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
		llmTee: tee ? tee.status : null,
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
		paperless: config.paperless.configured
			? createPaperlessClient({
					baseUrl: config.paperless.baseUrl,
					getToken: () => paperlessKeychain.read()
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
	print(
		`Allowed app origins: ${config.appOrigins.join(', ') || '(none)'} (change: pnpm setup:origins)`
	);
	if (lanRelay) {
		print(`LAN relay for own devices on ${config.lanRelay.host}, UDP ${config.lanRelay.port}`);
	}
	try {
		await startNode();
	} catch (/** @type {any} */ error) {
		log(`the node did not start: ${error.message} – the bridge runs on over HTTP`);
		node = null;
	}
	if (node) {
		print(
			`Node: peer ${node.peerId}${node.armed ? ', armed (the books know it)' : ', waiting to be paired'}`
		);
		if (!node.armed) {
			print(
				'Pair it from the app: paste this invitation under Integrationen → Bridge koppeln (valid 10 minutes):'
			);
			print(await node.invite());
		}
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
		/** The bridge's own node, or null. */
		get node() {
			return node;
		},
		async close() {
			portals.close();
			await node?.stop().catch(() => {});
			await lanRelay?.stop().catch(() => {});
			return bridge.close();
		}
	};
}

/**
 * The same answer for every day: for the E2E suite, which must not ask the
 * real rate sources.
 *
 * @param {Record<string, string | { rate: string, source?: string, at?: string }>} rates
 *   EUR per unit, by symbol; with a source and its moment, to stand for a
 *   reference rate (the ECB's, the Bank of Russia's)
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
			const given = Object.hasOwn(rates, key) ? rates[key] : null;
			if (!given) {
				throw Object.assign(new Error(`no rate source for ${asset}`), { status: 400 });
			}
			const fixed = typeof given === 'string' ? { rate: given } : given;
			return {
				asset,
				date,
				currency: /** @type {const} */ ('EUR'),
				rate: fixed.rate,
				usdRate: null,
				source: /** @type {any} */ (fixed.source ?? 'manual'),
				at: fixed.at ?? `${date}T00:00:00Z`
			};
		}
	};
}
