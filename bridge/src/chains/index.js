// Own wallets, read only: which chains there are (GET /chains) and the
// history and balance of one address (POST /<chain>/wallet). The app keeps
// the list of wallets in its sealed store and names chain, address and,
// optionally, its own endpoints on every request; the bridge keeps nothing.
//
// No wallet key, no mnemonic, no signature: an address is public, and all
// the bridge does is ask a node about it. That node (Nym's RPC, Blockscout,
// Alchemy when an Alchemy API key is set up, or the one the person named)
// sees the address and this Mac's IP address – the consent screen says so.
// The Alchemy key stays in the bridge: GET /chains says only whether there
// is one.

import { chainOf, publicChains } from './registry.js';
import { createCosmosClient } from './cosmos.js';
import { createEvmClient } from './evm.js';
import { createBitcoinClient } from './bitcoin.js';
import { checkEndpoint, WalletError } from './http.js';

export { CHAINS, chainOf, publicChains } from './registry.js';
export { WalletError, checkEndpoint } from './http.js';
export { isCosmosAddress, bech32Encode, bech32Decode, moduleAddress } from './bech32.js';
export { isEvmAddress, toChecksumAddress } from './evm.js';
export {
	ADDRESS_TYPES,
	deriveAddress,
	keyFingerprint,
	normalizeBitcoin,
	parseExtendedKey,
	parseStoredKey
} from './bitcoin.js';

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {boolean} [options.allowLoopback] endpoints on http://127.0.0.1 (tests only)
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => Promise<string | null>} [options.getZpub] the Bitcoin key's keychain entry
 * @param {number} [options.bitcoinPauseMs] between Esplora requests (tests: 0)
 * @param {() => Promise<string | null>} [options.alchemyKey] the Alchemy API key, or null
 * @param {(network: string) => string} [options.alchemyBaseUrl] tests: a fake Alchemy
 */
export function createWalletService({
	fetch: f = fetch,
	allowLoopback = false,
	timeoutMs,
	sleep,
	getZpub = async () => null,
	bitcoinPauseMs,
	alchemyKey = async () => null,
	alchemyBaseUrl
} = {}) {
	const cosmos = createCosmosClient({ fetch: f, timeoutMs, sleep });
	const evm = createEvmClient({
		fetch: f,
		timeoutMs,
		sleep,
		alchemy: { key: alchemyKey, baseUrl: alchemyBaseUrl }
	});
	const bitcoin = createBitcoinClient({
		fetch: f,
		getZpub,
		timeoutMs,
		sleep,
		pauseMs: bitcoinPauseMs
	});

	return {
		chains: publicChains,
		/** The fingerprint of the Bitcoin key in the keychain, or null. */
		bitcoinKey: () => bitcoin.fingerprint(),
		/** Whether an Alchemy key is set up; never the key. */
		alchemy: async () => Boolean(await alchemyKey().catch(() => null)),
		/** @param {string} id */
		has: (id) => Boolean(chainOf(id)),

		/**
		 * @param {{ chain?: unknown, address?: unknown, endpoints?: unknown }} request
		 */
		async sync(request) {
			const chain = chainOf(String(request?.chain ?? ''));
			if (!chain) throw new WalletError('unknown chain', 'WALLET_CHAIN', 400);
			const address = typeof request?.address === 'string' ? request.address.trim() : '';
			const given = /** @type {Record<string, unknown>} */ (
				request?.endpoints && typeof request.endpoints === 'object' ? request.endpoints : {}
			);
			/** @type {Record<string, string>} */
			const endpoints = {};
			let ownEndpoint = false;
			for (const [name, fallback] of Object.entries(chain.endpoints)) {
				const value = given[name];
				if (value === undefined || value === null || value === '') {
					endpoints[name] = fallback;
					continue;
				}
				const checked = checkEndpoint(value, { allowLoopback });
				if (!checked) {
					throw new WalletError(
						`the ${name.toUpperCase()} endpoint must be an https:// URL without user, query or fragment`,
						'WALLET_ENDPOINT',
						400
					);
				}
				endpoints[name] = checked;
				ownEndpoint = true;
			}
			const result =
				chain.kind === 'bitcoin'
					? await bitcoin.history({
							chain,
							address,
							endpoints: /** @type {{ api: string }} */ (endpoints)
						})
					: chain.kind === 'cosmos'
						? await cosmos.history({
								chain,
								address,
								endpoints: /** @type {{ rpc: string, rest: string }} */ (endpoints)
							})
						: await evm.history({
								chain,
								address,
								endpoints: /** @type {{ api: string }} */ (endpoints),
								ownEndpoint
							});
			return { chain: chain.id, endpoints, ...result };
		}
	};
}
