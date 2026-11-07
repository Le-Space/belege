// SPDX-License-Identifier: AGPL-3.0-or-later
// Where the PDFs get their fonts and colour profile. Node reads the files
// from the installed packages (assets-node.js); a browser build fetches them
// (assets-browser.js, chosen by the "browser" condition of `#load-asset`).
// Each asset is loaded once per process or page; a failed load is tried
// again next time.
//
// A page bundled without Vite (whose `?url` the browser loader uses) or one
// that serves the files elsewhere hands in its own loader: `useAssetLoader`.

import { loadAsset as platformLoad } from '#load-asset';

/** The assets by name: the fonts in the order they are embedded, then the profile. */
export const ASSETS = /** @type {const} */ ([
	'DejaVuSansCondensed.ttf',
	'DejaVuSansCondensed-Bold.ttf',
	'DejaVuSansMono.ttf',
	'NotoSansArabic-Regular.ttf',
	'sRGB-v2-micro.icc'
]);

/** @typedef {(typeof ASSETS)[number]} AssetName */

/** @type {(name: AssetName) => Promise<Uint8Array>} */
let load = platformLoad;
/** @type {Map<string, Promise<Uint8Array>>} */
const cache = new Map();

/** @param {AssetName} name @returns {Promise<Uint8Array>} */
export function asset(name) {
	let p = cache.get(name);
	if (!p) {
		p = load(name);
		p.catch(() => cache.delete(name));
		cache.set(name, p);
	}
	return p;
}

/**
 * Loads the assets some other way, e.g. `(name) => fetch(`/fonts/${name}`)…`.
 * Without an argument, the platform's loader again.
 *
 * @param {(name: AssetName) => Promise<Uint8Array>} [loader]
 */
export function useAssetLoader(loader) {
	load = loader ?? platformLoad;
	cache.clear();
}
