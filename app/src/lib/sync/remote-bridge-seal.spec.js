// Calls to the bridge's own node, sealed above the connection
// (@le-space/bridge-protocol/seal): what goes onto the stream, what counts as
// an answer, and a bridge from before. The UCEP consumer is a fake that plays
// the bridge; made-up keys and values only.
import { encodeInvitation } from '@le-space/ucep';
import { SEALED, handoverSecret, isSealed, openCall } from '@le-space/bridge-protocol/seal';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BRIDGE = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
const DESKTOP = '12D3KooWQYhTNQdmr3ArTeUHRYzFg94BKyTkoWBDWez9kSCVe2Xo';
const SELF = '12D3KooWself';
const KEY = new Uint8Array(32).fill(7);
const INVITATION_SECRET = new Uint8Array(32).fill(5);

/** What the fake bridge does with a call: set per test. */
const bridge = vi.hoisted(() => ({
	/** @type {(peerId: string, name: string, args: any) => Promise<any>} */
	answer: async () => ({}),
	/** @type {{ peerId: string, name: string, args: any }[]} */
	calls: [],
	paired: 0
}));

vi.mock('@le-space/ucep', async (original) => ({
	...(await original()),
	createConsumer: () => ({
		start: async () => {},
		stop: async () => {},
		addProvider: async () => ({ extensions: [{ extensionId: 'belege-bridge' }] }),
		pairWithInvitation: async () => void bridge.paired++,
		call: async (
			/** @type {string} */ peerId,
			/** @type {string} */ _ext,
			/** @type {string} */ name,
			/** @type {any} */ args
		) => {
			bridge.calls.push({ peerId, name, args });
			return bridge.answer(peerId, name, args);
		}
	})
}));
vi.mock('@le-space/bridge-protocol/exchange', () => ({
	createBlockExchange: async () => {
		throw new Error('no Bitswap in this test');
	}
}));

const { setBridgeNode, startBridgeConsumer } = await import('./remote-bridge.js');

const libp2p = {
	peerId: { toString: () => SELF },
	getConnections: () => [{ remotePeer: { toString: () => BRIDGE }, status: 'open' }]
};

/**
 * A bridge that seals: `help` says so, a sealed call is opened with `key` and
 * answered sealed; `seen` hears what it opened.
 *
 * @param {{ key?: Uint8Array, seen?: any[], reply?: (name: string, args: any) => unknown }} [o]
 */
const sealingBridge =
	({ key = KEY, seen = [], reply = () => ({ status: 200, json: { ok: true } }) } = {}) =>
	async (/** @type {string} */ peerId, /** @type {string} */ name, /** @type {any} */ args) => {
		if (name === 'help') return { seal: 1 };
		if (!isSealed(args)) return reply(name, args);
		const call = await openCall(key, { consumer: SELF, provider: peerId, command: name }, args);
		seen.push({ name, args: call.args });
		return call.seal(reply(name, call.args));
	};

/** @param {Partial<Parameters<typeof startBridgeConsumer>[0]>} [more] */
const consumerOf = (more = {}) =>
	startBridgeConsumer({
		libp2p,
		devices: () => [DESKTOP],
		bridgeKey: () => KEY,
		...more
	});

afterEach(() => {
	bridge.calls.length = 0;
	bridge.paired = 0;
	setBridgeNode(null);
});

describe('calls to the bridge’s node, sealed above the connection', () => {
	it('seals the arguments and opens the answer when the bridge says it seals', async () => {
		setBridgeNode({ peerId: BRIDGE });
		/** @type {any[]} */
		const seen = [];
		bridge.answer = sealingBridge({ seen });
		const c = await consumerOf();
		const res = await c.streamFetch('http://127.0.0.1:8765/mail/search?text=Rechnung');
		expect(await res.json()).toEqual({ ok: true });

		const sent = bridge.calls.filter((x) => x.name !== 'help');
		expect(sent).toHaveLength(1);
		expect(Object.keys(sent[0].args)).toEqual([SEALED]);
		expect(atob(sent[0].args[SEALED])).not.toContain('Rechnung');
		expect(seen).toEqual([
			{ name: 'request', args: { method: 'GET', path: '/mail/search?text=Rechnung' } }
		]);

		// `help` is asked once for the peer, and the bridge's other commands are sealed too.
		await c.tellDevices([DESKTOP]);
		await c.bridgeGrants();
		expect(bridge.calls.filter((x) => x.name === 'help')).toHaveLength(1);
		expect(seen.map((s) => s.name)).toEqual(['request', 'devices', 'grants']);
		expect(bridge.calls.filter((x) => x.name !== 'help').every((x) => isSealed(x.args))).toBe(true);
	});

	it('a bridge from before is called as before', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.answer = async (_peer, name) =>
			name === 'help' ? { protocol: 2 } : { status: 200, json: { old: true } };
		const c = await consumerOf();
		const res = await c.streamFetch('http://127.0.0.1:8765/health');
		expect(await res.json()).toEqual({ old: true });
		expect(bridge.calls.at(-1)?.args).toEqual({ method: 'GET', path: '/health' });
	});

	it('to a sealed call only a sealed answer counts, opened with the same key', async () => {
		setBridgeNode({ peerId: BRIDGE });
		// Says it seals, answers as it is.
		bridge.answer = async (_peer, name) =>
			name === 'help' ? { seal: 1 } : { status: 200, json: { plain: true } };
		const c = await consumerOf();
		await expect(c.streamFetch('http://127.0.0.1:8765/health')).rejects.toThrow(/not sealed/);
		// Sealed bytes that are not the answer to this call.
		bridge.answer = async () => ({ [SEALED]: btoa('x'.repeat(64)) });
		await expect(c.streamFetch('http://127.0.0.1:8765/health')).rejects.toThrow(/seal/);
	});

	it('without the bridge’s key, and to an own device’s bridge, nothing is sealed', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.answer = sealingBridge();
		const keyless = await consumerOf({ bridgeKey: () => null });
		await keyless.streamFetch('http://127.0.0.1:8765/health');
		expect(bridge.calls.map((x) => x.name)).toEqual(['request']);
		expect(isSealed(bridge.calls[0].args)).toBe(false);

		bridge.calls.length = 0;
		const c = await consumerOf();
		await c.remoteFetch('http://127.0.0.1:8765/health');
		expect(bridge.calls.every((x) => x.peerId === DESKTOP && !isSealed(x.args))).toBe(true);
		expect(bridge.calls.some((x) => x.name === 'help')).toBe(false);
	});

	it('the handover goes sealed with a key from the invitation', async () => {
		const invitation = encodeInvitation({
			providerPeerId: BRIDGE,
			extensionId: 'belege-bridge',
			invitationId: 'inv-1',
			secret: INVITATION_SECRET,
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			scopes: ['belege-bridge:pairing:manage'],
			addrs: []
		});
		/** @type {any[]} */
		const seen = [];
		bridge.answer = sealingBridge({
			key: await handoverSecret(INVITATION_SECRET),
			seen,
			reply: () => ({ peerId: BRIDGE })
		});
		const c = await consumerOf();
		const paired = await c.pairBridge({
			invitation,
			authKey: KEY,
			relays: [],
			devices: [SELF]
		});
		expect(paired.peerId).toBe(BRIDGE);
		expect(bridge.paired).toBe(1);
		const sent = bridge.calls.find((x) => x.name === 'handover');
		expect(Object.keys(sent?.args).sort()).toEqual([SEALED, 'inv']);
		expect(sent?.args.inv).toBe('inv-1');
		expect(seen).toEqual([
			{
				name: 'handover',
				args: { bridgeAuth: btoa(String.fromCharCode(...KEY)), relays: [], devices: [SELF] }
			}
		]);

		// A bridge from before gets the handover as it is.
		bridge.calls.length = 0;
		bridge.answer = async (_peer, name) => (name === 'help' ? {} : { peerId: BRIDGE });
		const old = await consumerOf();
		await old.pairBridge({ invitation, authKey: KEY, relays: [], devices: [SELF] });
		expect(bridge.calls.find((x) => x.name === 'handover')?.args).toEqual({
			bridgeAuth: btoa(String.fromCharCode(...KEY)),
			relays: [],
			devices: [SELF]
		});
	});
});
