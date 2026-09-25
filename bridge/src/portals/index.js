// The customer portals the bridge knows, and how their settings are read.
//
// bridge.json may carry, per portal:
//   "portals": { "vodafone": { "username": "…", "passwordStored": true, "headless": false, "baseUrl": "http://127.0.0.1:…" } }
// `username` and `passwordStored` come from `pnpm setup:portal vodafone`; the
// password itself is in the keychain (service belege-bridge, account
// portal:vodafone). `baseUrl` is honoured only for a loopback address: it is
// how the tests point a recipe at the fake portal, and nothing else can.
//
// A portal recorded with "Portal aufzeichnen" has an override in
// <config dir>/recipes/<id>.json; it is merged over the bundled recipe here
// (./recorder.js mergeOverride). One that does not pass is ignored, logged.
//
// A portal of the user's own ("Neues Portal aufzeichnen", ./local.js) is a
// file <config dir>/recipes/local-<slug>.json; every such file that passes
// becomes a portal next to the bundled ones.

import { readdirSync } from 'node:fs';

import { createRecipe, loadDefinition } from './recipe.js';
import { mergeOverride, readOverride } from './recorder.js';
import { buildLocalRecipe } from './local.js';

export { createPortalManager, launchChromium, LOGIN_TIMEOUT_MS } from './manager.js';
export { validateOverride, mergeOverride, readOverride, describeTarget } from './recorder.js';
export { PortalError } from './errors.js';
export { buildLocalRecipe, checkName, checkStart, localId, LOCAL_PREFIX } from './local.js';
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
 * @param {{ recipesDir?: string, log?: (line: string) => void, allowLoopback?: boolean }} [options]
 *   recipesDir: recorded overrides and local portals; allowLoopback: a local portal on
 *   http://127.0.0.1 counts (tests only)
 * @returns {Record<string, import('./recipe.js').Recipe>}
 */
export function buildRecipes(
	portalsConfig = {},
	{ recipesDir, log = () => {}, allowLoopback = false } = {}
) {
	/** @type {Record<string, import('./recipe.js').Recipe>} */
	const out = {};
	for (const [id, bundled] of Object.entries(RECIPES)) {
		let def = bundled;
		if (recipesDir) {
			try {
				const patch = readOverride(recipesDir, id);
				if (patch) def = mergeOverride(bundled, patch);
			} catch (/** @type {any} */ error) {
				log(
					`portal ${id}: recorded recipe ignored (${error?.code ?? error?.name ?? 'Error'}${error?.step ? ` at ${error.step}` : ''})`
				);
			}
		}
		const baseUrl = portalsConfig[id]?.baseUrl;
		// A loopback test portal serves the API under <baseUrl>/api.
		out[id] = createRecipe(
			def,
			loopbackUrl(baseUrl)
				? { baseUrl, apiBaseUrl: `${String(baseUrl).replace(/\/$/, '')}/api` }
				: {}
		);
	}
	if (recipesDir) {
		let files = [];
		try {
			files = readdirSync(recipesDir);
		} catch {
			// no recipes yet
		}
		for (const file of files.sort()) {
			const id = /^(local-[a-z0-9-]{1,34})\.json$/.exec(file)?.[1];
			if (!id) continue;
			try {
				const patch = readOverride(recipesDir, id);
				if (patch) out[id] = buildLocalRecipe(id, patch.local, { patch, allowLoopback });
			} catch (/** @type {any} */ error) {
				log(
					`portal ${id}: local recipe ignored (${error?.code ?? error?.name ?? 'Error'}${error?.step ? ` at ${error.step}` : ''})`
				);
			}
		}
	}
	return out;
}

/** The keychain account of a portal's password. @param {string} id */
export const keychainAccount = (id) => `portal:${id}`;
