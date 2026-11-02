// Which way a backup comes back (issue #528): Aleph's gateway first and the
// IPFS network when it goes quiet – the default, one HTTP request when the
// gateway is warm – or the IPFS network only, for whoever would rather not
// ask Aleph's gateway at all. The choice is this browser's (localStorage),
// read when a restore starts; the books are closed by then, so it cannot
// live in the settings.
//
// "Which one delivered" is reported either way (`onPath`), so the card can
// say where the file came from and how long it took – the gateway's host, or
// how many peers – rather than "from Aleph" for both.

import { createGatewayFirstFetch } from '@le-space/orbitdb-storage-bridge/peer-fetch';

/** Where this browser keeps the choice. */
export const RESTORE_PATH_KEY = 'belege.restore-path';

/** @typedef {'gateway-first' | 'peers'} RestorePath */

/**
 * The gateway stops counting as alive after this long without a byte, and the
 * peers take over: three idle stretches, since the gateway fetch tries each
 * host three times. A phone on a rationed connection is why this is not the
 * 60 s the backend takes on its own.
 */
export const GATEWAY_IDLE_MS = 15_000;

/**
 * The choice as kept, `gateway-first` unless the browser says `peers`.
 *
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage
 * @returns {RestorePath}
 */
export function restorePath(storage) {
	return storage?.getItem(RESTORE_PATH_KEY) === 'peers' ? 'peers' : 'gateway-first';
}

/**
 * Keep the choice; the default leaves nothing behind.
 *
 * @param {Pick<Storage, 'setItem' | 'removeItem'> | null | undefined} storage
 * @param {RestorePath} path
 */
export function setRestorePath(storage, path) {
	if (path === 'peers') storage?.setItem(RESTORE_PATH_KEY, 'peers');
	else storage?.removeItem(RESTORE_PATH_KEY);
}

/**
 * The host a gateway URL names, for the card: `ipfs.aleph.cloud` out of
 * `https://ipfs.aleph.cloud/ipfs`.
 *
 * @param {string[]} gateways
 */
export function gatewayHost(gateways) {
	try {
		return new URL(gateways[0] ?? '').host || gateways[0] || '';
	} catch {
		return gateways[0] ?? '';
	}
}

/**
 * @typedef {{ cid: string, ms: number, bytes: number, after?: { path: 'gateway', ms: number, error: string } }} PathInfo
 */

/**
 * A `fetchBytes(cid)` for the chosen way, that says which one delivered.
 *
 * @param {object} params
 * @param {RestorePath} params.path
 * @param {(cid: string, options?: object) => Promise<Uint8Array>} params.viaGateway
 * @param {(cid: string, options?: object) => Promise<Uint8Array>} params.viaPeers
 * @param {(path: 'gateway' | 'peers', info: PathInfo) => void} [params.onPath]
 * @param {() => number} [params.now]
 * @returns {(cid: string, options?: object) => Promise<Uint8Array>}
 */
export function createRestoreFetch({ path, viaGateway, viaPeers, onPath = () => {}, now }) {
	const clock = now ?? (() => Date.now());
	if (path === 'peers') {
		return async (cid, options = {}) => {
			const started = clock();
			const bytes = await viaPeers(cid, options);
			onPath('peers', { cid, ms: clock() - started, bytes: bytes.length });
			return bytes;
		};
	}
	return createGatewayFirstFetch(
		/** @type {any} */ ({
			viaGateway,
			viaPeers,
			gatewayTimeout: GATEWAY_IDLE_MS,
			onPath: (/** @type {any} */ p, /** @type {any} */ info) => onPath(p, info),
			now: clock
		})
	);
}
