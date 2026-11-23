// "Ohne Relay, per QR" (issue #148): two devices connect directly, with
// nothing between them but two scanned codes (@le-space/libp2p-webrtc-qr, as
// in simple-todo's qr01).
//
// One device shows an invite: a WebRTC offer, signed with its peer key. The
// other scans it, checks the signature against the peer id inside, and shows
// its answer, signed the same way; the first scans that back. The signed SDP
// carries the DTLS fingerprint, so the signature binds the connection to both
// peer ids the way Noise does on the relay path – which is what the device
// gate (device-gate.js) relies on. The gate then runs on this connection as
// on any other: nothing of the books moves before the other device has
// proved the passkey.
//
// Host candidates only: no STUN server learns this device's public address,
// and the codes carry only addresses in the local network. Both devices must
// therefore be in one network. A browser cannot listen, so after a reload or
// a dropped connection the two exchange codes again.
//
// The session is module state: the invite is made in one click and the answer
// read in another, and the peer connection has to survive in between.

import { QRSession, parsePayload, webRTCQR } from '@le-space/libp2p-webrtc-qr';

/** Host candidates only (see above). */
export const QR_RTC_CONFIGURATION = Object.freeze({ iceServers: [] });

/** @type {QRSession | null} */
let session = null;

/**
 * The peers this session met by a code exchange: a path in the own network
 * (first-contact.js). Noted before the connection opens, since the device
 * gate asks at once; the signature is checked right after.
 */
export const qrPeers = new Set();

/** The transport, for the node's config: it dials over the connection a code exchange built. */
export function qrTransport() {
	// Its bundled types name a listener libp2p's no longer matches; it never
	// listens (a browser cannot), so the cast hides nothing that runs.
	return /** @type {any} */ (
		webRTCQR({
			getOutboundSession: (/** @type {any} */ peerId) =>
				session?.getOutboundSession(String(peerId)) ?? null
		})
	);
}

/** @param {any} node the started sync node */
export function attachQrSession(node) {
	session?.close();
	session = new QRSession(node, { rtcConfiguration: QR_RTC_CONFIGURATION, compact: true });
	return session;
}

export function qrSession() {
	return session;
}

export function closeQrSession() {
	session?.close();
	session = null;
	qrPeers.clear();
}

/**
 * The peer id a code names (not yet checked: the session checks its
 * signature before any connection), or null.
 *
 * @param {string} text
 */
export async function payloadPeer(text) {
	try {
		const { peerId } = /** @type {any} */ (await parsePayload(String(text ?? '').trim()));
		return typeof peerId === 'string' ? peerId : (peerId?.toString?.() ?? null);
	} catch {
		return null;
	}
}

/**
 * What a scanned code is: an invite, an answer, or something else (null).
 *
 * @param {string} text
 * @returns {Promise<'offer' | 'answer' | null>}
 */
export async function payloadKind(text) {
	try {
		const { type } = await parsePayload(String(text ?? '').trim());
		return type === 'offer' || type === 'answer' ? type : null;
	} catch {
		return null;
	}
}

/** An mDNS-masked host address, as browsers give their own: `<uuid>.local`. */
const MDNS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i;

/**
 * Whether an address is one of the own network: mDNS-masked, a private,
 * link-local or loopback IPv4, or a unique-local, link-local or loopback IPv6.
 * A loopback address reaches only the same machine.
 *
 * @param {string} address
 */
export function ownNetworkAddress(address) {
	const a = String(address ?? '').toLowerCase();
	if (MDNS.test(a)) return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
	if (v4) {
		const [x, y] = [Number(v4[1]), Number(v4[2])];
		return (
			x === 10 ||
			x === 127 ||
			(x === 172 && y >= 16 && y <= 31) ||
			(x === 192 && y === 168) ||
			(x === 169 && y === 254)
		);
	}
	return a === '::1' || (a.includes(':') && /^(f[cd][0-9a-f]{0,2}|fe[89ab][0-9a-f]?):/.test(a));
}

/**
 * Whether an ICE candidate line names a host in the own network – no address
 * a STUN server saw (srflx, prflx), no relay.
 *
 * @param {string} line `candidate:…`, with or without `a=`
 */
export function ownNetworkCandidate(line) {
	const parts = String(line ?? '')
		.replace(/^(a=)?candidate:/, '')
		.trim()
		.split(/\s+/);
	return (
		parts.length >= 8 && parts[6] === 'typ' && parts[7] === 'host' && ownNetworkAddress(parts[4])
	);
}

/**
 * Whether a code was made in the own network: every address it offers is a
 * host there. Only then does the peer count as met in the room
 * (first-contact.js); a code with an address from elsewhere – one that came
 * by link from far away – still connects, but a device the books do not know
 * is then let in by the person, not by itself.
 *
 * @param {string} text the scanned or linked code
 */
export async function madeInOwnNetwork(text) {
	try {
		const payload = /** @type {any} */ (await parsePayload(String(text ?? '').trim()));
		const lines = Array.isArray(payload?.candidates)
			? payload.candidates.map(String)
			: [...String(payload?.sdp ?? '').matchAll(/^a=candidate:(.+)$/gm)].map((m) => m[1]);
		return lines.length > 0 && lines.every(ownNetworkCandidate);
	} catch {
		return false;
	}
}
