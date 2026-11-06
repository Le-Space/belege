// A Filecoin wallet given by its Ethereum-style address: `0x…` is the same
// account as `f410f…`, its delegated Filecoin address (namespace 10, the
// Ethereum address manager). The app keeps the f410f form, so a wallet is one
// whichever way it was typed, and its own address matches the Filecoin
// addresses Filfox names in its bookings. The conversion is the chain
// reader's own (@le-space/chains, `toFilecoinAddress`), which runs in a
// browser too.

export { toFilecoinAddress } from '@le-space/chains/filecoin';

/** @param {unknown} address @returns {boolean} */
export const isEthStyle = (address) => /^0x[0-9a-fA-F]{40}$/.test(String(address ?? '').trim());
