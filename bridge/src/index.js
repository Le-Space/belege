// Wires config, keychain, pairing, Hibiscus, mail and the LLM into a running bridge.

import { loadConfig, saveConfig, defaultConfigPath } from './config.js';
import { createHibiscusClient } from './hibiscus.js';
import { macosKeychain } from './keychain.js';
import { createPairing } from './pairing.js';
import { createBridgeServer } from './server.js';
import { createMailClient } from './mail/imap.js';
import { domainOf } from './mail/auth-results.js';
import { createExtractor } from './llm/extract.js';

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

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {import('./keychain.js').Keychain} [options.keychain] the Hibiscus password
 * @param {import('./keychain.js').Keychain} [options.mailKeychain] the mail password
 * @param {import('./keychain.js').Keychain} [options.llmKeychain] the LLM API key
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

	const bridge = createBridgeServer({
		config,
		pairing,
		hibiscus: client ? () => client : null,
		mail,
		llm,
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

	return { ...bridge, address, config, pairing };
}
