import { describe, expect, it } from 'vitest';
import {
	BRIDGE_SETTING,
	HOSTED_SETTING,
	NEAR_HOSTED_SETTING,
	keyGenerationOf,
	readBridgeRecord,
	readHostedRecord,
	readNearHostedRecord,
	recordAfterUnpair,
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

	it('the generation of the bridge’s key: from 1, whatever else the record holds', () => {
		expect(keyGenerationOf(null)).toBe(1);
		expect(keyGenerationOf({})).toBe(1);
		expect(keyGenerationOf({ keyGeneration: 3 })).toBe(3);
		for (const bad of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
			expect(keyGenerationOf(/** @type {any} */ ({ keyGeneration: bad }))).toBe(1);
		}
	});
});

describe('recordAfterUnpair', () => {
	const paired = {
		url: 'http://127.0.0.1:8765',
		token: 'a-token',
		pairedAt: '2026-01-01T00:00:00.000Z',
		peerId: '12D3KooWExample',
		keyGeneration: 3,
		nodePairedAt: '2026-01-02T00:00:00.000Z'
	};

	it('keeps a hosted bridge’s node and its key generation, drops only the token', () => {
		expect(recordAfterUnpair(paired, 'http://127.0.0.1:8765', true)).toEqual({
			url: 'http://127.0.0.1:8765',
			token: null,
			peerId: '12D3KooWExample',
			keyGeneration: 3,
			nodePairedAt: '2026-01-02T00:00:00.000Z'
		});
	});

	it('drops the node of a bridge on a computer and moves to the next generation', () => {
		expect(recordAfterUnpair(paired, 'http://127.0.0.1:8765', false)).toEqual({
			url: 'http://127.0.0.1:8765',
			token: null,
			keyGeneration: 4
		});
	});

	it('keeps the generation when no node was paired, and adds none where none was', () => {
		expect(recordAfterUnpair({ token: 'a-token', keyGeneration: 2 }, 'u', false)).toEqual({
			url: 'u',
			token: null,
			keyGeneration: 2
		});
		expect(recordAfterUnpair({ token: 'a-token' }, 'u', true)).toEqual({ url: 'u', token: null });
		expect(recordAfterUnpair(null, 'u', false)).toEqual({ url: 'u', token: null });
	});
});
