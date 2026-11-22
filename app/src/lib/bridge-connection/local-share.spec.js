// A desktop serves its bridge to the books' other devices (#142) and asks the
// bridge what each may call (#579). A device just let in is not on the
// bridge's list until the desktop tells it: it is told then, not refused as
// if it held no scope, and a list the bridge did not take is told again (#984).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PHONE = '12D3KooWphone';

const mocks = vi.hoisted(() => ({
	startBridgeConsumer: vi.fn(),
	startBridgeProvider: vi.fn()
}));

vi.mock('$lib/sync/remote-bridge.js', () => ({
	startBridgeConsumer: mocks.startBridgeConsumer,
	startBridgeProvider: mocks.startBridgeProvider,
	bridgeFetch: vi.fn(() => vi.fn()),
	bridgeShareOn: () => true,
	setBridgeNode: vi.fn()
}));
vi.mock('$lib/bridge/client.js', () => ({
	createBridgeClient: vi.fn(() => ({ health: async () => ({ node: null }) })),
	setBridgeTransport: vi.fn(),
	holdBridgeTransport: vi.fn(() => () => {}),
	DEFAULT_BRIDGE_URL: 'http://127.0.0.1:8765'
}));
vi.mock('$lib/sync/device-sync.js', () => ({
	knownDevices: () => [{ peerId: PHONE, bridge: false, bridgeScopes: null }]
}));
vi.mock('$lib/database-keys.js', () => ({
	bridgeAuthKeyOf: async () => new Uint8Array(32).fill(7)
}));

import { bindSession, startBridgeForDevices } from './local.js';

/** A settings collection in memory whose changes can be fired. */
function memorySettings() {
	/** @type {(() => void)[]} */
	const listeners = [];
	return {
		list: async () => [],
		put: async () => {},
		onChange: (/** @type {() => void} */ f) => void listeners.push(f),
		changed: () => listeners.forEach((f) => f())
	};
}

/**
 * The desktop's books open, sharing their bridge.
 *
 * @param {{ knows: () => boolean, tell: () => Promise<boolean> }} bridge whether the bridge's
 *   grants list the phone, and what telling it the device list does
 */
async function serving({ knows, tell }) {
	const settings = memorySettings();
	const libp2p = {};
	const consumer = {
		streamServer: () => null,
		streamFetch: vi.fn(),
		remoteFetch: vi.fn(),
		tellDevices: vi.fn(tell),
		bridgeGrants: vi.fn(async () => ({
			holder: true,
			scopes: ['bridge:llm'],
			devices: knows()
				? [{ peerId: PHONE, scopes: ['bridge:llm'], lastUsedAt: null, expiresAt: null }]
				: []
		}))
	};
	mocks.startBridgeConsumer.mockResolvedValue(consumer);
	/** @type {any} */
	let provider = null;
	mocks.startBridgeProvider.mockImplementation(async (/** @type {any} */ p) => {
		provider = p;
	});
	bindSession(
		/** @type {any} */ ({
			session: {
				online: true,
				libp2p,
				peerId: '12D3KooWdesk',
				relays: [],
				store: { settings },
				bridgeAuthBase: null,
				bridgeAuth: { peerId: null, key: null },
				deviceGate: { isProved: () => true }
			},
			app: { sync: { state: { devices: [] } } },
			deviceSync: null,
			deviceLabel: () => 'Test'
		})
	);
	await startBridgeForDevices();
	return { settings, consumer, mayCall: provider.mayCall };
}

beforeEach(() => {
	mocks.startBridgeConsumer.mockReset();
	mocks.startBridgeProvider.mockReset();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('a device the bridge does not know yet', () => {
	it('is told to the bridge, then let through', async () => {
		let told = false;
		const { consumer, mayCall } = await serving({
			knows: () => told,
			tell: async () => (told = true)
		});
		await expect(mayCall(PHONE, 'llm.status')).resolves.toBeUndefined();
		expect(consumer.tellDevices).toHaveBeenCalledWith([PHONE]);
	});

	it('the bridge still does not list it: refused, as before', async () => {
		const { mayCall } = await serving({ knows: () => false, tell: async () => true });
		await expect(mayCall(PHONE, 'llm.status')).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
	});
});

describe('a device list the bridge did not take', () => {
	it('is told again a little later', async () => {
		vi.useFakeTimers();
		let up = false;
		const { settings, consumer } = await serving({
			knows: () => false,
			tell: async () => up
		});
		settings.changed();
		await vi.advanceTimersByTimeAsync(1500);
		expect(consumer.tellDevices).toHaveBeenCalledTimes(1);
		// The bridge's node is connected by now.
		up = true;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(consumer.tellDevices).toHaveBeenCalledTimes(2);
		// Taken: not told again while the list stays the same.
		await vi.advanceTimersByTimeAsync(20_000);
		expect(consumer.tellDevices).toHaveBeenCalledTimes(2);
	});
});
