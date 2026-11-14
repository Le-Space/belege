// Big answers as sealed blocks (Le-Space/belege#578, M2 of #567).
//
// An answer of bytes that does not fit a stream answer is sealed here and put
// into the node's blockstore; the command answers its root CID and size, and
// the device fetches the blocks over bitswap through the proved connection
// (node.js: bitswap is behind the device gate like every other protocol).
// The format and the key are @le-space/bridge-protocol's (blocks.js): the
// app reads them with the code that reads its receipt files.
//
// What is put here is held for one device and a short while only: the device
// that got the answer lets it go once it has the bytes (`blocks.release`),
// and whatever it does not fetch is dropped after `ttlMs`. The shelf holds at
// most `maxBytes` at once; above that a new answer is refused, not queued.
// Nothing is written to disk: the blockstore lives in memory.

import * as dagCbor from '@ipld/dag-cbor';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { UcepError } from '@le-space/ucep';
import {
	BLOCK_CHUNK_BYTES,
	BLOCK_VERSION,
	MAX_BLOCK_ANSWER,
	bridgeBlockKey
} from '@le-space/bridge-protocol';

/** How long an answer waits for its device. */
export const BLOCK_TTL_MS = 10 * 60_000;
/** The most bytes the shelf holds at once, sealed. */
export const MAX_SHELF_BYTES = 512 * 1024 * 1024;
const NONCE_BYTES = 12;

/**
 * @typedef {object} Shelved
 * @property {string} peer the device it is for
 * @property {CID[]} cids the root and its chunks
 * @property {number} bytes sealed
 * @property {number} until when it is dropped
 */

/**
 * @param {object} p
 * @param {{ put: (cid: CID, bytes: Uint8Array) => Promise<unknown>, delete: (cid: CID) => Promise<unknown> }} p.blockstore
 * @param {Uint8Array} p.authKey the bridge's own key of this pairing
 * @param {number} [p.ttlMs]
 * @param {number} [p.maxBytes]
 * @param {() => number} [p.now]
 */
export async function createBlockShelf({
	blockstore,
	authKey,
	ttlMs = BLOCK_TTL_MS,
	maxBytes = MAX_SHELF_BYTES,
	now = Date.now
}) {
	const key = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (await bridgeBlockKey(authKey)),
		'AES-GCM',
		false,
		['encrypt']
	);
	/** @type {Map<string, Shelved>} root CID → what it holds */
	const shelved = new Map();
	let held = 0;

	/** @param {string} root */
	async function drop(root) {
		const s = shelved.get(root);
		if (!s) return;
		shelved.delete(root);
		held -= s.bytes;
		for (const cid of s.cids) await blockstore.delete(cid);
	}

	async function sweep() {
		const t = now();
		for (const [root, s] of [...shelved]) if (s.until <= t) await drop(root);
	}

	return {
		/**
		 * Seal bytes for one device and put them up as blocks.
		 *
		 * @param {Uint8Array} bytes the plaintext answer
		 * @param {string} peer the device that asked
		 * @returns {Promise<{ cid: string, size: number }>} the root CID and the plaintext's size
		 */
		async put(bytes, peer) {
			await sweep();
			if (bytes.length > MAX_BLOCK_ANSWER) {
				throw new UcepError('TOO_LARGE', 'too big even as blocks');
			}
			const sealedSize = NONCE_BYTES + bytes.length + 16;
			if (held + sealedSize > maxBytes) {
				throw new UcepError('UNAVAILABLE', 'too many big answers waiting: try again shortly');
			}
			const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
			const cipher = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (nonce) },
					key,
					/** @type {BufferSource} */ (bytes)
				)
			);
			const sealed = new Uint8Array(nonce.length + cipher.length);
			sealed.set(nonce, 0);
			sealed.set(cipher, nonce.length);
			/** @type {CID[]} */
			const chunks = [];
			for (let at = 0; at < sealed.length; at += BLOCK_CHUNK_BYTES) {
				const chunk = sealed.subarray(at, at + BLOCK_CHUNK_BYTES);
				const cid = CID.createV1(raw.code, await sha256.digest(chunk));
				await blockstore.put(cid, chunk);
				chunks.push(cid);
			}
			const rootBytes = dagCbor.encode({ v: BLOCK_VERSION, size: sealed.length, chunks });
			const rootCid = CID.createV1(dagCbor.code, await sha256.digest(rootBytes));
			await blockstore.put(rootCid, rootBytes);
			const root = rootCid.toString();
			// The same bytes twice for one device are one entry: a fresh nonce makes that rare.
			if (!shelved.has(root)) {
				shelved.set(root, {
					peer,
					cids: [rootCid, ...chunks],
					bytes: sealed.length,
					until: now() + ttlMs
				});
				held += sealed.length;
			}
			return { cid: root, size: bytes.length };
		},

		/**
		 * The device has the bytes: its blocks go. Another device's, or an
		 * unknown CID, is left alone.
		 *
		 * @param {unknown} cid
		 * @param {string} peer the device that says so
		 * @returns {Promise<boolean>} whether something went
		 */
		async release(cid, peer) {
			const root = typeof cid === 'string' ? cid : '';
			if (shelved.get(root)?.peer !== peer) return false;
			await drop(root);
			return true;
		},

		sweep,

		/** Everything goes: at stop, and when the bridge is unpaired. */
		async clear() {
			for (const root of [...shelved.keys()]) await drop(root);
		},

		/** What is held now: answers and sealed bytes. */
		held: () => ({ answers: shelved.size, bytes: held })
	};
}
