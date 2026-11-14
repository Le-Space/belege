// SPDX-License-Identifier: AGPL-3.0-or-later
// Big answers as blocks (Le-Space/belege#578, milestone M2 of #567).
//
// An answer of bytes that does not fit a stream answer – a mail attachment, a
// raw mail, a Paperless original – is sealed on the bridge and put into its
// blockstore; the command answers `{ status, contentType, block: { cid, size } }`
// and the device fetches the blocks over bitswap through the proved
// connection, then tells the bridge to let them go (`blocks.release`).
//
// The format is the one the app keeps receipt files in (app/src/lib/receipts/
// blob-store.js): the bytes sealed as a whole with AES-256-GCM – a fresh
// 12-byte nonce, then ciphertext and tag – cut into raw blocks of at most
// 1 MiB, and a dag-cbor root `{ v: 1, size, chunks }` whose CID is the one
// the answer names. No block holds plaintext.
//
// The key is derived from the bridge's own key of this pairing (`bridgeAuth`,
// node.js), which the bridge holds and every device that may call it derives
// in the browser: HKDF-SHA-256 with its own info, so it is not the key that
// proves the bridge.

/** HKDF info of the key that seals the bridge's blocks. */
export const BLOCK_KEY_INFO = 'belege/bridge-blocks/v1';
/** The most bytes in one raw block; below what bitswap moves in one message. */
export const BLOCK_CHUNK_BYTES = 1024 * 1024;
/** The most bytes an answer may be as blocks (the bridge's biggest answers are Paperless originals). */
export const MAX_BLOCK_ANSWER = 256 * 1024 * 1024;
/** The root block's version. */
export const BLOCK_VERSION = 1;

/**
 * The key that seals the bridge's blocks, from the bridge's own key.
 *
 * @param {Uint8Array} authKey the bridge's key of this pairing, 32 bytes
 * @returns {Promise<Uint8Array>} 32 bytes, for AES-256-GCM
 */
export async function bridgeBlockKey(authKey) {
	if (!(authKey instanceof Uint8Array) || authKey.length !== 32) {
		throw new Error('The bridge key must be 32 bytes.');
	}
	const base = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (authKey),
		'HKDF',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(BLOCK_KEY_INFO)
		},
		base,
		256
	);
	return new Uint8Array(bits);
}
