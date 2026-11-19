import { describe, expect, it } from 'vitest';
import {
	BRIDGE_SETTING,
	HOSTED_SETTING,
	NEAR_HOSTED_SETTING,
	readBridgeRecord,
	readHostedRecord,
	readNearHostedRecord,
	writeBridgeRecord,
	writeHostedRecord,
	writeNearHostedRecord
} from './record.js';
import { HOSTED_SETTING as fromHostedBridge } from '$lib/integrations/hosted-bridge.js';

/** A settings collection in memory, as store/settings.js uses one. */
function memorySettings() {
	/** @type {Map<string, any>} */
	const records = new Map();
	return /** @type {any} */ ({
		records,
		list: async ({ where = () => true } = {}) => [...records.values()].filter(where),
		put: async (/** @type {any} */ record) => void records.set(record.key, record)
	});
}

describe('the bridge’s records', () => {
	it('keeps the keys people’s books already hold', () => {
		expect(BRIDGE_SETTING).toBe('bridge');
		expect(HOSTED_SETTING).toBe('bridge/hosted');
		expect(NEAR_HOSTED_SETTING).toBe('bridge/hosted-near');
		expect(fromHostedBridge).toBe(HOSTED_SETTING);
	});

	it('reads null while nothing was paired, started or unlocked', async () => {
		const settings = memorySettings();
		expect(await readBridgeRecord(settings)).toBeNull();
		expect(await readHostedRecord(settings)).toBeNull();
		expect(await readNearHostedRecord(settings)).toBeNull();
	});

	it('reads back what was written, each under its own key', async () => {
		const settings = memorySettings();
		const pairing = { url: 'http://127.0.0.1:8765', token: null, peerId: '12D3KooWnode' };
		const hosted = {
			instance: 'a'.repeat(64),
			host: 'vm.example.com',
			peerId: '12D3KooWvm',
			peerKey: 'AAAA',
			measurement: 'b'.repeat(64),
			attestedAt: '2026-01-01T00:00:00.000Z'
		};
		const near = {
			books: 'books.example.testnet',
			peerId: '12D3KooWtee',
			peerKey: 'BBBB',
			composeHash: 'c'.repeat(64),
			atMs: '1',
			attestedAt: '2026-01-01T00:00:00.000Z'
		};
		await writeBridgeRecord(settings, pairing);
		await writeHostedRecord(settings, hosted);
		await writeNearHostedRecord(settings, near);
		expect(await readBridgeRecord(settings)).toEqual(pairing);
		expect(await readHostedRecord(settings)).toEqual(hosted);
		expect(await readNearHostedRecord(settings)).toEqual(near);
		expect([...settings.records.keys()].sort()).toEqual([
			'bridge',
			'bridge/hosted',
			'bridge/hosted-near'
		]);
	});

	it('a write replaces the whole record', async () => {
		const settings = memorySettings();
		await writeBridgeRecord(settings, { url: 'http://127.0.0.1:8765', token: 'made-up-token' });
		await writeBridgeRecord(settings, { url: 'http://127.0.0.1:8765', token: null });
		expect(await readBridgeRecord(settings)).toEqual({ url: 'http://127.0.0.1:8765', token: null });
	});
});
