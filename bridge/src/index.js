// Wires config, keychain, pairing and Hibiscus into a running bridge.

import { loadConfig, saveConfig, defaultConfigPath } from './config.js';
import { createHibiscusClient } from './hibiscus.js';
import { macosKeychain } from './keychain.js';
import { createPairing } from './pairing.js';
import { createBridgeServer } from './server.js';

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

/**
 * @param {object} [options]
 * @param {string} [options.configPath]
 * @param {import('./keychain.js').Keychain} [options.keychain]
 * @param {boolean} [options.forcePairingCode] issue a code even when already paired
 * @param {number} [options.port] overrides the config
 * @param {(line: string) => void} [options.print] the console; gets the pairing code
 * @param {(line: string) => void} [options.log]
 */
export async function startBridge({
	configPath = defaultConfigPath(),
	keychain = macosKeychain(),
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

	const bridge = createBridgeServer({
		config,
		pairing,
		hibiscus: client ? () => client : null,
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
