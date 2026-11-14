// SPDX-License-Identifier: AGPL-3.0-or-later
// A big answer of the bridge as sealed blocks (Le-Space/belege#578): a mail
// attachment, a raw mail or a Paperless original does not fit a UCEP answer
// (1 MiB direct, 64 KiB relayed), so the bridge seals the bytes, cuts them
// into blocks and answers with the root's CID, the size and the key; the
// device fetches the blocks over Bitswap on the proved connection
// (exchange.js) and opens them here.
//
// The layout is the one receipt files have between devices (app
// receipts/blob-store.js): AES-256-GCM over the whole file with a fresh
// 12-byte nonce in front, the sealed bytes in raw blocks of at most 1 MiB, and
// a dag-cbor root `{ v: 1, size, chunks }` that names them. No block holds
// plaintext. The key is made for this one answer and travels in the answer,
// never with the blocks; whoever holds only blocks holds ciphertext.

import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

/** The largest block: what Bitswap moves in one message with room to spare. */
export const CHUNK_BYTES = 1024 * 1024;
/** The largest file a block answer carries (a Paperless original is at most 15 MB). */
export const MAX_BLOCK_ANSWER = 32 * 1024 * 1024;
const VERSION = 1;
const NONCE_BYTES = 12;

/** @param {Uint8Array} bytes */
async function cidOf(bytes, code = raw.code) {
	return CID.createV1(code, await sha256.digest(bytes));
}

/** @param {Uint8Array} key @param {KeyUsage} usage */
const aesKey = (key, usage) =>
	crypto.subtle.importKey('raw', Uint8Array.from(key), { name: 'AES-GCM' }, false, [usage]);

/**
 * Seal and cut: the blocks to offer, and what the answer names.
 *
 * @param {Uint8Array} bytes
 * @param {{ chunkBytes?: number }} [options]
 * @returns {Promise<{ root: CID, size: number, key: Uint8Array, blocks: { cid: CID, bytes: Uint8Array }[] }>}
 */
export async function sealBlocks(bytes, { chunkBytes = CHUNK_BYTES } = {}) {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
	if (bytes.length > MAX_BLOCK_ANSWER) throw new RangeError('too big for a block answer');
	const key = crypto.getRandomValues(new Uint8Array(32));
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const cipher = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce },
			await aesKey(key, 'encrypt'),
			Uint8Array.from(bytes)
		)
	);
	const sealed = new Uint8Array(nonce.length + cipher.length);
	sealed.set(nonce);
	sealed.set(cipher, nonce.length);

	/** @type {{ cid: CID, bytes: Uint8Array }[]} */
	const blocks = [];
	for (let at = 0; at < sealed.length; at += chunkBytes) {
		const chunk = sealed.subarray(at, Math.min(at + chunkBytes, sealed.length));
		blocks.push({ cid: await cidOf(chunk), bytes: chunk });
	}
	const rootBytes = dagCbor.encode({
		v: VERSION,
		size: sealed.length,
		chunks: blocks.map((b) => b.cid)
	});
	const root = await cidOf(rootBytes, dagCbor.code);
	return { root, size: bytes.length, key, blocks: [{ cid: root, bytes: rootBytes }, ...blocks] };
}

/**
 * Fetch and open: every block checked against its CID, the whole against
 * the key (AES-GCM's tag) and the size the answer named.
 *
 * @param {(cid: CID) => Promise<Uint8Array>} get a block's bytes
 * @param {CID | string} root
 * @param {Uint8Array} key
 * @param {{ size?: number, lanes?: number }} [options] `lanes`: blocks fetched side by side
 * @returns {Promise<Uint8Array>}
 */
export async function openBlocks(get, root, key, { size, lanes = 4 } = {}) {
	const rootCid = typeof root === 'string' ? CID.parse(root) : root;
	if (rootCid.code !== dagCbor.code) throw new Error('not a block answer');
	const node = /** @type {any} */ (dagCbor.decode(await checked(get, rootCid)));
	if (node?.v !== VERSION || !Array.isArray(node.chunks) || !Number.isSafeInteger(node.size)) {
		throw new Error('not a block answer');
	}
	if (node.size > MAX_BLOCK_ANSWER + NONCE_BYTES + 16) throw new RangeError('too big');
	/** @type {CID[]} */
	const chunks = node.chunks.map((/** @type {unknown} */ c) => {
		const cid = CID.asCID(c);
		if (!cid || cid.code !== raw.code) throw new Error('not a block answer');
		return cid;
	});
	/** @type {Uint8Array[]} */
	const parts = new Array(chunks.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(lanes, chunks.length) }, async () => {
			while (next < chunks.length) {
				const i = next++;
				parts[i] = await checked(get, chunks[i]);
			}
		})
	);
	const sealed = concat(parts);
	if (sealed.length !== node.size) throw new Error('the blocks do not add up');
	const plain = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sealed.subarray(0, NONCE_BYTES) },
			await aesKey(key, 'decrypt'),
			sealed.subarray(NONCE_BYTES)
		)
	);
	if (size !== undefined && plain.length !== size) throw new Error('not the size the answer named');
	return plain;
}

/**
 * A block, checked against its CID: Bitswap checks too, but a `get` may be
 * any blockstore.
 *
 * @param {(cid: CID) => Promise<Uint8Array>} get
 * @param {CID} cid
 */
async function checked(get, cid) {
	const bytes = await get(cid);
	const again = await cidOf(bytes, cid.code);
	if (!again.equals(cid)) throw new Error('a block does not match its CID');
	return bytes;
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

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** @param {string} b64 */
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
