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
