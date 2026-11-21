import { describe, expect, it } from 'vitest';
import {
	GATEWAY_IDLE_MS,
	RESTORE_PATH_KEY,
	createRestoreStream,
	gatewayHost,
	restorePath,
	setRestorePath
} from './restore-path.js';

const memory = () => {
	/** @type {Map<string, string>} */
	const m = new Map();
	return {
		getItem: (/** @type {string} */ k) => m.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, v),
		removeItem: (/** @type {string} */ k) => void m.delete(k)
	};
};

describe('which way a backup comes back', () => {
	it('is the gateway first unless this browser said peers; the default leaves nothing behind', () => {
		const s = memory();
		expect(restorePath(s)).toBe('gateway-first');
		expect(restorePath(null)).toBe('gateway-first');
		setRestorePath(s, 'peers');
		expect(restorePath(s)).toBe('peers');
		setRestorePath(s, 'gateway-first');
		expect(s.getItem(RESTORE_PATH_KEY)).toBeNull();
	});

	it('names the gateway by host', () => {
		expect(gatewayHost(['https://ipfs.aleph.cloud/ipfs'])).toBe('ipfs.aleph.cloud');
		expect(gatewayHost(['http://127.0.0.1:4398/ipfs'])).toBe('127.0.0.1:4398');
		expect(gatewayHost([])).toBe('');
	});

	/** @param {Uint8Array[]} chunks */
	const streamOf = (chunks) =>
		async function* () {
			yield* chunks;
		};
	/** @param {AsyncIterable<Uint8Array>} stream */
	const read = async (stream) => {
		/** @type {number[]} */
		const out = [];
		for await (const chunk of stream) out.push(...chunk);
		return out;
	};

	it('gateway first: the gateway delivers and is named; when it fails, the peers deliver and say so', async () => {
		/** @type {any[]} */
		const paths = [];
		const ok = createRestoreStream({
			path: 'gateway-first',
			viaGateway: streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]),
			viaPeers: () => {
				throw new Error('not asked');
			},
			onPath: (p, info) => paths.push([p, info.bytes])
		});
		expect(await read(ok('bafy'))).toEqual([1, 2, 3]);
		expect(paths).toEqual([['gateway', 3]]);

		paths.length = 0;
		const quiet = createRestoreStream({
			path: 'gateway-first',
			// eslint-disable-next-line require-yield
			viaGateway: async function* () {
				throw new Error('no bytes for 15000 ms');
			},
			viaPeers: streamOf([new Uint8Array([1, 2, 3])]),
			onPath: (p, info) => paths.push([p, info.after?.error])
		});
		expect(await read(quiet('bafy'))).toEqual([1, 2, 3]);
		expect(paths).toEqual([['peers', 'no bytes for 15000 ms']]);
	});

	it('gateway first: a gateway that stops half way hands over at that byte, and the file is one run of bytes', async () => {
		/** @type {any[]} */
		const paths = [];
		/** @type {any[]} */
		const asked = [];
		const file = [1, 2, 3, 4, 5, 6];
		const stream = createRestoreStream({
			path: 'gateway-first',
			viaGateway: async function* (cid, options) {
				asked.push(['gateway', options?.timeout]);
				yield new Uint8Array(file.slice(0, 4));
				throw new Error('the connection dropped');
			},
			viaPeers: async function* (cid, options) {
				asked.push(['peers', options?.offset]);
				yield new Uint8Array(file.slice(options?.offset ?? 0));
			},
			onPath: (p, info) => paths.push([p, info.bytes, /** @type {any} */ (info).resumedAt])
		});
		expect(await read(stream('bafy', { size: 6 }))).toEqual(file);
		// The gateway with the short idle time, the peers from byte 4 on.
		expect(asked).toEqual([
			['gateway', GATEWAY_IDLE_MS],
			['peers', 4]
		]);
		expect(paths).toEqual([['peers', 6, 4]]);
	});

	it('peers only: the gateway is never asked', async () => {
		/** @type {string[]} */
		const paths = [];
		let gatewayAsked = false;
		const stream = createRestoreStream({
			path: 'peers',
			// eslint-disable-next-line require-yield
			viaGateway: async function* () {
				gatewayAsked = true;
			},
			viaPeers: streamOf([new Uint8Array([9])]),
			onPath: (p) => paths.push(p)
		});
		expect(await read(stream('bafy'))).toEqual([9]);
		expect(gatewayAsked).toBe(false);
		expect(paths).toEqual(['peers']);
	});
});
