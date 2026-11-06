// Bech32 (BIP-173), the address format of Cosmos chains: `n1…` on Nyx,
// `cosmos1…` on the Hub. Only what a read-only wallet needs: check an
// address against the chain's prefix, and derive a module account's address
// (the fee collector, the staking pools) to name it in a booking.
//
// Cosmos addresses are bech32, not bech32m, and their data part is 20 bytes
// (an account) or 32 bytes (a contract or a derived account).

import { createHash } from 'node:crypto';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** @param {number[]} values */
function polymod(values) {
	let chk = 1;
	for (const v of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
	}
	return chk >>> 0;
}

/** @param {string} hrp */
function expand(hrp) {
	const codes = [...hrp].map((c) => c.charCodeAt(0));
	return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

/**
 * @param {number[]} data
 * @param {number} from
 * @param {number} to
 * @param {boolean} pad
 * @returns {number[] | null}
 */
function convertBits(data, from, to, pad) {
	let acc = 0;
	let bits = 0;
	/** @type {number[]} */
	const out = [];
	const max = (1 << to) - 1;
	for (const value of data) {
		if (value < 0 || value >> from) return null;
		acc = (acc << from) | value;
		bits += from;
		while (bits >= to) {
			bits -= to;
			out.push((acc >> bits) & max);
		}
	}
	if (pad) {
		if (bits > 0) out.push((acc << (to - bits)) & max);
	} else if (bits >= from || (acc << (to - bits)) & max) {
		return null;
	}
	return out;
}

/**
 * @param {string} hrp
 * @param {Uint8Array | number[]} bytes
 */
export function bech32Encode(hrp, bytes) {
	const data = /** @type {number[]} */ (convertBits([...bytes], 8, 5, true));
	const mod = polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
	const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
	return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join('')}`;
}

/**
 * `n1…` → its prefix and bytes; null when it is no valid bech32 string
 * (mixed case, a wrong checksum, a character outside the charset).
 *
 * @param {string} text
 * @returns {{ hrp: string, bytes: Uint8Array } | null}
 */
export function bech32Decode(text) {
	if (typeof text !== 'string' || text.length < 8 || text.length > 90) return null;
	if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
	const s = text.toLowerCase();
	const sep = s.lastIndexOf('1');
	if (sep < 1 || sep + 7 > s.length) return null;
	const hrp = s.slice(0, sep);
	if (![...hrp].every((c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126)) return null;
	/** @type {number[]} */
	const data = [];
	for (const c of s.slice(sep + 1)) {
		const d = CHARSET.indexOf(c);
		if (d === -1) return null;
		data.push(d);
	}
	if (polymod([...expand(hrp), ...data]) !== 1) return null;
	const bytes = convertBits(data.slice(0, -6), 5, 8, false);
	return bytes ? { hrp, bytes: Uint8Array.from(bytes) } : null;
}

/**
 * Whether `address` is an account or contract address on a chain with
 * `prefix`: valid bech32, that prefix, 20 or 32 bytes.
 *
 * @param {string} address
 * @param {string} prefix
 */
export function isCosmosAddress(address, prefix) {
	const decoded = bech32Decode(address);
	return Boolean(
		decoded &&
			decoded.hrp === prefix &&
			(decoded.bytes.length === 20 || decoded.bytes.length === 32) &&
			address === address.toLowerCase()
	);
}

/**
 * A module account's address: the first 20 bytes of SHA-256 of its name
 * (cosmos-sdk `authtypes.NewModuleAddress`).
 *
 * @param {string} prefix
 * @param {string} name `fee_collector`, `distribution`, `bonded_tokens_pool`, …
 */
export function moduleAddress(prefix, name) {
	return bech32Encode(prefix, createHash('sha256').update(name).digest().subarray(0, 20));
}
