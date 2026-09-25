// The customer portals the bridge knows, and how their settings are read.
//
// bridge.json may carry, per portal:
//   "portals": { "vodafone": { "username": "…", "passwordStored": true, "headless": false, "baseUrl": "http://127.0.0.1:…" } }
// `username` and `passwordStored` come from `pnpm setup:portal vodafone`; the
// password itself is in the keychain (service belege-bridge, account
// portal:vodafone). `baseUrl` is honoured only for a loopback address: it is
// how the tests point a recipe at the fake portal, and nothing else can.

import { createRecipe, loadDefinition } from './recipe.js';

export { createPortalManager, launchChromium, LOGIN_TIMEOUT_MS } from './manager.js';
export { PortalError } from './errors.js';
export { createRecipe, loadDefinition, validateDefinition, parseRow } from './recipe.js';
export { isPdf, MAX_INVOICE_BYTES } from './pdf.js';

/** The recipes the bridge ships, by portal id (data files in recipes/). */
export const RECIPES = {
	vodafone: loadDefinition('vodafone-meinkabel.json')
};

/** @param {unknown} url */
export function loopbackUrl(url) {
	try {
		const u = new URL(String(url));
		return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
	} catch {
		return false;
	}
}

/**
 * @typedef {object} PortalConfig
 * @property {string | null} [username]
 * @property {boolean} [passwordStored]
 * @property {string} [baseUrl] loopback only
 * @property {boolean} [headless] false: fetches run in a visible window too (a portal that blocks headless browsers)
 */

/**
 * @param {Record<string, PortalConfig>} portalsConfig
 * @returns {Record<string, import('./recipe.js').Recipe>}
 */
export function buildRecipes(portalsConfig = {}) {
	/** @type {Record<string, import('./recipe.js').Recipe>} */
	const out = {};
	for (const [id, def] of Object.entries(RECIPES)) {
		const baseUrl = portalsConfig[id]?.baseUrl;
		// A loopback test portal serves the API under <baseUrl>/api.
		out[id] = createRecipe(
			def,
			loopbackUrl(baseUrl)
				? { baseUrl, apiBaseUrl: `${String(baseUrl).replace(/\/$/, '')}/api` }
				: {}
		);
	}
	return out;
}

/** The keychain account of a portal's password. @param {string} id */
export const keychainAccount = (id) => `portal:${id}`;
