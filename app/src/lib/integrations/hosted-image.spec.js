// The books' own bridge image (#777): the pinned builder, the record, and a
// whole build against a stand-in builder that speaks the builder's protocol
// (GET /, POST /build, GET /job/<id>, GET /job/<id>/image with Range,
// DELETE /job/<id>) and a stand-in Aleph. Made-up keys and hashes.
import { describe, expect, it } from 'vitest';

import { alephAddressOf, alephSign } from '../backup/aleph-signer.js';
import { newAlephKey } from '../backup/aleph-key.js';
import { deriveImageBase, deriveImagePassphrase } from '../database-keys.js';
import {
	attestUrlsOf,
	BRIDGE_BUILDER,
	buildBridgeImage,
	builderProblems,
	forgetLeftBuilder,
	ownImageOf
} from './hosted-image.js';
import { VM_CHANNEL } from './hosted-vm.js';

const encoder = new TextEncoder();
const json = (/** @type {any} */ v) => encoder.encode(JSON.stringify(v));
const CID = 'Qm' + 'a'.repeat(44);

describe('the pinned builder', () => {
	it('is complete, and its content, node and measurements agree', () => {
		expect(builderProblems()).toEqual([]);
		expect(BRIDGE_BUILDER.crn).toBe(BRIDGE_BUILDER.program.requirements.node.node_hash);
		expect(BRIDGE_BUILDER.measurements).toEqual(
			BRIDGE_BUILDER.program.verification.measurements.map((m) => m.registers.launch)
		);
	});

	it('is refused when the content and the pins do not agree', () => {
		const other = /** @type {any} */ (structuredClone(BRIDGE_BUILDER));
		other.measurements = ['ab'.repeat(48)];
		expect(builderProblems(other).length).toBeGreaterThan(0);
		expect(builderProblems({ ...BRIDGE_BUILDER, plain: {} }).join()).toMatch(/plain image/);
	});
});

describe('the record of an own image', () => {
	it('takes a STORE and the plain image it was made from, and nothing else', () => {
		const record = {
			store: 'a'.repeat(64),
			plainSha256: 'b'.repeat(64),
			size: 1024,
			builtAt: '2026-11-16T17:00:00.000Z',
			measurement: 'c'.repeat(96),
			builder: 'd'.repeat(64)
		};
		expect(ownImageOf(record)).toEqual(record);
		expect(ownImageOf(null)).toBeNull();
		expect(ownImageOf({ ...record, store: 'latest' })).toBeNull();
		expect(ownImageOf({ ...record, plainSha256: undefined })).toBeNull();
		expect(ownImageOf({ ...record, size: 'x', builder: 'y' })).toMatchObject({
			size: null,
			builder: null
		});
	});
});

describe('where a builder is reached', () => {
	it('is every relay with a TLS WebSocket by name, once each', () => {
		expect(
			attestUrlsOf([
				'/dns4/relay-one.example.com/tcp/443/tls/ws/p2p/12D3KooWExample',
				'/ip4/192.0.2.1/tcp/4001/p2p/12D3KooWExample',
				'/dns4/relay-two.example.com/tcp/443/tls/ws/p2p/12D3KooWOther',
				'/dns4/relay-one.example.com/tcp/443/tls/ws/p2p/12D3KooWAgain'
			])
		).toEqual(['wss://relay-one.example.com/attest', 'wss://relay-two.example.com/attest']);
		expect(attestUrlsOf([])).toEqual([]);
	});
});

/**
 * A builder as the attested channel shows it: it holds one plain image, seals
 * it into `sealed` bytes and hands them out in pieces.
 *
 * @param {{ sealed: Uint8Array, measurement: string, plainSha256: string }} o
 */
function standInBuilder({ sealed, measurement, plainSha256 }) {
	/** @type {any[]} */
	const builds = [];
	let job = '';
	let opened = 0;
	let dropped = false;
	const channel = () => ({
		measurement,
		relay: 'relay-one.example.com',
		close() {},
		/** @param {string} method @param {string} path @param {any} [init] */
		async request(method, path, init = {}) {
			if (method === 'GET' && path === '/') {
				return { status: 200, body: json({ service: 'sealed image builder', plain: null }) };
			}
			if (method === 'POST' && path === '/build') {
				const body = JSON.parse(init.body);
				builds.push(body);
				if (body.sha256 !== plainSha256)
					return { status: 409, body: json({ error: 'other image' }) };
				job = 'f'.repeat(48);
				return { status: 202, body: json({ job }) };
			}
			if (method === 'GET' && path === `/job/${job}`) {
				return { status: 200, body: json({ state: 'built', cid: CID, size: sealed.length }) };
			}
			if (method === 'GET' && path === `/job/${job}/image`) {
				const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.range) ?? [];
				return { status: 206, body: sealed.slice(Number(a), Number(b) + 1) };
			}
			if (method === 'DELETE' && path === `/job/${job}`) {
				dropped = true;
				return { status: 200, body: json({}) };
			}
			return { status: 404, body: json({ error: 'not here' }) };
		}
	});
	return {
		builds,
		get opened() {
			return opened;
		},
		get dropped() {
			return dropped;
		},
		/** What attest-wasm's attestGuest would hand back, for the pinned measurement only. */
		attestGuest: async (/** @type {any} */ { expectedMeasurements }) => {
			if (!expectedMeasurements.includes(measurement)) throw new Error('measurement not pinned');
			opened++;
			return { channel: channel(), freshVerified: { measurement } };
		}
	};
}

describe('a build of the books’ own image', () => {
	const key = newAlephKey();
	const owner = alephAddressOf(key);
	const app = {
		address: owner,
		signMessage: async (/** @type {{ message: string }} */ { message }) => alephSign(key, message)
	};
	const sealed = new Uint8Array(700 * 1024 + 17).map((_, i) => i % 251);
	const relays = ['wss://relay-one.example.com/attest'];
	const quick = { pollMs: 0, retryMs: 0, sleep: async () => {}, upMs: 0 };

	/** @param {{ measurement?: string }} [o] */
	async function run({ measurement = BRIDGE_BUILDER.measurements[0] } = {}) {
		const imageBase = await deriveImageBase(crypto.getRandomValues(new Uint8Array(32)));
		const builder = standInBuilder({
			sealed,
			measurement,
			plainSha256: BRIDGE_BUILDER.plain.sha256
		});
		/** @type {any[]} */
		const posted = [];
		/** @type {any[]} */
		const stored = [];
		/** @type {string[]} */
		const noted = [];
		const done = buildBridgeImage({
			imageBase,
			app,
			relays,
			apiHost: 'https://api.example.com',
			attest: async () => ({
				attestGuest: builder.attestGuest,
				wasm: {},
				relayTransports: () => () => ({})
			}),
			post: async (message) => {
				posted.push(message);
				return {};
			},
			store: async (image, message) => {
				stored.push({ bytes: new Uint8Array(await image.arrayBuffer()), message });
				return { status: 200, cid: CID, reason: '' };
			},
			read: async () => 'processed',
			onStarted: (vprogram) => {
				noted.push(`started ${vprogram}`);
			},
			onForgotten: (vprogram) => {
				noted.push(`forgotten ${vprogram}`);
			},
			tuning: quick
		});
		return { done, builder, posted, stored, noted, imageBase };
	}

	it('starts the pinned builder, hands it the derived passphrase once, stores the sealed image and forgets the builder', async () => {
		const { done, builder, posted, stored, noted, imageBase } = await run();
		const record = await done;

		// The builder got the passphrase the books derive, for the pinned plain image, once.
		expect(builder.builds).toHaveLength(1);
		expect(builder.builds[0].sha256).toBe(BRIDGE_BUILDER.plain.sha256);
		expect(builder.builds[0].passphrase).toBe(
			await deriveImagePassphrase(imageBase, BRIDGE_BUILDER.plain.sha256)
		);
		expect(builder.builds[0].address).toBe(owner);
		expect(builder.dropped).toBe(true);
		// Every run came over a channel attested anew.
		expect(builder.opened).toBeGreaterThan(1);

		// Aleph got the V-PROGRAM with the pinned content, paid and sent by the books' key, then its FORGET.
		const [vprogram, forget] = posted;
		expect(vprogram.type).toBe('V-PROGRAM');
		expect(vprogram.sender).toBe(owner);
		expect(vprogram.channel).toBe(VM_CHANNEL);
		const content = JSON.parse(vprogram.item_content);
		expect({ ...content, address: undefined, time: undefined }).toEqual({
			...BRIDGE_BUILDER.program,
			address: undefined,
			time: undefined
		});
		expect(content.address).toBe(owner);
		expect(forget.type).toBe('FORGET');
		expect(JSON.parse(forget.item_content).hashes).toEqual([vprogram.item_hash]);
		expect(noted).toEqual([`started ${vprogram.item_hash}`, `forgotten ${vprogram.item_hash}`]);

		// The sealed image went to Aleph whole, beside a STORE of the books' key.
		expect(stored).toHaveLength(1);
		expect(stored[0].bytes).toEqual(sealed);
		expect(stored[0].message.type).toBe('STORE');
		expect(JSON.parse(stored[0].message.item_content)).toMatchObject({
			address: owner,
			item_hash: CID
		});

		// What the books keep: no passphrase, only what was built and how it was checked.
		expect(record).toEqual({
			store: stored[0].message.item_hash,
			cid: CID,
			size: sealed.length,
			plainSha256: BRIDGE_BUILDER.plain.sha256,
			builtAt: expect.any(String),
			measurement: BRIDGE_BUILDER.measurements[0],
			builder: vprogram.item_hash
		});
		expect(JSON.stringify(record)).not.toContain(builder.builds[0].passphrase);
		expect(ownImageOf(record)).not.toBeNull();
	});

	it('sends no passphrase to a builder whose measurement is not the pinned one, and forgets it', async () => {
		const { done, builder, posted, stored } = await run({ measurement: 'ee'.repeat(48) });
		await expect(done).rejects.toThrow(/measurement/);
		expect(builder.builds).toEqual([]);
		expect(stored).toEqual([]);
		expect(posted.map((m) => m.type)).toEqual(['V-PROGRAM', 'FORGET']);
	});

	it('needs an attest relay before it starts anything', async () => {
		const imageBase = await deriveImageBase(crypto.getRandomValues(new Uint8Array(32)));
		/** @type {any[]} */
		const posted = [];
		await expect(
			buildBridgeImage({
				imageBase,
				app,
				relays: [],
				apiHost: 'https://api.example.com',
				attest: async () => assert.fail(),
				post: async (m) => posted.push(m)
			})
		).rejects.toThrow(/relay/);
		expect(posted).toEqual([]);
	});
});

describe('a builder a closed window left running', () => {
	it('is forgotten for the books’ key, and nothing is sent without one', async () => {
		const key = newAlephKey();
		const owner = alephAddressOf(key);
		const app = {
			address: owner,
			signMessage: async (/** @type {{ message: string }} */ { message }) => alephSign(key, message)
		};
		/** @type {any[]} */
		const posted = [];
		const post = async (/** @type {any} */ m) => posted.push(m);
		expect(await forgetLeftBuilder({ app, vprogram: null, post })).toBe(true);
		expect(posted).toEqual([]);
		expect(await forgetLeftBuilder({ app, vprogram: 'a'.repeat(64), post })).toBe(true);
		expect(posted).toHaveLength(1);
		expect(posted[0].type).toBe('FORGET');
		expect(JSON.parse(posted[0].item_content)).toMatchObject({
			address: owner,
			hashes: ['a'.repeat(64)]
		});
	});
});

const assert = {
	fail() {
		throw new Error('not expected');
	}
};
