// One SHA-256 for the app: bytes as they are, a string as its UTF-8, the
// digest as lowercase hex.

import { toHex } from '@le-space/ledger/bytes';

/**
 * @param {Uint8Array | string} input
 * @returns {Promise<string>} lowercase hex, 64 digits
 */
export async function sha256Hex(input) {
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	const digest = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes));
	return toHex(new Uint8Array(digest));
}
