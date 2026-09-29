import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	LAN_RELAY_KEY,
	NETWORK_MODE_KEY,
	isLanRelayAddr,
	lanRelayAddr,
	relaysFor,
	setLanRelayMirror,
	isNetworkMode,
	modeOfSetting,
	networkMode,
	setNetworkModeMirror
} from './network-mode.js';

/** @type {Map<string, string>} */
let kept;
beforeEach(() => {
	kept = new Map();
	/** @type {any} */ (globalThis).localStorage = {
		getItem: (/** @type {string} */ k) => kept.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => kept.delete(k)
	};
});
afterEach(() => {
	delete (/** @type {any} */ (globalThis).localStorage);
});

describe('where own devices meet (#148)', () => {
	it('is public until this browser keeps another mode', () => {
		expect(networkMode()).toBe('public');
		setNetworkModeMirror('qr');
		expect(networkMode()).toBe('qr');
		// Something this build does not know counts as public.
		kept.set(NETWORK_MODE_KEY, 'both');
		expect(networkMode()).toBe('public');
	});

	it('reads a stored setting only when it names a mode this build knows', () => {
		expect(modeOfSetting({ mode: 'qr' })).toBe('qr');
		expect(modeOfSetting({ mode: 'public' })).toBe('public');
		expect(modeOfSetting({ mode: 'lan' })).toBe('lan');
		expect(modeOfSetting({ mode: 'both' })).toBeNull();
		expect(modeOfSetting(null)).toBeNull();
		expect(isNetworkMode('qr')).toBe(true);
		expect(isNetworkMode('off')).toBe(false);
	});

	// Made up: a relay in a home network, its certhash and peer id.
	const RELAY =
		'/ip4/192.168.10.23/udp/4990/webrtc-direct/certhash/uEiD3OphLir77I26uAdKgLdpMSBwo8PcLVg8IzkNU9XUteQ/p2p/12D3KooWNmFsNbztWUBmnaGf1xXyxABwMY1KiE41szzspFevFxqG';

	it('a LAN relay is WebRTC-Direct on a private address, with certhash and peer id', () => {
		expect(isLanRelayAddr(RELAY)).toBe(true);
		expect(isLanRelayAddr(RELAY.replace('192.168.10.23', '127.0.0.1'))).toBe(true);
		for (const other of [
			RELAY.replace('192.168.10.23', '8.8.8.8'),
			RELAY.replace('192.168.10.23', '0.0.0.0'),
			RELAY.replace('/webrtc-direct', '/quic-v1'),
			'/dns4/relay.example/tcp/443/wss/p2p/12D3KooWNmFsNbztWUBmnaGf1xXyxABwMY1KiE41szzspFevFxqG',
			null
		]) {
			expect(isLanRelayAddr(other)).toBe(false);
		}
	});

	it('the relays per mode: public ones asked for, the LAN relay alone, or none', async () => {
		let asked = 0;
		const publicRelays = async () => (asked++, ['/dns4/relay.example/tcp/443/wss']);
		expect(await relaysFor('qr', publicRelays)).toEqual([]);
		expect(await relaysFor('lan', publicRelays)).toEqual([]);
		setLanRelayMirror(RELAY);
		expect(kept.get(LAN_RELAY_KEY)).toBe(RELAY);
		expect(await relaysFor('lan', publicRelays)).toEqual([RELAY]);
		expect(asked).toBe(0);
		expect(await relaysFor('public', publicRelays)).toEqual(['/dns4/relay.example/tcp/443/wss']);
		expect(asked).toBe(1);
		// Something else is not kept.
		setLanRelayMirror('/ip4/8.8.8.8/udp/1/webrtc-direct');
		expect(lanRelayAddr()).toBeNull();
	});
});
