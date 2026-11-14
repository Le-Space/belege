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
// Chunks keep every block under what bitswap moves between devices. Without
// device sync the libp2p node has no transports: a read looks locally only
// (`offline: true`), and a missing block fails at once rather than wait. With
// device sync on (sync/device-sync.js, issue #123) the node is online: a block
// this device lacks is fetched from the own devices over bitswap, for at most
// 30 s (`online`). Either way the blocks hold ciphertext only.
//
// `has` tells whether a file is whole on this device, without asking anyone;
// `fetch` brings its blocks here from the own devices without opening them –
// what the background prefetch does (receipts/prefetch.js), so that a file
// is on every device before the one that added it goes offline.

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
 * @param {{ blockstore: BlockstoreLike, key: Uint8Array, online?: boolean }} params
 */
export async function createBlobStore({ blockstore, key, online = false }) {
	const seal = await sealer(key);
	// Offline, a block is here or nowhere. With device sync on (#123), a block
	// this device lacks – a receipt added on another – is asked of the
	// connected devices, for a while.
	/** @param {CID} cid */
	const block = (cid) =>
		collect(
			blockstore.get(cid, online ? { signal: AbortSignal.timeout(30_000) } : { offline: true })
		);

	/** @param {Uint8Array} bytes @returns {CID[] | null} the chunks a root lists, or null */
	function chunksOf(bytes) {
		/** @type {any} */
		const root = dagCbor.decode(bytes);
		if (root?.v !== VERSION || !Array.isArray(root.chunks)) return null;
		return root.chunks.map((/** @type {any} */ c) => CID.asCID(c) ?? CID.parse(String(c)));
	}

	/** @param {string} cid @returns {CID} */
	function rootOf(cid) {
		const rootCid = CID.parse(cid);
		if (rootCid.code !== dagCbor.code) throw new Error('Not a receipt file.');
		return rootCid;
	}

	/** @param {CID} cid */
	const here = async (cid) => {
		try {
			return Boolean(await blockstore.has(cid));
		} catch {
			return false;
		}
	};

	return {
		/**
		 * Whether the file is whole on this device: its root and every chunk.
		 * Asks nobody.
		 *
		 * @param {string} cid the root CID from `put`
		 * @returns {Promise<boolean>}
		 */
		async has(cid) {
			let rootCid;
			try {
				rootCid = rootOf(cid);
			} catch {
				return false;
			}
			if (!(await here(rootCid))) return false;
			const chunks = chunksOf(await collect(blockstore.get(rootCid, { offline: true })));
			if (!chunks) return false;
			for (const chunk of chunks) if (!(await here(chunk))) return false;
			return true;
		},

		/**
		 * Bring the file's blocks to this device from the connected own devices,
		 * without opening them: sealed they come, sealed they stay. A file
		 * larger than `maxBytes` (as its root says) is left for when it is
		 * opened. Throws when a block does not come within `blockMs`.
		 *
		 * @param {string} cid the root CID from `put`
		 * @param {{ signal?: AbortSignal, blockMs?: number, maxBytes?: number }} [options]
		 * @returns {Promise<'here' | 'fetched' | 'too-large'>}
		 */
		async fetch(cid, { signal, blockMs = 30_000, maxBytes = Infinity } = {}) {
			const rootCid = rootOf(cid);
			let fetched = false;
			/** @param {CID} c */
			const bring = async (c) => {
				if (await here(c)) return collect(blockstore.get(c, { offline: true }));
				if (!online) throw new Error('A receipt file is not on this device.');
				fetched = true;
				const timeout = AbortSignal.timeout(blockMs);
				return collect(
					blockstore.get(c, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
				);
			};
			const rootBytes = await bring(rootCid);
			/** @type {any} */
			const root = dagCbor.decode(rootBytes);
			const chunks = chunksOf(rootBytes);
			if (!chunks || typeof root.size !== 'number') throw new Error('Not a receipt file.');
			if (root.size > maxBytes) return 'too-large';
			for (const chunk of chunks) {
				signal?.throwIfAborted();
				if (!(await here(chunk))) await bring(chunk);
			}
			return fetched ? 'fetched' : 'here';
		},

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
			const root = dagCbor.decode(await block(rootCid));
			if (root?.v !== VERSION || !Array.isArray(root.chunks))
				throw new Error('Not a receipt file.');
			/** @type {Uint8Array[]} */
			const parts = [];
			for (const chunk of root.chunks) {
				parts.push(await block(CID.asCID(chunk) ?? CID.parse(String(chunk))));
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
