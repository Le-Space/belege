// What the service worker (src/service-worker.js, issue #141) does with a
// request. Pure, so it is tested without a browser.
//
// Only the app shell is cached: the built files and static files of one
// version, and the two pages every route renders in. Everything with data
// goes to the network and is never stored: the bridge (127.0.0.1), relays,
// Aleph, chain nodes, rate sources – all on other origins – and any other
// request. The books live in IndexedDB, as without a service worker.
//
// The build is served at the origin's root (belege.le-space.de, a subdomain
// gateway) or under a path (a path-style IPFS gateway, …/ipfs/<cid>/). The
// worker is registered where the build is, and every path here carries that
// prefix ('' at the root, '/ipfs/<cid>' under the path): `$service-worker`
// reads it from the worker's own address (its `base`) and lists the built and
// static files with it already; the two pages get it here.

/** The start page, prerendered: relative paths, opens under any prefix. */
export const START = '/';

/**
 * adapter-static's SPA fallback, the page a deeper route reloads into. Its
 * paths are absolute, as SvelteKit cannot know the depth it will be served
 * at: it works at the origin's root only. Under a prefix no deeper route is
 * served anyway (a path gateway has no fallback).
 */
export const FALLBACK = '/200.html';

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

/** What only link previews read (issue #343): never part of the offline shell. */
const PREVIEW_ONLY = /^\/(social|en)\/|^\/robots\.txt$/;

/**
 * The paths one version caches: the build and static files (source maps and
 * what only link previews read left out), the start page and the fallback.
 *
 * @param {string[]} build `$service-worker`'s, under the prefix already
 * @param {string[]} files `$service-worker`'s, under the prefix already
 * @param {string} [prefix] where the build is served, '' at the origin's root
 */
export const shellFiles = (build, files, prefix = '') => [
	...new Set(
		[...build, ...files]
			.filter((f) => !f.endsWith('.map') && !PREVIEW_ONLY.test(f.slice(prefix.length)))
			.concat(prefix + START, prefix + FALLBACK)
	)
];

/**
 * The cached page that answers a navigation offline: the start page for the
 * prefix's root, the fallback for any deeper route.
 *
 * @param {string} pathname the navigation's path
 * @param {string} [prefix]
 */
export const shellFor = (pathname, prefix = '') =>
	pathname === prefix + START ? prefix + START : prefix + FALLBACK;
