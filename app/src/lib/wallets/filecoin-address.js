// A Filecoin wallet given by its Ethereum-style address: `0x…` is the same
// account as `f410f…`, its delegated Filecoin address (namespace 10, the
// Ethereum address manager). The app keeps the f410f form, so a wallet is one
// whichever way it was typed, and its own address matches the Filecoin
// addresses Filfox names in its bookings. The same conversion as the
// bridge's (bridge/src/chains/filecoin.js `toFilecoinAddress`); both tests
// pin one value.

import { blake2b } from '@noble/hashes/blake2.js';
import { base32nopad } from '@scure/base';

/** @param {unknown} address @returns {boolean} */
export const isEthStyle = (address) => /^0x[0-9a-fA-F]{40}$/.test(String(address ?? '').trim());

/**
 * `0x…` → `f410f…`; anything else as it was, trimmed.
 *
 * @param {unknown} address
 */
export function toFilecoinAddress(address) {
	const a = String(address ?? '').trim();
	if (!isEthStyle(a)) return a;
	const payload = new Uint8Array(20);
	for (let i = 0; i < 20; i++) payload[i] = parseInt(a.slice(2 + i * 2, 4 + i * 2), 16);
	const sum = blake2b(new Uint8Array([4, 10, ...payload]), { dkLen: 4 });
	return `f410f${base32nopad.encode(new Uint8Array([...payload, ...sum])).toLowerCase()}`;
}
