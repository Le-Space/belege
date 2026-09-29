// Where own devices meet (issue #148): the mode of the books, per book.
//
//   public  the Le-Space relays (#147), as before: anywhere;
//   qr      no relay: two devices in one room scan each other's code and
//           connect directly (qr-link.js); nothing is asked of Aleph, no relay
//           is dialled and no STUN server is asked.
//
// The mode is kept in the sealed settings (`network-mode`), so every device
// learns it, and mirrored in this browser: the node is built before the books
// are open, so it reads the mirror. A newer setting from another device
// updates the mirror and takes effect at the next unlock.
//
// "Nur im eigenen Netz" and "Beides" come with a relay in the bridge (#148).

export const NETWORK_MODE_KEY = 'belege.network-mode';
export const NETWORK_MODE_SETTING = 'network-mode';

/** @typedef {'public' | 'qr'} NetworkMode */

/** The modes that can be chosen now. */
export const NETWORK_MODES = /** @type {const} */ (['public', 'qr']);

/** @param {unknown} v @returns {v is NetworkMode} */
export const isNetworkMode = (v) => NETWORK_MODES.includes(/** @type {any} */ (v));

/** @returns {Storage | null} */
function storage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** This browser's mirror of the mode; `public` when none is kept. @returns {NetworkMode} */
export function networkMode() {
	try {
		const v = storage()?.getItem(NETWORK_MODE_KEY);
		return isNetworkMode(v) ? v : 'public';
	} catch {
		return 'public';
	}
}

/** @param {NetworkMode} mode */
export function setNetworkModeMirror(mode) {
	try {
		storage()?.setItem(NETWORK_MODE_KEY, mode);
	} catch {
		// Blocked: stays `public`.
	}
}

/**
 * The mode a stored setting names, or null (none stored, or one this build
 * does not know: then the mirror stays as it is).
 *
 * @param {unknown} value the setting's value, `{ mode }`
 * @returns {NetworkMode | null}
 */
export function modeOfSetting(value) {
	const mode = /** @type {any} */ (value)?.mode;
	return isNetworkMode(mode) ? mode : null;
}
