// SPDX-License-Identifier: AGPL-3.0-or-later
// A block answer in a browser (#578): sealed, cut, fetched over Bitswap on
// the bridge's own protocol between two nodes, opened and checked; a block
// that does not match its CID and a wrong key are refused. blocks.test.js
// runs it in Node and in Chromium and compares. Made-up bytes only.
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { memory } from '@libp2p/memory';
import { createLibp2p } from 'libp2p';

import { openBlocks, sealBlocks, toBase64 } from '../../src/blocks.js';
import { createBlockExchange } from '../../src/exchange.js';

/** @param {string} name */
const node = (name) =>
	createLibp2p({
		addresses: { listen: [`/memory/${name}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify() }
	});

/** @param {number} n */
function made(n) {
	const bytes = new Uint8Array(n);
	for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
	return bytes;
}

/** @param {() => Promise<unknown>} run */
async function refusal(run) {
	try {
		await run();
		return 'opened';
	} catch (error) {
		return /** @type {Error} */ (error).name;
	}
}

export default async function scenario() {
	// Sealed and opened locally: three blocks of 1 MiB at most and a root.
	const file = made(2_500_000);
	const sealed = await sealBlocks(file);
	const store = new Map(sealed.blocks.map((b) => [b.cid.toString(), b.bytes]));
	const get = async (/** @type {any} */ cid) =>
		/** @type {Uint8Array} */ (store.get(cid.toString()));
	const opened = await openBlocks(get, sealed.root, sealed.key, { size: file.length });
	const plaintextInBlocks = sealed.blocks.some(
		(b) => b.bytes.length > 64 && file.subarray(0, 64).every((v, i) => b.bytes[i] === v)
	);
	const wrongKey = await refusal(() =>
		openBlocks(get, sealed.root, crypto.getRandomValues(new Uint8Array(32)))
	);
	const tampered = new Map(store);
	const first = sealed.blocks[1];
	const changed = Uint8Array.from(first.bytes);
	changed[0] ^= 1;
	tampered.set(first.cid.toString(), changed);
	const badBlock = await refusal(() =>
		openBlocks(
			async (cid) => /** @type {Uint8Array} */ (tampered.get(cid.toString())),
			sealed.root,
			sealed.key
		)
	);

	// Over Bitswap on the bridge's protocol: the bridge offers, the device fetches.
	const id = Math.random().toString(36).slice(2, 8);
	const bridge = await node(`bridge-${id}`);
	const device = await node(`device-${id}`);
	const offering = await createBlockExchange({ libp2p: bridge });
	const fetching = await createBlockExchange({ libp2p: device });
	await device.dial(bridge.getMultiaddrs()[0]);
	const answer = await offering.offer(file);
	const fetched = await fetching.fetch(answer, { signal: AbortSignal.timeout(20_000) });
	const dropped = await offering.drop(answer.cid);
	const protocols = bridge.getProtocols();
	const result = {
		ownProtocol: protocols.includes('/le-space/bridge-blocks/1.0.0'),
		booksBitswap: protocols.some((p) => p.startsWith('/ipfs/bitswap/')),
		blocks: sealed.blocks.length,
		same: toBase64(opened) === toBase64(file),
		plaintextInBlocks,
		wrongKey,
		badBlock,
		fetched: toBase64(fetched) === toBase64(file),
		size: answer.size,
		dropped,
		bridgeEmpty: offering.isEmpty()
	};
	await fetching.stop();
	await offering.stop();
	await device.stop();
	await bridge.stop();
	return result;
}
