import { describe, expect, it } from 'vitest';
import {
	RESTORE_PATH_KEY,
	createRestoreFetch,
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

	it('gateway first: the gateway delivers and is named; when it fails, the peers deliver and say so', async () => {
		/** @type {any[]} */
		const paths = [];
		const bytes = new Uint8Array([1, 2, 3]);
		const ok = createRestoreFetch({
			path: 'gateway-first',
			viaGateway: async () => bytes,
			viaPeers: async () => {
				throw new Error('not asked');
			},
			onPath: (p, info) => paths.push([p, info.bytes])
		});
		expect(await ok('bafy')).toBe(bytes);
		expect(paths).toEqual([['gateway', 3]]);

		paths.length = 0;
		const quiet = createRestoreFetch({
			path: 'gateway-first',
			viaGateway: async () => {
				throw new Error('no bytes for 15000 ms');
			},
			viaPeers: async () => bytes,
			onPath: (p, info) => paths.push([p, info.after?.error])
		});
		expect(await quiet('bafy')).toBe(bytes);
		expect(paths).toEqual([['peers', 'no bytes for 15000 ms']]);
	});

	it('peers only: the gateway is never asked', async () => {
		/** @type {string[]} */
		const paths = [];
		let gatewayAsked = false;
		const fetchBytes = createRestoreFetch({
			path: 'peers',
			viaGateway: async () => {
				gatewayAsked = true;
				return new Uint8Array();
			},
			viaPeers: async () => new Uint8Array([9]),
			onPath: (p) => paths.push(p)
		});
		expect(await fetchBytes('bafy')).toEqual(new Uint8Array([9]));
		expect(gatewayAsked).toBe(false);
		expect(paths).toEqual(['peers']);
	});
});
