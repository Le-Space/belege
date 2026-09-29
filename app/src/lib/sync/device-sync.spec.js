import { describe, expect, it } from 'vitest';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

import { deriveDevicePeerSeed } from '../database-keys.js';
import { createCollection } from '../store/repository.js';
import {
	DEVICE_PREFIX,
	blocked,
	deviceCode,
	deviceRecords,
	isPeerId,
	knownDevices,
	parseDeviceCode,
	setSyncGateClosed,
	startDeviceSync,
	syncLibp2pConfig
} from './device-sync.js';

const PRF = new Uint8Array(32).fill(9);
const SALT_A = 'a'.repeat(32);
const SALT_B = 'b'.repeat(32);
const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');

/** @param {string} salt */
const peerOf = async (salt) =>
	peerIdFromPrivateKey(
		await generateKeyPairFromSeed('Ed25519', await deriveDevicePeerSeed(PRF, salt))
	).toString();

describe('device peer key', () => {
	it('is the same for one device and different for two devices of one passkey', async () => {
		expect(hex(await deriveDevicePeerSeed(PRF, SALT_A))).toBe(
			hex(await deriveDevicePeerSeed(Uint8Array.from(PRF), SALT_A))
		);
		const a = await peerOf(SALT_A);
		const b = await peerOf(SALT_B);
		expect(a).not.toBe(b);
		expect(isPeerId(a)).toBe(true);
	});

	it('refuses a salt that is not 16 bytes of hex', async () => {
		await expect(deriveDevicePeerSeed(PRF, 'short')).rejects.toThrow(/salt/);
		await expect(deriveDevicePeerSeed(PRF, 'G'.repeat(32))).rejects.toThrow(/salt/);
	});
});

describe('knownDevices', () => {
	it('reads device records, and nothing else', async () => {
		const id = await peerOf(SALT_A);
		const devices = knownDevices([
			{ key: `${DEVICE_PREFIX}${id}`, value: { label: 'Chrome auf Mac', addedAt: '2026-01-02' } },
			{ key: `${DEVICE_PREFIX}${await peerOf(SALT_B)}`, deleted: true, value: {} },
			{ key: `${DEVICE_PREFIX}not-a-peer`, value: { label: 'x' } },
			{ key: 'matching', value: {} }
		]);
		expect(devices).toMatchObject([{ peerId: id, label: 'Chrome auf Mac', addedAt: '2026-01-02' }]);
		expect(devices).toHaveLength(1);
	});
});

describe('isPeerId', () => {
	it('takes Ed25519 peer ids only', () => {
		expect(isPeerId('')).toBe(false);
		expect(isPeerId(undefined)).toBe(false);
		expect(isPeerId('12D3KooW' + '0'.repeat(44))).toBe(false); // 0 is not base58
		expect(isPeerId('QmYyQSo1c1Ym7orWxLYvCrM2EmxFTANf8wXmmE7DWjhx5N')).toBe(false);
	});
});

describe('syncLibp2pConfig', () => {
	const gate = { service: () => ({}) };
	it('listens on the relays and for WebRTC, and keeps gossipsub on limited connections', () => {
		const relay = '/dns4/relay.example/tcp/443/wss/p2p/12D3KooWExample';
		const config = syncLibp2pConfig({ privateKey: {}, relays: [relay], gate });
		expect(config.addresses?.listen).toEqual([`${relay}/p2p-circuit`, '/webrtc']);
		expect(config.transports).toHaveLength(3);
		// No local relay: the gater does not open loopback addresses …
		expect(config.connectionGater?.denyDialMultiaddr).toBeUndefined();
		// … and refuses a removed device either way.
		blocked.add('12D3KooWremoved');
		expect(config.connectionGater?.denyDialPeer?.(/** @type {any} */ ('12D3KooWremoved'))).toBe(
			true
		);
		expect(
			config.connectionGater?.denyInboundEncryptedConnection?.(
				/** @type {any} */ ('12D3KooWother'),
				/** @type {any} */ ({})
			)
		).toBe(false);
		blocked.clear();
		// The header's network switch: while shut, nobody is dialled or let in.
		setSyncGateClosed(true);
		const any = /** @type {any} */ ('12D3KooWother');
		expect(config.connectionGater?.denyDialPeer?.(any)).toBe(true);
		expect(config.connectionGater?.denyInboundConnection?.(/** @type {any} */ ({}))).toBe(true);
		expect(config.connectionGater?.denyOutboundConnection?.(any, /** @type {any} */ ({}))).toBe(
			true
		);
		setSyncGateClosed(false);
		expect(config.connectionGater?.denyDialPeer?.(any)).toBe(false);
		expect(config.connectionGater?.denyInboundConnection?.(/** @type {any} */ ({}))).toBe(false);
		// The device gate first, so it wraps the registrar before the others register.
		expect(Object.keys(config.services ?? {})).toEqual([
			'deviceGate',
			'identify',
			'identifyPush',
			'pubsub'
		]);
	});

	it('without a relay ("per QR"): no listen address, and only the QR transport', () => {
		const config = syncLibp2pConfig({ privateKey: {}, relays: [], gate, mode: 'qr' });
		expect(config.addresses?.listen).toEqual([]);
		expect(config.transports).toHaveLength(1);
		const transport = /** @type {any} */ (config.transports ?? [])[0]({
			upgrader: {},
			peerId: {},
			privateKey: {},
			logger: { forComponent: () => Object.assign(() => {}, { error() {}, trace() {} }) }
		});
		expect(String(transport[Symbol.toStringTag])).toMatch(/qr/i);
		// The gate and the services as on the relay path.
		expect(Object.keys(config.services ?? {})[0]).toBe('deviceGate');
	});

	it('in the own network: WebRTC-Direct to the bridge, and its private address may be dialled', () => {
		const relay =
			'/ip4/192.168.10.23/udp/4990/webrtc-direct/certhash/uEiD3OphLir77I26uAdKgLdpMSBwo8PcLVg8IzkNU9XUteQ/p2p/12D3KooWNmFsNbztWUBmnaGf1xXyxABwMY1KiE41szzspFevFxqG';
		const config = syncLibp2pConfig({ privateKey: {}, relays: [relay], gate, mode: 'lan' });
		expect(config.addresses?.listen).toEqual([`${relay}/p2p-circuit`, '/webrtc']);
		expect(config.transports).toHaveLength(3);
		expect(config.connectionGater?.denyDialMultiaddr?.(/** @type {any} */ ({}))).toBe(false);
	});

	it('lets a local test relay be dialled', () => {
		const config = syncLibp2pConfig({
			privateKey: {},
			relays: ['/ip4/127.0.0.1/tcp/4413/ws/p2p/12D3KooWExample'],
			gate
		});
		expect(config.connectionGater?.denyDialMultiaddr?.(/** @type {any} */ ({}))).toBe(false);
	});
});

describe('deviceRecords', () => {
	it('takes the latest record of a device, so a removal and a later add both count', async () => {
		const id = await peerOf(SALT_A);
		const key = `${DEVICE_PREFIX}${id}`;
		const at = (/** @type {string} */ t) => `2026-01-0${t}T00:00:00.000Z`;
		const removed = deviceRecords([
			{ key, updatedAt: at('1'), value: { label: 'Mac' } },
			{ key, updatedAt: at('2'), deleted: true, value: { label: 'Mac' } }
		]);
		expect(removed).toMatchObject([{ peerId: id, removed: true, changedAt: at('2') }]);
		expect(knownDevices([{ key, updatedAt: at('2'), deleted: true }])).toEqual([]);
		const back = deviceRecords([
			{ key, updatedAt: at('2'), deleted: true },
			{ key, updatedAt: at('3'), value: { label: 'Mac' } }
		]);
		expect(back).toMatchObject([{ removed: false, label: 'Mac' }]);
		// Added on another device before the device's own record arrived: its own name stays.
		const named = deviceRecords([
			{ key, updatedAt: at('1'), value: { label: 'Chrome auf Mac' } },
			{ key, updatedAt: at('2'), value: { label: '' } }
		]);
		expect(named).toMatchObject([{ label: 'Chrome auf Mac' }]);
	});
});

describe('the QR code of a device', () => {
	it('carries the id with a prefix; a pasted bare id is fine, anything else is not', async () => {
		const id = await peerOf(SALT_A);
		expect(parseDeviceCode(deviceCode(id))).toBe(id);
		expect(parseDeviceCode(` ${id} `)).toBe(id);
		expect(parseDeviceCode('https://example.test/')).toBeNull();
		expect(parseDeviceCode('belege-device:nonsense')).toBeNull();
	});
});

/** A settings collection in memory, as the repository builds it on OrbitDB. */
function memorySettings(/** @type {() => Date} */ now) {
	/** @type {Map<string, any>} */
	const rows = new Map();
	/** @type {Set<() => void>} */
	const listeners = new Set();
	const db = {
		get: async (/** @type {string} */ id) => (rows.has(id) ? { value: rows.get(id) } : null),
		put: async (/** @type {any} */ r) => {
			rows.set(r.id, structuredClone(r));
			for (const l of listeners) l();
		},
		all: async () => [...rows.values()].map((value) => ({ value })),
		events: {
			on: (/** @type {string} */ _e, /** @type {() => void} */ l) => listeners.add(l),
			off: (/** @type {string} */ _e, /** @type {() => void} */ l) => listeners.delete(l)
		}
	};
	return createCollection(db, 'settings', { author: 'did:test', now });
}

/** A libp2p that knows its id and its connections, and dials nobody. */
function fakeLibp2p(/** @type {string} */ self) {
	/** @type {{ remotePeer: { toString(): string }, limited: boolean, close(): Promise<void> }[]} */
	const connections = [];
	return {
		peerId: { toString: () => self },
		connections,
		connect(/** @type {string} */ peerId) {
			const c = {
				remotePeer: { toString: () => peerId },
				limited: false,
				close: async () => {
					connections.splice(connections.indexOf(c), 1);
				}
			};
			connections.push(c);
		},
		getConnections: () => connections,
		getMultiaddrs: () => [],
		dial: async () => {
			throw new Error('offline in tests');
		},
		addEventListener: () => {}
	};
}

describe('removing a device', () => {
	it('deletes its record, hangs up and refuses it; the removed one switches itself off', async () => {
		let clock = Date.parse('2026-03-01T10:00:00.000Z');
		const now = () => new Date((clock += 1000));
		const settings = memorySettings(now);
		const store = { settings, resync: async () => {} };
		const mac = await peerOf(SALT_A);
		const phone = await peerOf(SALT_B);
		const common = { store, relays: [], now: () => now().toISOString() };

		// The phone was switched on first, then the Mac added it.
		const phoneNode = fakeLibp2p(phone);
		let phoneRemoved = 0;
		const onPhone = await startDeviceSync({
			...common,
			libp2p: phoneNode,
			label: 'Android',
			since: '2026-03-01T09:00:00.000Z',
			onRemoved: () => phoneRemoved++
		});
		const macNode = fakeLibp2p(mac);
		/** @type {any} */ let state = null;
		const onMac = await startDeviceSync({
			...common,
			libp2p: macNode,
			label: 'Mac',
			onState: (s) => (state = s)
		});
		await onMac.refresh();
		macNode.connect(phone);
		expect(
			knownDevices(await settings.list())
				.map((d) => d.label)
				.sort()
		).toEqual(['Android', 'Mac']);

		await onMac.removeDevice(phone);
		expect(macNode.connections).toHaveLength(0);
		expect(blocked.has(phone)).toBe(true);
		expect(state.devices).toEqual([]);
		// The settings replicate (here: they are shared); the phone learns and leaves.
		await new Promise((r) => setTimeout(r, 0));
		expect(phoneRemoved).toBe(1);
		await expect(onMac.removeDevice(mac)).rejects.toThrow();

		// Switched on again on the phone, after the removal: it writes itself back.
		const again = await startDeviceSync({
			...common,
			libp2p: fakeLibp2p(phone),
			label: 'Android',
			since: now().toISOString(),
			onRemoved: () => phoneRemoved++
		});
		expect(phoneRemoved).toBe(1);
		expect(knownDevices(await settings.list()).map((d) => d.peerId)).toContain(phone);
		// A device that never saw the removal and was switched on before it stays off.
		await onMac.removeDevice(phone);
		const stale = await startDeviceSync({
			...common,
			libp2p: fakeLibp2p(phone),
			label: 'Android',
			since: '2026-03-01T09:00:00.000Z',
			onRemoved: () => phoneRemoved++
		});
		expect(phoneRemoved).toBeGreaterThanOrEqual(2);
		expect(/** @type {any} */ (stale).removed).toBe(true);
		for (const s of [onPhone, onMac, again, stale]) await s.stop();
		blocked.clear();
	});
});
