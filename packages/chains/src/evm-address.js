// SPDX-License-Identifier: AGPL-3.0-or-later
// An EVM address on its own: the EIP-55 checksum and the check of an
// address's form. Only keccak and bytes – no reader, no registry, no
// Alchemy – so a module that only needs an address (aleph.js, a browser
// form) does not bundle the EVM reader. evm.js re-exports both.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex, utf8 } from '@le-space/ledger/bytes';

/**
 * EIP-55: the mixed-case checksum of an address.
 *
 * @param {string} address 0x + 40 hex
 */
export function toChecksumAddress(address) {
	const hex = address.slice(2).toLowerCase();
	const hash = toHex(keccak_256(utf8(hex)));
	let out = '0x';
	for (let i = 0; i < 40; i++) {
		out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
	}
	return out;
}

/**
 * 0x + 40 hex; when it mixes cases, the EIP-55 checksum must hold (a typo
 * then shows). All lower or all upper case carries no checksum.
 *
 * @param {string} address
 */
export function isEvmAddress(address) {
	if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
	const body = address.slice(2);
	if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
	return toChecksumAddress(address) === address;
}
