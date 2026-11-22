// SPDX-License-Identifier: AGPL-3.0-or-later
// The output script of a Bitcoin-like address (Bitcoin, Doichain): base58check
// P2PKH and P2SH, bech32 SegWit v0 and bech32m v1–16 (BIP173, BIP350), by the
// chain's prefixes. Shared by the Doichain and the Bitcoin address readers,
// so neither bundles the other.

import { bech32, bech32m, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

const base58check = createBase58check(sha256);

/**
 * The output script of an address, or null where it is none of this chain.
 *
 * @param {string} address
 * @param {{ address: { bech32: string, pubKeyHash: number, scriptHash: number } }} chain its prefixes
 * @returns {Uint8Array | null}
 */
export function scriptOf(address, chain) {
	if (typeof address !== 'string' || address.length < 26 || address.length > 90) return null;
	const { bech32: prefix, pubKeyHash, scriptHash } = chain.address;
	if (address.toLowerCase().startsWith(`${prefix}1`)) {
		for (const coder of [bech32, bech32m]) {
			try {
				const { prefix: found, words } = coder.decode(
					/** @type {`${string}1${string}`} */ (address),
					90
				);
				if (found !== prefix || words.length < 1) return null;
				const version = words[0];
				const program = coder.fromWords(words.slice(1));
				// Version 0 is bech32 with a 20 or 32 byte program; 1 to 16 are bech32m (BIP350).
				if (version === 0 && coder === bech32 && (program.length === 20 || program.length === 32))
					return Uint8Array.of(0x00, program.length, ...program);
				if (
					version >= 1 &&
					version <= 16 &&
					coder === bech32m &&
					program.length >= 2 &&
					program.length <= 40
				)
					return Uint8Array.of(0x50 + version, program.length, ...program);
				return null;
			} catch {
				// the other checksum, or no address
			}
		}
		return null;
	}
	try {
		const payload = base58check.decode(address);
		if (payload.length !== 21) return null;
		const hash = payload.subarray(1);
		if (payload[0] === pubKeyHash) return Uint8Array.of(0x76, 0xa9, 0x14, ...hash, 0x88, 0xac);
		if (payload[0] === scriptHash) return Uint8Array.of(0xa9, 0x14, ...hash, 0x87);
	} catch {
		// no base58check
	}
	return null;
}
