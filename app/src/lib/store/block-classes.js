// What a block in the books' block store is: sealed, public by design, or
// neither. For tests only (audit plan #209, #537) – the app imports none of it.
//
// The block store is what a peer could be handed and what lies in IndexedDB,
// so every block in it is either
//   - sealed: a log entry under the replication key, or a chunk of a receipt
//     file under the blob key, or
//   - public by design: what OrbitDB needs before any key is there – a
//     database's manifest (its derived name, type and access controller), an
//     access controller's manifest (who may write: public keys), an identity
//     (public key and signatures), and the root of a receipt file (its sealed
//     size and its chunks).
// Anything else is `neither`, and a test that finds one fails.
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';

import { deterministicSealer, sealer } from '../db-encryption.js';

/** By its hash: a block store hands every block out under a raw CID, whatever it was put under. */
const hashOf = (/** @type {CID} */ cid) => Buffer.from(cid.multihash.bytes).toString('hex');
/** @param {Record<string, unknown>} value @param {string[]} keys */
const hasExactly = (value, keys) => Object.keys(value).sort().join() === [...keys].sort().join();

/**
 * @typedef {'sealed entry' | 'sealed file chunk' | 'manifest' | 'access controller' | 'identity' | 'file root' | 'neither'} BlockClass
 */

/**
 * @param {{ cid: CID | string, bytes: Uint8Array }[]} blocks every block of the store
 * @param {{ replicationKey: Uint8Array, blobKey?: Uint8Array }} keys
 * @returns {Promise<{ cid: string, class: BlockClass, bytes: number, reveals?: Record<string, unknown> }[]>}
 *   `reveals`: what a public block says to anyone who holds it
 */
export async function classifyBlocks(blocks, { replicationKey, blobKey }) {
	const entries = await deterministicSealer(replicationKey);
	const files = blobKey ? await sealer(blobKey) : null;
	const all = blocks.map((b) => ({
		cid: typeof b.cid === 'string' ? CID.parse(b.cid) : b.cid,
		bytes: b.bytes
	}));
	const byHash = new Map(all.map((b) => [hashOf(b.cid), b]));
	/** @type {Map<string, { class: BlockClass, reveals?: Record<string, unknown> }>} */
	const found = new Map();

	for (const { cid, bytes } of all) {
		/** @type {any} */
		let value;
		try {
			value = dagCbor.decode(bytes);
		} catch {
			// Not a structure: a file's chunk, if a root names it (below).
			continue;
		}
		if (value instanceof Uint8Array) {
			// A log entry: the whole entry, sealed once more (entry-encryption.js).
			const opens = await entries.open(value).then(
				() => true,
				() => false
			);
			found.set(cid.toString(), { class: opens ? 'sealed entry' : 'neither' });
		} else if (!value || typeof value !== 'object' || Array.isArray(value)) {
			found.set(cid.toString(), { class: 'neither' });
		} else if (
			hasExactly(value, ['name', 'type', 'accessController']) &&
			// A derived name (database-keys.js): it says nothing of what the database holds.
			/^[0-9a-f]{32}$/.test(String(value.name)) &&
			['documents', 'keyvalue'].includes(value.type) &&
			/^\/(ipfs|orbitdb)\/[A-Za-z0-9]+$/.test(String(value.accessController))
		) {
			found.set(cid.toString(), { class: 'manifest', reveals: value });
		} else if (
			hasExactly(value, ['type', 'write']) &&
			value.type === 'ipfs' &&
			Array.isArray(value.write) &&
			value.write.every((/** @type {unknown} */ w) =>
				/^([0-9a-f]{66}|did:key:z[A-Za-z0-9]+|\*)$/.test(String(w))
			)
		) {
			found.set(cid.toString(), { class: 'access controller', reveals: value });
		} else if (hasExactly(value, ['id', 'publicKey', 'signatures', 'type'])) {
			found.set(cid.toString(), {
				class: 'identity',
				reveals: { id: value.id, type: value.type, publicKey: value.publicKey }
			});
		} else if (
			hasExactly(value, ['v', 'size', 'chunks']) &&
			Array.isArray(value.chunks) &&
			value.chunks.every((/** @type {unknown} */ c) => CID.asCID(c))
		) {
			// A receipt file: its chunks together must open under the blob key.
			const chunks = value.chunks.map((/** @type {CID} */ c) => byHash.get(hashOf(c)));
			let sealed = false;
			if (files && chunks.every(Boolean)) {
				const whole = new Uint8Array(value.size);
				let at = 0;
				for (const chunk of chunks) {
					whole.set(chunk.bytes.subarray(0, value.size - at), at);
					at += chunk.bytes.length;
				}
				sealed =
					at === value.size &&
					(await files.open(whole).then(
						() => true,
						() => false
					));
			}
			found.set(cid.toString(), {
				class: sealed ? 'file root' : 'neither',
				reveals: { size: value.size, chunks: value.chunks.length }
			});
			if (sealed) {
				for (const chunk of chunks) {
					found.set(chunk.cid.toString(), { class: 'sealed file chunk' });
				}
			}
		} else {
			found.set(cid.toString(), { class: 'neither' });
		}
	}

	return all.map(({ cid, bytes }) => ({
		cid: cid.toString(),
		bytes: bytes.length,
		// Bytes that are no structure and that no file's root names are nobody's.
		...(found.get(cid.toString()) ?? { class: /** @type {BlockClass} */ ('neither') })
	}));
}
