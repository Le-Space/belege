// Where own devices meet (issue #148): the mode of the books, per book.
//
//   public  the Le-Space relays (#147), as before: anywhere;
//   qr      no relay: two devices in one room scan each other's code and
//           connect directly (qr-link.js); nothing is asked of Aleph, no relay
//           is dialled and no STUN server is asked.
//   lan     the relay in the own bridge (bridge/src/lan-relay.js), reached over
//           WebRTC-Direct at its address in the local network; no Aleph, no
//           public relay, no STUN. Its address comes from the paired bridge
//           and is kept in the sealed settings (`lan-relay`), so the other
//           devices learn it once they synced (by QR, say).
//
// The mode is kept in the sealed settings (`network-mode`), so every device
// learns it, and mirrored in this browser: the node is built before the books
// are open, so it reads the mirror. A newer setting from another device
// updates the mirror and takes effect at the next unlock.
//
//   both    all of the above: public relays, the own bridge's relay and QR;
//           a device the books do not know yet only over the own network
//           (first-contact.js), a known one over any path.

export const NETWORK_MODE_KEY = 'belege.network-mode';
export const NETWORK_MODE_SETTING = 'network-mode';
export const LAN_RELAY_KEY = 'belege.lan-relay';
export const LAN_RELAY_SETTING = 'lan-relay';

/** @typedef {'public' | 'qr' | 'lan' | 'both'} NetworkMode */

/** The modes that can be chosen now. */
export const NETWORK_MODES = /** @type {const} */ (['public', 'qr', 'lan', 'both']);

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

/**
 * A relay address in the own network as the bridge gives it: WebRTC-Direct on
 * a private IPv4 address (or 127.0.0.1, which only the E2E suite's bridge
 * uses), with its certhash and peer id. Anything else is no LAN relay.
 */
const LAN_RELAY =
	/^\/ip4\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.0\.0\.1)\/udp\/\d{4,5}\/webrtc-direct\/certhash\/u[A-Za-z0-9_-]{40,90}\/p2p\/12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;

/** @param {unknown} addr @returns {addr is string} */
export const isLanRelayAddr = (addr) => typeof addr === 'string' && LAN_RELAY.test(addr);

/** This browser's copy of the LAN relay's address, or null. @returns {string | null} */
export function lanRelayAddr() {
	try {
		const v = storage()?.getItem(LAN_RELAY_KEY);
		return isLanRelayAddr(v) ? v : null;
	} catch {
		return null;
	}
}

/** @param {string | null} addr */
export function setLanRelayMirror(addr) {
	try {
		if (isLanRelayAddr(addr)) storage()?.setItem(LAN_RELAY_KEY, addr);
		else storage()?.removeItem(LAN_RELAY_KEY);
	} catch {
		// Blocked: this browser does not know it.
	}
}

/**
 * The relays the node dials in a mode: the public ones (asked of Aleph only
 * then), the LAN relay alone, both, or none.
 *
 * @param {NetworkMode} mode
 * @param {() => Promise<string[]>} publicRelays
 * @returns {Promise<string[]>}
 */
export async function relaysFor(mode, publicRelays) {
	if (mode === 'qr') return [];
	const addr = lanRelayAddr();
	if (mode === 'lan') return addr ? [addr] : [];
	// The own network's relay first: a device at home meets there.
	if (mode === 'both') return [...(addr ? [addr] : []), ...(await publicRelays())];
	return publicRelays();
}
