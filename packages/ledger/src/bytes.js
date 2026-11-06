// SPDX-License-Identifier: AGPL-3.0-or-later
// Bytes, base64, hex and UTF-8 without Node's Buffer, so the chain readers and
// the documents run the same in Node and in a browser. atob/btoa and
// TextEncoder/TextDecoder are globals in both (Node ≥ 16).

/**
 * Base64 (standard or URL-safe, padded or not) to bytes. As lenient as
 * Buffer.from(s, 'base64'), which the readers used before: characters outside
 * the alphabet are skipped, so a stray newline does not fail a read.
 *
 * @param {string} s
 * @returns {Uint8Array}
 */
export function fromBase64(s) {
	let clean = String(s ?? '')
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.replace(/[^A-Za-z0-9+/]/g, '');
	if (clean.length % 4 === 1) clean = clean.slice(0, -1);
	const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} bytes @returns {string} standard base64, padded */
export function toBase64(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

/** @param {string} hex an even number of hex digits, any case @returns {Uint8Array} */
export function fromHex(hex) {
	if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error('not hex');
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** @param {Uint8Array} bytes @returns {string} lowercase hex */
export function toHex(bytes) {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} s @returns {Uint8Array} */
export const utf8 = (s) => new TextEncoder().encode(s);

/** @param {Uint8Array} bytes @returns {string} invalid sequences become U+FFFD, as with Buffer */
export const fromUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);
