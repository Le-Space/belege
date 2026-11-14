// A big answer of the bridge's node as sealed blocks (Le-Space/belege#578):
// the node answered a command with the root CID of the bytes instead of the
// bytes (bridge/src/blocks.js); here they are fetched over bitswap from the
// node through the proved connection, opened with the key derived from the
// bridge's own key (@le-space/bridge-protocol `bridgeBlockKey`), checked
// against the size the answer named, and taken out of this browser's
// blockstore again – they were sealed for one answer, not for keeping. A
// bridge that names something else gets nothing deleted and nothing kept.
//
// The blocks are in the format of the app's receipt files (receipts/
// blob-store.js), so the code that reads those reads these.
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {
	BLOCK_CHUNK_BYTES,
	BLOCK_VERSION,
	MAX_BLOCK_ANSWER,
	bridgeBlockKey
} from '@le-space/bridge-protocol';

import { createBlobStore } from '../receipts/blob-store.js';

/** What sealing adds: the nonce and the tag. */
const SEAL_BYTES = 12 + 16;
/** How long one answer may take to come, all its blocks together. */
export const FETCH_MS = 5 * 60_000;

/**
 * Whether a stream answer names blocks, and they look like an answer's.
 *
 * @param {unknown} block
 * @returns {block is { cid: string, size: number }}
 */
export function isBlockAnswer(block) {
	const b = /** @type {any} */ (block);
	return (
		Boolean(b) &&
		typeof b.cid === 'string' &&
		b.cid.length <= 128 &&
		Number.isSafeInteger(b.size) &&
		b.size >= 0 &&
		b.size <= MAX_BLOCK_ANSWER
	);
}

/**
 * The bytes of a big answer, from the bridge's node over bitswap.
 *
 * What the bridge names is checked before a chunk is asked for: a root this
 * browser already holds is refused (a receipt's own file is no answer, and
 * nothing of it is touched), the root must seal exactly the size the answer
 * named in exactly as many chunks of at most 1 MiB, and the whole answer has
 * `FETCH_MS`. Afterwards only what this fetch brought is deleted, straight
 * from the local store: Helia's own delete asks the routers first and, with
 * none, deletes nothing.
 *
 * @param {object} p
 * @param {any} p.blockstore Helia's blockstore, online (bitswap asks the connected peers)
 * @param {any} p.store the store under it (session `localBlockstore`): what is here, and what goes
 * @param {Uint8Array} p.authKey the bridge's own key of this pairing (session `bridgeAuth.key`)
 * @param {{ cid: string, size: number }} p.block as the answer named it
 * @param {number} [p.timeoutMs]
 * @returns {Promise<Uint8Array>} the plaintext; throws when it is not what the answer named
 */
export async function fetchBridgeBlock({
	blockstore,
	store,
	authKey,
	block,
	timeoutMs = FETCH_MS
}) {
	if (!isBlockAnswer(block)) throw new Error('Not a bridge answer.');
	const root = CID.parse(block.cid);
	if (root.code !== dagCbor.code) throw new Error('Not a bridge answer.');
	if (await store.has(root)) throw new Error('Not a bridge answer.');
	/** What this fetch brought, and only that, goes afterwards. */
	const fresh = [root];
	const overall = AbortSignal.timeout(timeoutMs);
	const sealed = block.size + SEAL_BYTES;
	const chunkCount = Math.ceil(sealed / BLOCK_CHUNK_BYTES);

	const guarded = {
		put: (/** @type {any} */ cid, /** @type {Uint8Array} */ bytes) => blockstore.put(cid, bytes),
		/** @param {CID} cid @param {any} [options] */
		async *get(cid, options) {
			const signal = options?.signal ? AbortSignal.any([options.signal, overall]) : overall;
			const bytes = join(await parts(blockstore.get(cid, { ...options, signal })));
			if (cid.equals(root)) {
				const decoded = /** @type {any} */ (dagCbor.decode(bytes));
				if (
					decoded?.v !== BLOCK_VERSION ||
					decoded.size !== sealed ||
					!Array.isArray(decoded.chunks) ||
					decoded.chunks.length !== chunkCount
				) {
					throw new Error('Not a bridge answer.');
				}
				for (const c of decoded.chunks) {
					const chunk = CID.asCID(c);
					if (!chunk || chunk.code !== raw.code) throw new Error('Not a bridge answer.');
					if (!(await store.has(chunk))) fresh.push(chunk);
				}
			} else if (bytes.length > BLOCK_CHUNK_BYTES) {
				throw new Error('Not a bridge answer.');
			}
			yield bytes;
		}
	};
	const blobs = await createBlobStore({
		blockstore: guarded,
		key: await bridgeBlockKey(authKey),
		online: true
	});
	try {
		const bytes = await blobs.get(block.cid);
		if (bytes.length !== block.size) throw new Error('A bridge answer is incomplete.');
		return bytes;
	} finally {
		for (const cid of fresh) await store.delete(cid).catch(() => {});
	}
}

/** @param {any} got bytes, or an iterable of chunks @returns {Promise<Uint8Array[]>} */
async function parts(got) {
	const value = await got;
	if (value instanceof Uint8Array) return [value];
	/** @type {Uint8Array[]} */
	const out = [];
	for await (const part of value) out.push(part);
	return out;
}

/** @param {Uint8Array[]} list */
function join(list) {
	if (list.length === 1) return list[0];
	const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of list) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
