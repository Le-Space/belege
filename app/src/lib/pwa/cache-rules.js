// What the service worker (src/service-worker.js, issue #141) does with a
// request. Pure, so it is tested without a browser.
//
// Only the app shell is cached: the built files and static files of one
// version, and the page itself ('/', the SPA fallback). Everything with data
// goes to the network and is never stored: the bridge (127.0.0.1), relays,
// Aleph, chain nodes, rate sources – all on other origins – and any other
// request. The books live in IndexedDB, as without a service worker.

/** The page every route renders in (adapter-static's fallback). */
export const SHELL = '/';

/**
 * @param {URL} url
 * @param {{ origin: string, assets: Set<string>, method: string, mode: string }} request
 * @returns {'asset' | 'navigate' | 'network'}
 */
export function cacheDecision(url, { origin, assets, method, mode }) {
	if (method !== 'GET') return 'network';
	if (url.origin !== origin) return 'network';
	if (mode === 'navigate') return 'navigate';
	if (url.search) return 'network';
	if (assets.has(url.pathname)) return 'asset';
	return 'network';
}

/**
 * The files one version caches: the build and static files (source maps
 * left out) and the shell.
 *
 * @param {string[]} build
 * @param {string[]} files
 */
export const shellFiles = (build, files) => [
	...new Set([...build, ...files].filter((f) => !f.endsWith('.map')).concat(SHELL))
];
