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
import { createAkashConsoleClient } from './akash-console.js';
import { createAkashDeploymentsClient } from './akash-deployments.js';
import { isCosmosAddress } from './bech32.js';
import { createEvmClient } from './evm.js';
import { createBitcoinClient } from './bitcoin.js';
import { createFilecoinClient } from './filecoin.js';
import { createNearClient } from './near-wallet.js';
import { checkEndpoint, WalletError } from './http.js';

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {boolean} [options.allowLoopback] endpoints on http://127.0.0.1 (tests only)
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => Promise<string | null>} [options.getZpub] the Bitcoin key (the bridge: from its keychain)
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
	const indexer = createAkashConsoleClient({ fetch: f, sleep });
	const evm = createEvmClient({
		fetch: f,
		timeoutMs,
		sleep,
		alchemy: { key: alchemyKey, baseUrl: alchemyBaseUrl }
	});
	const filecoin = createFilecoinClient({ fetch: f, timeoutMs, sleep });
	const near = createNearClient({ fetch: f, timeoutMs });
	const deployments = createAkashDeploymentsClient({ fetch: f, timeoutMs, sleep });
	const bitcoin = createBitcoinClient({
		fetch: f,
		getZpub,
		timeoutMs,
		sleep,
		pauseMs: bitcoinPauseMs
	});

	/**
	 * The endpoints a request asks for, each checked, or the chain's defaults.
	 *
	 * @param {import('./registry.js').Chain} chain
	 * @param {any} request
	 */
	function endpointsOf(chain, request) {
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
		return { endpoints, ownEndpoint };
	}

	return {
		chains: publicChains,
		/** The fingerprint of the Bitcoin key in the keychain, or null. */
		bitcoinKey: () => bitcoin.fingerprint(),
		/** Whether an Alchemy key is set up; never the key. */
		alchemy: async () => Boolean(await alchemyKey().catch(() => null)),
		/** @param {string} id */
		has: (id) => Boolean(chainOf(id)),

		/**
		 * @param {{ chain?: unknown, address?: unknown, endpoints?: unknown, hashes?: unknown }} request
		 *   `hashes`: transactions another source names for this wallet (an exchange's
		 *   withdrawal), read from the indexer where the address's own reading lacks them
		 */
		async sync(request) {
			const chain = chainOf(String(request?.chain ?? ''));
			if (!chain) throw new WalletError('unknown chain', 'WALLET_CHAIN', 400);
			if (chain.kind === 'monero') {
				throw new WalletError(
					"Monero cannot be read by an address: import the wallet's export in the app",
					'WALLET_IMPORT_ONLY',
					400
				);
			}
			const address = typeof request?.address === 'string' ? request.address.trim() : '';
			const { endpoints, ownEndpoint } = endpointsOf(chain, request);
			let result =
				chain.kind === 'near'
					? await near.history({
							chain,
							address,
							endpoints: /** @type {{ api: string, rpc: string }} */ (endpoints)
						})
					: chain.kind === 'filecoin'
						? await filecoin.history({
								chain,
								address,
								endpoints: /** @type {{ api: string }} */ (endpoints)
							})
						: chain.kind === 'bitcoin'
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
			// A pruned node: what it no longer knows, from the chain's indexer. If
			// that fails, the sync keeps what the node gave and says the history
			// is short, as without an indexer.
			if (chain.kind === 'cosmos' && endpoints.indexer && 'history' in result) {
				const history = /** @type {any} */ (result.history);
				if (history.pruned) {
					try {
						const older = await indexer.history({
							chain,
							address,
							indexer: endpoints.indexer,
							beforeHeight: history.earliestHeight
						});
						let olderEntries = older.entries;
						let unknownAmounts = older.unknownAmounts;
						let unknownAssets = older.unknownAssets;
						/** @type {{ hash: string, height: number, validator: string, completionTime?: string, time?: string }[]} */
						let unbondings = older.unbondings;
						/** @type {Record<string, unknown>} */
						const archive = {};
						// What the indexer has no amount for, from an archive node's blocks
						// (#1029): in place of what the indexer read of the same transaction.
						if (endpoints.archive && older.withoutAmounts.length) {
							try {
								const got = await cosmos.archived({
									chain,
									address,
									rpc: endpoints.archive,
									txs: older.withoutAmounts
								});
								olderEntries = [
									...olderEntries.filter((e) => !got.read.has(e.hash)),
									...got.entries
								].sort((a, b) => a.height - b.height);
								unknownAmounts -= got.read.size;
								unknownAssets += got.unknownAssets;
								unbondings = [
									...unbondings.filter((u) => !got.read.has(u.hash)),
									...got.unbondings
								];
								archive.archiveRead = got.read.size;
							} catch (/** @type {any} */ error) {
								archive.archiveError = String(error?.code ?? 'WALLET_ARCHIVE');
							}
						}
						// The tokens those undelegations gave back: from the archive node,
						// else from the node, whose window may still hold the block they ended in.
						const returned = await cosmos.unbondingReturns({
							chain,
							address,
							rpc: endpoints.archive || endpoints.rpc,
							rest: endpoints.rest,
							floor: endpoints.archive && !archive.archiveError ? 1 : history.earliestHeight,
							unbondings
						});
						const ids = new Set(result.entries.map((e) => e.id));
						const returns = returned.entries.filter((e) => !ids.has(e.id));
						const before = history.unbonding ?? { returned: 0, pending: 0, unread: 0 };
						result = {
							...result,
							entries: [...olderEntries, ...result.entries, ...returns].sort(
								(a, b) => a.height - b.height
							),
							transactions: result.transactions + older.transactions,
							unknownAssets: result.unknownAssets + unknownAssets,
							history: {
								...history,
								completedBy: 'indexer',
								unknownAmounts,
								indexerFrom: older.earliestTime,
								...archive,
								unbonding: {
									returned: before.returned + returns.length,
									pending: before.pending + returned.pending,
									unread: before.unread + returned.unread
								}
							}
						};
					} catch (/** @type {any} */ error) {
						result = {
							...result,
							history: { ...history, indexerError: String(error?.code ?? 'WALLET_INDEXER') }
						};
					}
				}
			}
			// Transactions another source names for this wallet (an exchange's
			// withdrawal hash, #303): asked of the indexer where the address's
			// own reading has none of them – its listing can leave one out.
			const hashes = Array.isArray(request?.hashes)
				? [
						...new Set(
							request.hashes
								.map((/** @type {unknown} */ h) => String(h ?? '').toUpperCase())
								.filter((/** @type {string} */ h) => /^[0-9A-F]{64}$/.test(h))
						)
					].slice(0, 100)
				: [];
			if (chain.kind === 'cosmos' && endpoints.indexer && hashes.length) {
				const known = new Set(result.entries.map((e) => String(e.hash).toUpperCase()));
				const missing = hashes.filter((h) => !known.has(h));
				if (missing.length) {
					const named = await indexer.byHashes({
						chain,
						address,
						indexer: endpoints.indexer,
						hashes: missing
					});
					result = {
						...result,
						entries: [...named.entries, ...result.entries].sort((a, b) => a.height - b.height),
						transactions: result.transactions + named.found,
						history: { .../** @type {any} */ (result.history ?? {}), byHash: named.found }
					};
				}
			}
			return { chain: chain.id, endpoints, ...result };
		},

		/**
		 * An Akash wallet's deployments with what each cost (#305), for the
		 * monthly usage statement.
		 *
		 * @param {{ address?: unknown, endpoints?: unknown }} request
		 */
		async akashDeployments(request) {
			const chain = chainOf('akash');
			if (!chain || chain.kind !== 'cosmos') throw new WalletError('no Akash', 'WALLET_CHAIN', 400);
			const address = typeof request?.address === 'string' ? request.address.trim() : '';
			if (!isCosmosAddress(address, chain.bech32Prefix)) {
				throw new WalletError('not an Akash address', 'WALLET_ADDRESS', 400);
			}
			const { endpoints } = endpointsOf(chain, request);
			return {
				deployments: await deployments.deployments({
					address,
					rest: endpoints.rest,
					indexer: endpoints.indexer
				}),
				actBalance: await deployments.actBalance({ address, rest: endpoints.rest })
			};
		}
	};
}
