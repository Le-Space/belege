// What a device of the books may call at the bridge's own node, by area
// (Le-Space/belege#579): the scope names of @le-space/bridge-protocol, in its
// order, each with a label from the catalogue (devices.bridgeAccess.scope.*).
// The device that paired the bridge ticks them per device on the Geräte card
// (BridgeAccess.svelte); the bridge sets them with `device.scopes`.
import { DEVICE_SCOPES } from '@le-space/bridge-protocol';

import { t } from '../i18n/index.js';

/** Scope name → its key under `devices.bridgeAccess.scope`. */
const KEYS = /** @type {Record<string, string>} */ ({
	'bridge:bank:read': 'bankRead',
	'bridge:bank:link': 'bankLink',
	'bridge:mail:read': 'mailRead',
	'bridge:mail:write': 'mailWrite',
	'bridge:paperless:read': 'paperlessRead',
	'bridge:llm': 'llm',
	'bridge:backup': 'backup',
	'bridge:share': 'share',
	'bridge:chains:read': 'chainsRead'
});

/** Every scope a device can hold, as the protocol defines them. */
export { DEVICE_SCOPES };

/**
 * A scope as people read it; the name itself for one the app does not know
 * (a newer bridge).
 *
 * @param {unknown} scope
 */
export function scopeLabel(scope) {
	const key = KEYS[String(scope)];
	return key ? t(`devices.bridgeAccess.scope.${key}`) : String(scope ?? '');
}

/**
 * The scopes to tick for a device: those the bridge says a set is made of
 * (`settable`; an older bridge sends only `scopes`), in the protocol's order,
 * one the protocol does not know last.
 *
 * @param {{ scopes: string[], settable?: string[] }} grants the bridge's `grants` answer
 * @returns {string[]}
 */
export function scopeChoices(grants) {
	const offered = grants.settable ?? grants.scopes.filter((s) => DEVICE_SCOPES.includes(s));
	const rank = (/** @type {string} */ s) => {
		const i = DEVICE_SCOPES.indexOf(s);
		return i < 0 ? DEVICE_SCOPES.length : i;
	};
	return [...new Set(offered)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A device's set with one scope ticked or not, of the choices only, sorted.
 *
 * @param {string[]} held what it holds now
 * @param {string[]} choices scopeChoices
 * @param {string} scope
 * @param {boolean} on
 */
export function toggled(held, choices, scope, on) {
	const next = new Set(held.filter((s) => choices.includes(s)));
	if (on) next.add(scope);
	else next.delete(scope);
	return [...next].sort();
}
