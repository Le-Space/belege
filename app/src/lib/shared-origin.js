// A page under /ipfs/… or /ipns/… is on a path-style gateway: the browser
// gives it the gateway's origin, which every other CID there shares – its
// storage, its service worker's caches and its passkeys. Belege opens the books
// only on an origin of its own: the domain, or a subdomain gateway
// (<cid>.ipfs.<host>), where the CID is the origin.

/**
 * @param {string} [pathname] defaults to the page's
 * @returns {boolean}
 */
export function sharedOrigin(pathname = globalThis.location?.pathname ?? '/') {
	return /^\/ip[fn]s\//.test(pathname);
}
