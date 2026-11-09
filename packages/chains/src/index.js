// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/chains: own wallets on public chains, read only, by their
// address – as @le-space/ledger WalletEntry records (NEAR: LedgerEntry).
// Runs in a browser and in Node: `fetch`, endpoints and keys (an Alchemy key,
// a NearBlocks key, a Bitcoin zpub) are handed in by the caller; nothing is
// read from disk, a keychain or the environment.
//
//   createWalletService   every chain behind one call (Belege's bridge)
//   cosmos                Nym's Nyx, Akash (CometBFT RPC + REST, the Akash
//                         Console indexer, deployments)
//   evm                   Ethereum, Base, Polygon, … (Blockscout, Alchemy)
//   bitcoin               Esplora, addresses from a zpub/xpub
//   filecoin              Filfox; `readFilecoin`/`statementFilecoin` give
//                         LedgerEntry for the documents
//   akash                 Akash as LedgerEntry (`akash` here, or `/akash`);
//                         `evmReader(chain)` the same for Ethereum and Base
//   near                  NearBlocks + an archival RPC (from Eigenbeleg);
//                         `near` here, or `@le-space/chains/near`
//   aleph                 Aleph Cloud credits (no chain: Aleph's API, by the
//                         Ethereum address); `aleph` here, or `/aleph`

export * from './core.js';
export { CHAINS, KNOWN_EVM_CONTRACTS, chainOf, publicChains } from './registry.js';
export { createWalletService } from './wallets.js';

export { AKASH_CHAIN, NYX_CHAIN } from './cosmos-chains.js';
export {
	createCosmosClient,
	denomLabel,
	normalizeCosmosTx,
	parseCoins,
	readEvents,
	transfersOf,
	untransferredOf,
	markBmeSwap
} from './cosmos.js';
export { bech32Decode, bech32Encode, isCosmosAddress, moduleAddress } from './bech32.js';
export { decodeTx, encodeTx } from './protobuf.js';
export { createAkashConsoleClient, normalizeConsoleTx } from './akash-console.js';
export { createAkashDeploymentsClient, decUnits } from './akash-deployments.js';
export * as akash from './akash.js';

export {
	createEvmClient,
	evmReader,
	isEvmAddress,
	normalizeEvm,
	toChecksumAddress
} from './evm.js';
export { alchemyBaseUrl, computeUnitsOf, createAlchemyReader, isAlchemyKey } from './alchemy.js';

export {
	ADDRESS_TYPES,
	createBitcoinClient,
	deriveAddress,
	keyFingerprint,
	normalizeBitcoin,
	parseExtendedKey,
	parseStoredKey
} from './bitcoin.js';

export { FILECOIN } from './filecoin-chain.js';
export {
	createFilecoinClient,
	isFilecoinAddress,
	normalizeFilecoin,
	normalizeFilecoinTokens,
	readFilecoin,
	statementFilecoin,
	toFilecoinAddress
} from './filecoin.js';

/** @typedef {import('./cosmos-chains.js').CosmosChain} CosmosChain */
/** @typedef {import('./filecoin-chain.js').FilecoinChain} FilecoinChain */
/** @typedef {import('./registry.js').Chain} Chain */
/** @typedef {import('@le-space/ledger/wallet-entry').WalletEntry} WalletEntry */
export * as near from './near.js';
export * as aleph from './aleph.js';
