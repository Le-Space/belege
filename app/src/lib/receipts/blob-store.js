// Receipt files (PDFs, images) in Helia's blockstore, sealed.
//
// A file is sealed as a whole with AES-GCM under the blob key (HKDF info
// `belege/blob-key/v1`, see database-keys.js): a fresh 12-byte nonce, then
// the ciphertext and its tag (db-encryption.js, the same proven code as the
// databases). The sealed bytes are cut into 1 MiB raw blocks, and a small
// dag-cbor root block lists them; the root's CID is the receipt's `fileCid`.
// No block ever holds plaintext: the root carries only the version, the
// sealed size and the chunk CIDs.
//
// Chunks keep every block under what bitswap moves, for the day device sync
// is switched on. Reading only ever looks locally (`offline: true`): the
// libp2p node has no transports, and a missing block must fail, not wait.

import * as dagCbor from '@ipld/dag-cbor';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import { sealer } from '../db-encryption.js';

export const CHUNK_BYTES = 1024 * 1024;
const VERSION = 1;

/**
 * Helia's blockstore, or any interface-blockstore: `put(cid, bytes)` and
 * `get(cid, { offline })`, which returns bytes or (interface-blockstore 7) an
 * iterable of chunks. Typed loosely: the two major versions' types differ.
 *
 * @typedef {any} BlockstoreLike
 */

/** @param {any} got @returns {Promise<Uint8Array>} */
async function collect(got) {
	const value = await got;
	if (value instanceof Uint8Array) return value;
	/** @type {Uint8Array[]} */
	const parts = [];
	for await (const part of value) parts.push(part);
	return concat(parts);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * @param {{ blockstore: BlockstoreLike, key: Uint8Array }} params
 */
export async function createBlobStore({ blockstore, key }) {
	const seal = await sealer(key);

	return {
		/**
		 * @param {Uint8Array} bytes the plaintext file
		 * @returns {Promise<string>} the root CID
		 */
		async put(bytes) {
			const sealed = await seal.seal(bytes);
			/** @type {CID[]} */
			const chunks = [];
			for (let at = 0; at < sealed.length; at += CHUNK_BYTES) {
				const chunk = sealed.subarray(at, at + CHUNK_BYTES);
				const cid = CID.createV1(raw.code, await sha256.digest(chunk));
				await blockstore.put(cid, chunk);
				chunks.push(cid);
			}
			const root = dagCbor.encode({ v: VERSION, size: sealed.length, chunks });
			const rootCid = CID.createV1(dagCbor.code, await sha256.digest(root));
			await blockstore.put(rootCid, root);
			return rootCid.toString();
		},

		/**
		 * @param {string} cid the root CID from `put`
		 * @returns {Promise<Uint8Array>} the plaintext; throws on a wrong key or tampered blocks
		 */
		async get(cid) {
			const rootCid = CID.parse(cid);
			if (rootCid.code !== dagCbor.code) throw new Error('Not a receipt file.');
			/** @type {any} */
			const root = dagCbor.decode(await collect(blockstore.get(rootCid, { offline: true })));
			if (root?.v !== VERSION || !Array.isArray(root.chunks))
				throw new Error('Not a receipt file.');
			/** @type {Uint8Array[]} */
			const parts = [];
			for (const chunk of root.chunks) {
				parts.push(
					await collect(
						blockstore.get(CID.asCID(chunk) ?? CID.parse(String(chunk)), { offline: true })
					)
				);
			}
			const sealed = concat(parts);
			if (sealed.length !== root.size) throw new Error('A receipt file is incomplete.');
			return seal.open(sealed);
		}
	};
}

/** @typedef {Awaited<ReturnType<typeof createBlobStore>>} BlobStore */

/** @param {Uint8Array} bytes @returns {Promise<string>} lower-case hex */
export async function sha256Hex(bytes) {
	const digest = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
