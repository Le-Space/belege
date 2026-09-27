import { describe, expect, it } from 'vitest';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

import { deriveDevicePeerSeed } from '../database-keys.js';
import { DEVICE_PREFIX, isPeerId, knownDevices, syncLibp2pConfig } from './device-sync.js';

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
		expect(devices).toEqual([{ peerId: id, label: 'Chrome auf Mac', addedAt: '2026-01-02' }]);
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
	it('listens on the relays and for WebRTC, and keeps gossipsub on limited connections', () => {
		const relay = '/dns4/relay.example/tcp/443/wss/p2p/12D3KooWExample';
		const config = syncLibp2pConfig({ privateKey: {}, relays: [relay] });
		expect(config.addresses?.listen).toEqual([`${relay}/p2p-circuit`, '/webrtc']);
		expect(config.transports).toHaveLength(3);
		expect(config.connectionGater).toBeUndefined();
		expect(Object.keys(config.services ?? {})).toEqual(['identify', 'identifyPush', 'pubsub']);
	});

	it('lets a local test relay be dialled', () => {
		const config = syncLibp2pConfig({
			privateKey: {},
			relays: ['/ip4/127.0.0.1/tcp/4413/ws/p2p/12D3KooWExample']
		});
		expect(config.connectionGater?.denyDialMultiaddr?.(/** @type {any} */ ({}))).toBe(false);
	});
});
