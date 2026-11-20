// The bridge on a computer, with device sync on (#844, B5): three interactions
// that went wrong before, each held here against the module itself –
// finding its node again after a restart, pairing a bridge again whose pairing
// was undone, and asking over HTTP while a stream to it exists.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	startBridgeConsumer: vi.fn(),
	createBridgeClient: vi.fn()
}));

vi.mock('$lib/sync/remote-bridge.js', () => ({
	startBridgeConsumer: mocks.startBridgeConsumer,
	startBridgeProvider: vi.fn(),
	bridgeFetch: vi.fn(() => vi.fn()),
	bridgeShareOn: () => false,
	setBridgeNode: vi.fn()
}));
vi.mock('$lib/bridge/client.js', () => ({
	createBridgeClient: mocks.createBridgeClient,
	setBridgeTransport: vi.fn(),
	holdBridgeTransport: vi.fn(() => () => {}),
	DEFAULT_BRIDGE_URL: 'http://127.0.0.1:8765'
}));
vi.mock('$lib/sync/device-sync.js', () => ({ knownDevices: () => [] }));
vi.mock('$lib/sync/loopback-bridge.js', async () => {
	// Only the pure reader of the node's addresses; no node is started here.
	return {
		loopbackAddr: (/** @type {any} */ addrs) => {
			const found = (Array.isArray(addrs) ? addrs : []).find((/** @type {any} */ a) =>
				/^\/ip4\/127\.\d+\.\d+\.\d+\/tcp\/\d+\/ws(\/|$)/.test(a)
			);
			return found ? found.replace(/\/p2p\/[^/]+$/, '') : null;
		},
		startLoopbackNode: vi.fn()
	};
});
vi.mock('$lib/database-keys.js', () => ({
	bridgeAuthKeyOf: async () => new Uint8Array(32).fill(7)
}));

import {
	bindSession,
	bridgeOnThisMachine,
	pairBridgeNode,
	startBridgeForDevices
} from './local.js';
import { readBridgeRecord, writeBridgeRecord } from './record.js';

const NODE = '12D3KooWnode';
const HERE = `/ip4/127.0.0.1/tcp/40123/ws/p2p/${NODE}`;

/** A settings collection in memory, as store/settings.js uses one. */
function memorySettings() {
	/** @type {Map<string, any>} */
	const records = new Map();
	return /** @type {any} */ ({
		list: async ({ where = () => true } = {}) => [...records.values()].filter(where),
		put: async (/** @type {any} */ record) => void records.set(record.key, record),
		onChange: () => {}
	});
}

/**
 * Books open with device sync on, as after an unlock.
 *
 * @param {{ record: import('./record.js').BridgeRecord, node?: any, streamUp?: boolean }} p
 *   the saved pairing, what `/health` says about the bridge's node, and whether a stream to it exists
 */
async function unlocked({ record, node = null, streamUp = false }) {
	const settings = memorySettings();
	await writeBridgeRecord(settings, record);
	const http = {
		health: vi.fn(async () => ({ node })),
		nodeInvite: vi.fn(async () => 'web+ucep:pair?made-up')
	};
	mocks.createBridgeClient.mockReturnValue(http);
	let up = streamUp;
	const consumer = {
		streamServer: () => (up ? NODE : null),
		streamFetch: vi.fn(),
		remoteFetch: vi.fn(),
		tellDevices: vi.fn(async () => true),
		pairBridge: vi.fn(async (/** @type {any} */ options) => {
			options.before(NODE);
			up = true;
			return { peerId: NODE, addrs: [HERE] };
		})
	};
	mocks.startBridgeConsumer.mockResolvedValue(consumer);
	const deviceSync = {
		bridgeListensAt: vi.fn(async () => {}),
		expectDevice: vi.fn(),
		addDevice: vi.fn(async () => {})
	};
	bindSession(
		/** @type {any} */ ({
			session: {
				online: true,
				libp2p: {},
				peerId: '12D3KooWdevice',
				relays: ['/dns4/relay.example/tcp/443/wss/p2p/12D3KooWExample'],
				store: { settings },
				bridgeAuthBase: new Uint8Array(32),
				bridgeAuth: { peerId: null, key: null },
				deviceGate: { isProved: () => true }
			},
			app: { sync: { state: { devices: [] } } },
			deviceSync,
			deviceLabel: () => 'Test'
		})
	);
	await startBridgeForDevices();
	// What an unlock starts without waiting for it has run.
	await new Promise((r) => setTimeout(r, 20));
	return { settings, http, consumer, deviceSync };
}

beforeEach(() => {
	mocks.createBridgeClient.mockReset();
	mocks.startBridgeConsumer.mockReset();
});

describe('the bridge’s node after a restart', () => {
	const paired = { peerId: NODE, token: null, nodePairedAt: '2026-01-01T00:00:00.000Z' };

	it('is found where it listens on this machine now', async () => {
		const { deviceSync } = await unlocked({
			record: paired,
			node: { enabled: true, armed: true, peerId: NODE, addrs: ['/ip4/192.0.2.7/tcp/1/ws', HERE] }
		});
		await bridgeOnThisMachine();
		expect(deviceSync.bridgeListensAt).toHaveBeenCalledWith(NODE, '/ip4/127.0.0.1/tcp/40123/ws');
	});

	it('another node answering here is not dialled', async () => {
		const { deviceSync } = await unlocked({
			record: paired,
			node: { enabled: true, armed: true, peerId: '12D3KooWother', addrs: [HERE] }
		});
		await bridgeOnThisMachine();
		expect(deviceSync.bridgeListensAt).not.toHaveBeenCalled();
	});
});

describe('a stream to the bridge’s node exists', () => {
	it('nothing is asked over HTTP', async () => {
		const { http, deviceSync } = await unlocked({
			record: { peerId: NODE, token: null, nodePairedAt: '2026-01-01T00:00:00.000Z' },
			node: { enabled: true, armed: true, peerId: NODE, addrs: [HERE] },
			streamUp: true
		});
		await bridgeOnThisMachine();
		expect(mocks.createBridgeClient).not.toHaveBeenCalled();
		expect(http.health).not.toHaveBeenCalled();
		expect(deviceSync.bridgeListensAt).not.toHaveBeenCalled();
	});
});

describe('a bridge whose pairing was undone', () => {
	const unarmed = { enabled: true, armed: false, peerId: NODE, addrs: [HERE] };

	it('is not paired again unasked', async () => {
		const { http, consumer } = await unlocked({
			record: {
				url: 'http://127.0.0.1:8765',
				token: 'made-up-token',
				nodePairedAt: '2026-01-01T00:00:00.000Z'
			},
			node: unarmed
		});
		await bridgeOnThisMachine();
		expect(http.nodeInvite).not.toHaveBeenCalled();
		expect(consumer.pairBridge).not.toHaveBeenCalled();
	});

	it('paired on a click: let through although the books hold it as removed, and kept as their bridge', async () => {
		const { settings, consumer, deviceSync } = await unlocked({
			record: { url: 'http://127.0.0.1:8765', token: 'made-up-token' },
			// Armed: nothing pairs by itself; the click below does.
			node: { ...unarmed, armed: true }
		});
		expect(consumer.pairBridge).not.toHaveBeenCalled();
		expect(await pairBridgeNode('web+ucep:pair?made-up')).toEqual({ peerId: NODE });
		expect(deviceSync.expectDevice).toHaveBeenCalledWith(NODE);
		const kept = await readBridgeRecord(settings);
		expect(kept).toMatchObject({ peerId: NODE, keyGeneration: 1, token: 'made-up-token' });
		expect(kept?.nodePairedAt).toBeTruthy();
		expect(deviceSync.addDevice).toHaveBeenCalledWith(
			NODE,
			expect.any(String),
			expect.objectContaining({ bridge: true })
		);
	});

	it('a pairing that fails takes the exception back', async () => {
		const { consumer, deviceSync } = await unlocked({
			record: { url: 'http://127.0.0.1:8765', token: 'made-up-token' },
			node: { ...unarmed, armed: true }
		});
		consumer.pairBridge.mockImplementationOnce(async (/** @type {any} */ options) => {
			options.before(NODE);
			throw new Error('refused');
		});
		await expect(pairBridgeNode('web+ucep:pair?made-up')).rejects.toThrow('refused');
		expect(deviceSync.expectDevice).toHaveBeenLastCalledWith(NODE, false);
	});
});
