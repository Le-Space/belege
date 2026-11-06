// @belege/chain-filecoin: a Filecoin wallet, read only, by its address
// through Filfox (#242, #301), as neutral WalletEntry records
// (@belege/chain-core).
export { FILECOIN } from './chain.js';
export {
	createFilecoinClient,
	isFilecoinAddress,
	normalizeFilecoin,
	normalizeFilecoinTokens,
	toFilecoinAddress
} from './filecoin.js';

/** @typedef {import('./chain.js').FilecoinChain} FilecoinChain */
