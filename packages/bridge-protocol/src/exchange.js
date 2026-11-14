// SPDX-License-Identifier: AGPL-3.0-or-later
// Bitswap for the bridge's block answers (Le-Space/belege#578), on a protocol
// of its own: `/le-space/bridge-blocks/1.0.0`, not the books' `/ipfs/bitswap/`.
//
// The device's node runs Bitswap for the books' blocks too, and the bridge
// must reach none of that (the device gate keeps it "limited"). A second
// Bitswap under another protocol name keeps the two apart: the bridge offers
// the blocks of its answers there, and the device fetches them there, from a
// store that holds nothing else. What the books keep never answers on it.
//
// No routing: nothing is provided or looked up, the blocks come from the
// peer that answered (AGENTS.md: no DHT, no provide calls). Both sides run it
// on limited (relayed) connections, as the books' Bitswap between devices does.
//
// Who may speak the protocol is the node's device gate's business: on the
// bridge, a proved device of the books; on a device, the peer the books name
// as their bridge (and the devices) – `@belege/device-gate`'s `reach`.

import { withBitswap } from '@helia/bitswap';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import { fromBase64, openBlocks, sealBlocks, toBase64 } from './blocks.js';

export const BLOCKS_PROTOCOL = '/le-space/bridge-blocks/1.0.0';
/** How long the bridge keeps an answer's blocks when the device does not say it has them. */
export const KEEP_MS = 10 * 60_000;
/** How long one block may take before it is asked for again, and how often. */
const BLOCK_TRY_MS = 20_000;
const BLOCK_TRIES = 3;
/** What the bridge holds at most, all answers together. */
export const MAX_HELD_BYTES = 96 * 1024 * 1024;

/** No routing: nothing is looked up or announced. */
const NO_ROUTING = {
	async *findProviders() {},
	async provide() {},
	async cancelReprovide() {},
	async findPeer() {
		throw new Error('no routing');
	},
	async *getClosestPeers() {},
	async get() {
		throw new Error('no routing');
	},
	async put() {}
};

/** @param {number} code */
async function getHasher(code) {
	if (code === sha256.code) return sha256;
	throw new Error('only sha2-256 blocks');
}

/** @param {any} got @returns {Promise<Uint8Array>} */
async function bytesOf(got) {
	const value = await got;
	if (value instanceof Uint8Array) return value;
	/** @type {Uint8Array[]} */
	const parts = [];
	for await (const part of value) parts.push(part);
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * @typedef {object} BlockAnswer what a command answers instead of the bytes
 * @property {string} cid the root block
 * @property {number} size the plain bytes
 * @property {string} key base64, made for this answer
 */

/**
 * Bitswap on `BLOCKS_PROTOCOL` over an existing libp2p node, with a store of
 * its own in memory.
 *
 * @param {object} p
 * @param {any} p.libp2p a started libp2p node (its registrar gated, see above)
 * @param {string} [p.protocol]
 * @param {number} [p.keepMs]
 * @param {number} [p.maxHeldBytes]
 */
export async function createBlockExchange({
	libp2p,
	protocol = BLOCKS_PROTOCOL,
	keepMs = KEEP_MS,
	maxHeldBytes = MAX_HELD_BYTES
}) {
	const blockstore = new MemoryBlockstore();
	/** @type {any} */
	let broker = null;
	/** @type {any} */
	let mixin = null;
	// `withBitswap` adds itself to a Helia node; this is the part of one it reads.
	// Bitswap's view of libp2p, changed in two places:
	// - @helia/bitswap 4 handles the protocols it is given but sends every
	//   message to '/ipfs/bitswap/1.2.0' (network.js `sendMessage`): here it
	//   sends to this protocol instead, so nothing ever reaches the books' Bitswap;
	// - its topology does not ask to hear of limited (relayed) connections, so
	//   through a relay it never learns of the peer: here it does, and its
	//   streams may run on them.
	const view = new Proxy(libp2p, {
		get(target, prop) {
			if (prop === 'dialProtocol') {
				return (
					/** @type {any} */ peer,
					/** @type {any} */ _protocols,
					/** @type {any} */ options
				) => target.dialProtocol(peer, [protocol], { ...options, runOnLimitedConnection: true });
			}
			if (prop === 'register') {
				return (/** @type {string} */ name, /** @type {any} */ topology) =>
					target.register(name, { ...topology, notifyOnLimitedConnection: true });
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	const host = /** @type {any} */ ({
		status: 'starting',
		libp2p: view,
		blockstore,
		logger: libp2p.logger,
		routing: NO_ROUTING,
		getHasher,
		hasBlockBroker: () => false,
		addBlockBroker: (/** @type {any} */ b) => (broker = b),
		addMixin: (/** @type {any} */ m) => (mixin = m)
	});
	// `protocols`, a list: what @helia/bitswap 4 reads (its types name `protocol`, which it ignores).
	withBitswap(
		host,
		/** @type {any} */ ({
			protocols: [protocol],
			runOnLimitedConnections: true,
			maxInboundStreams: 8
		})
	);
	await mixin.start(host);
	if (!broker) throw new Error('Bitswap did not start');

	/**
	 * One block, asked again when it does not come: a want can get lost when a
	 * second connection to the peer opens meanwhile (seen through a relay).
	 *
	 * @param {CID} cid
	 * @param {AbortSignal | undefined} signal the whole fetch's
	 */
	async function retrieve(cid, signal) {
		for (let attempt = 1; ; attempt++) {
			const one = AbortSignal.timeout(BLOCK_TRY_MS);
			try {
				return await broker.retrieve(cid, {
					signal: signal ? AbortSignal.any([signal, one]) : one
				});
			} catch (error) {
				if (signal?.aborted || !one.aborted || attempt >= BLOCK_TRIES) throw error;
			}
		}
	}

	/** root → its blocks, their bytes and the timer that drops them */
	/** @type {Map<string, { cids: CID[], bytes: number, timer: any }>} */
	const offered = new Map();
	let held = 0;

	/** @param {string} root */
	async function drop(root) {
		const entry = offered.get(root);
		if (!entry) return false;
		offered.delete(root);
		clearTimeout(entry.timer);
		held -= entry.bytes;
		for (const cid of entry.cids) await blockstore.delete(cid).catch(() => {});
		return true;
	}

	return {
		protocol,
		/** Whether the store holds nothing: every answer fetched and dropped, or expired. */
		isEmpty: () => offered.size === 0,
		/**
		 * Seal bytes and offer them: the answer for the device. Refused when the
		 * bridge holds too much already.
		 *
		 * @param {Uint8Array} bytes
		 * @returns {Promise<BlockAnswer>}
		 */
		async offer(bytes) {
			if (held + bytes.length > maxHeldBytes) throw new RangeError('the bridge holds too much now');
			const { root, size, key, blocks } = await sealBlocks(bytes);
			const total = blocks.reduce((n, b) => n + b.bytes.length, 0);
			for (const block of blocks) await blockstore.put(block.cid, block.bytes);
			for (const block of blocks) await broker.announce(block.cid).catch(() => {});
			const id = root.toString();
			const timer = setTimeout(() => drop(id).catch(() => {}), keepMs);
			timer?.unref?.();
			offered.set(id, { cids: blocks.map((b) => b.cid), bytes: total, timer });
			held += total;
			return { cid: id, size, key: toBase64(key) };
		},
		/** The device has the answer: its blocks go. @param {string} root */
		drop,
		/**
		 * Fetch an answer's blocks from the peers this exchange is connected to,
		 * open them, and keep nothing.
		 *
		 * @param {BlockAnswer} answer
		 * @param {{ signal?: AbortSignal }} [options]
		 * @returns {Promise<Uint8Array>}
		 */
		async fetch(answer, { signal } = {}) {
			/** @type {CID[]} */
			const got = [];
			try {
				return await openBlocks(
					async (cid) => {
						if (await blockstore.has(cid)) return bytesOf(blockstore.get(cid));
						const bytes = await retrieve(cid, signal);
						got.push(cid);
						return bytes;
					},
					answer.cid,
					fromBase64(answer.key),
					{ size: answer.size }
				);
			} finally {
				for (const cid of got) await blockstore.delete(cid).catch(() => {});
			}
		},
		async stop() {
			for (const root of [...offered.keys()]) await drop(root);
			await broker.stop?.();
		}
	};
}
