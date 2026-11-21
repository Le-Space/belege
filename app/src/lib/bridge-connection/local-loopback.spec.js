// The bridge on this machine with device sync off (#580): the calls a page
// makes are held while the stream is set up – and, for a bridge just paired
// by code, until its node is paired too. Let go before that, a call finds the
// unpaired node's stream, loses it when the node restarts paired, and falls
// to HTTP, which answers 410 (#916: a run of suggestions started a second
// after the pairing asked nobody).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	/** @type {string[]} what happened, in order */
	order: [],
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
	setBridgeTransport: vi.fn(() => void mocks.order.push('transport')),
	holdBridgeTransport: vi.fn(() => {
		mocks.order.push('hold');
		return () => void mocks.order.push('release');
	}),
	DEFAULT_BRIDGE_URL: 'http://127.0.0.1:8765'
}));
vi.mock('$lib/sync/device-sync.js', () => ({ knownDevices: () => [] }));
vi.mock('$lib/sync/loopback-bridge.js', () => ({
	loopbackAddr: () => '/ip4/127.0.0.1/tcp/40123/ws',
	startLoopbackNode: vi.fn(async () => ({
		libp2p: {
			dial: vi.fn(async () => void mocks.order.push('dial')),
			addEventListener: vi.fn()
		},
		gate: { isProved: () => true }
	}))
}));
vi.mock('$lib/database-keys.js', () => ({
	bridgeAuthKeyOf: async () => new Uint8Array(32).fill(7)
}));
vi.mock('@libp2p/peer-id', () => ({ peerIdFromPrivateKey: () => '12D3KooWdevice' }));
vi.mock('@multiformats/multiaddr', () => ({ multiaddr: (/** @type {string} */ a) => a }));

const NODE = '12D3KooWnode';

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
 * Books open with device sync off and a bridge paired by code, on a fresh
 * copy of the module (it keeps the loopback node it started).
 *
 * @param {{ armed: boolean, nodePairedAt?: string }} p what `/health` says about the bridge's node
 */
async function open({ armed, nodePairedAt }) {
	vi.resetModules();
	const local = await import('./local.js');
	const { writeBridgeRecord } = await import('./record.js');
	const settings = memorySettings();
	await writeBridgeRecord(settings, {
		url: 'http://127.0.0.1:8765',
		token: 'made-up-token',
		...(nodePairedAt ? { peerId: NODE, nodePairedAt } : {})
	});
	mocks.createBridgeClient.mockReturnValue({
		health: vi.fn(async () => ({
			node: { enabled: true, armed, peerId: NODE, addrs: ['/ip4/127.0.0.1/tcp/40123/ws'] }
		})),
		nodeInvite: vi.fn(async () => 'web+ucep:pair?made-up')
	});
	let up = false;
	mocks.startBridgeConsumer.mockResolvedValue({
		streamServer: () => (up ? NODE : null),
		streamFetch: vi.fn(),
		remoteFetch: vi.fn(),
		tellDevices: vi.fn(async () => true),
		pairBridge: vi.fn(async (/** @type {any} */ options) => {
			options.before(NODE);
			mocks.order.push('paired');
			up = true;
			return { peerId: NODE, addrs: [] };
		})
	});
	local.bindSession(
		/** @type {any} */ ({
			session: {
				online: false,
				devicePeerKey: {},
				peerId: '12D3KooWdevice',
				relays: [],
				store: { settings },
				bridgeAuthBase: new Uint8Array(32),
				bridgeAuth: { peerId: null, key: null }
			},
			app: { sync: {} },
			deviceSync: null,
			deviceLabel: () => 'Test'
		})
	);
	return local;
}

/**
 * Waits for `work` with the clock moved on: its timers are set between
 * imports that take real time, so the clock moves until it is done.
 *
 * @param {Promise<unknown>} work
 */
async function finished(work) {
	let done = false;
	const settled = work.finally(() => (done = true));
	while (!done) {
		await vi.advanceTimersByTimeAsync(500);
		await new Promise((r) => setImmediate(r));
	}
	await settled;
}

beforeEach(() => {
	mocks.order.length = 0;
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
	vi.useRealTimers();
});

describe('the calls held while the bridge on this machine is reached over its node', () => {
	it('a bridge just paired by code: held until its node is paired', async () => {
		const local = await open({ armed: false });
		// The node restarts paired; pairBridgeNode waits for it.
		await finished(local.bridgeOnThisMachine());
		expect(mocks.order).toContain('paired');
		expect(mocks.order.indexOf('release')).toBeGreaterThan(mocks.order.indexOf('paired'));
		expect(mocks.order.indexOf('transport')).toBeLessThan(mocks.order.indexOf('release'));
	});

	it('a node paired before: let go as soon as the stream is the transport', async () => {
		const local = await open({ armed: true, nodePairedAt: '2026-01-01T00:00:00.000Z' });
		await finished(local.bridgeOnThisMachine());
		expect(mocks.order).not.toContain('paired');
		expect(mocks.order.slice(0, 3)).toEqual(['hold', 'transport', 'release']);
	});
});
