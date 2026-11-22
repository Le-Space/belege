// The request limit the bridge's node states in its UCEP manifest (#976):
// read instead of a fixed 64 KiB, 64 KiB for a bridge from before and over a
// limited (relayed) connection, asked again when the copy is from before the
// bridge was armed; and a call too large for it never handed to another way.
// The UCEP consumer is a fake that plays the bridge; made-up keys and texts.
import { sealCall } from '@le-space/bridge-protocol/seal';
import { LIMITS, UcepError } from '@le-space/ucep';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	BRIDGE_BODY_LIMIT,
	MAX_ASSIST_BYTES,
	jsonBytes,
	maxAssistBytes
} from '../booking/assist-input.js';
import { DEFAULT_REQUEST_LIMIT, bridgeRequestLimit } from './bridge-limit.js';

const BRIDGE = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
const SELF = '12D3KooWself';
const KEY = new Uint8Array(32).fill(7);
const MiB = 1024 * 1024;

/** What the fake bridge states and does: set per test. */
const bridge = vi.hoisted(() => ({
	/** the request limit its manifest states, as the consumer reads it */
	stated: 64 * 1024,
	/** …and after a fresh read of the manifest (`refresh`) */
	afterRefresh: /** @type {number | null} */ (null),
	/** @type {{ refresh: boolean }[]} */
	asked: [],
	/** @type {{ name: string, bytes: number }[]} */
	calls: [],
	/** @type {((name: string, args: any) => any) | null} */
	fail: null
}));

vi.mock('@le-space/ucep', async (original) => ({
	...(await original()),
	createConsumer: () => ({
		start: async () => {},
		stop: async () => {},
		addProvider: async () => ({ extensions: [] }),
		limitsFor: async (
			/** @type {string} */ _peer,
			/** @type {string} */ _ext,
			/** @type {{ refresh?: boolean }} */ { refresh = false } = {}
		) => {
			bridge.asked.push({ refresh });
			const request = refresh && bridge.afterRefresh ? bridge.afterRefresh : bridge.stated;
			return { request: Math.min(request, MiB), response: MiB };
		},
		call: async (
			/** @type {string} */ _peer,
			/** @type {string} */ _ext,
			/** @type {string} */ name,
			/** @type {any} */ args
		) => {
			if (name === 'help') return { protocol: 2 };
			bridge.calls.push({ name, bytes: jsonBytes(args) });
			if (bridge.fail) return bridge.fail(name, args);
			return { status: 200, json: { read: true } };
		}
	})
}));
vi.mock('@le-space/bridge-protocol/exchange', () => ({
	createBlockExchange: async () => {
		throw new Error('no Bitswap in this test');
	}
}));

const { STREAM_TOO_LARGE, bridgeFetch, checkRequestSize, setBridgeNode, startBridgeConsumer } =
	await import('./remote-bridge.js');

/** @param {{ limited?: boolean }} [o] a direct connection, or a relayed one with js-libp2p's default data limit */
const node = ({ limited = false } = {}) => ({
	peerId: { toString: () => SELF },
	getConnections: () => [
		{
			remotePeer: { toString: () => BRIDGE },
			status: 'open',
			...(limited ? { limits: { bytes: 128n * 1024n, seconds: 120 } } : {})
		}
	]
});

/** A receipt's text of about 300 kB: many pages of made-up line items. */
const LONG = 'Wolkenfabrik Hosting GmbH, Position, 12,34 EUR\n'.repeat(4000);

/** @param {any} c the consumer @param {string} [text] */
const extract = (c, text = LONG) =>
	c.streamFetch('http://127.0.0.1:8765/extract', {
		method: 'POST',
		body: JSON.stringify({ text })
	});

afterEach(() => {
	Object.assign(bridge, { stated: 64 * 1024, afterRefresh: null, fail: null });
	bridge.asked.length = 0;
	bridge.calls.length = 0;
	setBridgeNode(null);
});

describe('the request limit of the bridge’s node (#976)', () => {
	it('a bridge that states 1 MiB gets a long text whole, and callers size by it', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.stated = MiB;
		const c = await startBridgeConsumer({ libp2p: node(), devices: () => [] });
		expect(bridgeRequestLimit()).toBe(DEFAULT_REQUEST_LIMIT);
		const res = await extract(c);
		expect(await res.json()).toEqual({ read: true });
		expect(bridge.calls.at(-1)?.bytes).toBeGreaterThan(128 * 1024);
		expect(bridgeRequestLimit()).toBe(MiB);
		await c.stop();
		expect(bridgeRequestLimit()).toBe(DEFAULT_REQUEST_LIMIT);
	});

	it('sealed, the long text still fits 1 MiB, and not 64 KiB: the seal’s third is counted', async () => {
		const call = await sealCall(
			KEY,
			{ consumer: SELF, provider: BRIDGE, command: 'request' },
			{
				method: 'POST',
				path: '/extract',
				body: { text: LONG }
			}
		);
		expect(jsonBytes(call.sent)).toBeGreaterThan(Math.floor((LONG.length * 4) / 3));
		expect(() => checkRequestSize('request', call.sent, MiB)).not.toThrow();
		expect(() => checkRequestSize('request', call.sent)).toThrow(/too large/);
	});

	it('a bridge from before states nothing: 64 KiB, the call is refused here and goes nowhere else', async () => {
		setBridgeNode({ peerId: BRIDGE });
		const c = await startBridgeConsumer({ libp2p: node(), devices: () => [] });
		/** @type {string[]} */
		const elsewhere = [];
		const f = bridgeFetch({
			local: async () => {
				elsewhere.push('local');
				return new Response('{}', { status: 401 });
			},
			stream: () => c.streamFetch,
			remote: () => async () => {
				elsewhere.push('device');
				return new Response('{}');
			},
			waitMs: 0
		});
		const res = await f('http://127.0.0.1:8765/extract', {
			method: 'POST',
			body: JSON.stringify({ text: LONG })
		});
		expect(res.status).toBe(413);
		expect((await res.json()).code).toBe(STREAM_TOO_LARGE);
		expect(elsewhere).toEqual([]);
		expect(bridge.calls).toEqual([]);
		// Asked once more before refusing: the copy might be from before the bridge was armed.
		expect(bridge.asked.some((a) => a.refresh)).toBe(true);
		// Asked again at most once a minute: a second long call is refused without asking.
		const asked = bridge.asked.length;
		expect(
			(
				await f('http://127.0.0.1:8765/extract', {
					method: 'POST',
					body: JSON.stringify({ text: LONG })
				})
			).status
		).toBe(413);
		expect(bridge.asked.slice(asked).some((a) => a.refresh)).toBe(false);
		// A short text still goes.
		expect((await extract(c, 'kurz')).status).toBe(200);
		expect(bridgeRequestLimit()).toBe(LIMITS.request);
		await c.stop();
	});

	it('a limit read before the bridge was armed is asked again, and then holds', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.afterRefresh = MiB;
		const c = await startBridgeConsumer({ libp2p: node(), devices: () => [] });
		const res = await extract(c);
		expect(res.status).toBe(200);
		expect(bridge.asked.filter((a) => a.refresh)).toHaveLength(1);
		expect(bridgeRequestLimit()).toBe(MiB);
		await c.stop();
	});

	it('over a limited (relayed) connection 64 KiB holds, whatever the bridge states', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.stated = MiB;
		const c = await startBridgeConsumer({ libp2p: node({ limited: true }), devices: () => [] });
		await expect(extract(c)).rejects.toMatchObject({ code: STREAM_TOO_LARGE });
		expect(bridge.calls).toEqual([]);
		expect(bridgeRequestLimit()).toBe(LIMITS.request);
		await c.stop();
	});

	it('UCEP’s own refusal of a request is the same as this one: not sent, not handed on', async () => {
		setBridgeNode({ peerId: BRIDGE });
		bridge.stated = MiB;
		bridge.fail = () => {
			throw new UcepError('TOO_LARGE', 'open a direct connection first', {
				limit: LIMITS.request,
				part: 'request'
			});
		};
		const c = await startBridgeConsumer({ libp2p: node(), devices: () => [] });
		await expect(extract(c)).rejects.toMatchObject({ code: STREAM_TOO_LARGE });
		// An answer too large is not that: it may go another way, as before.
		bridge.fail = () => {
			throw new UcepError('TOO_LARGE', 'too big for a stream');
		};
		await expect(extract(c)).rejects.toMatchObject({ code: 'TOO_LARGE' });
		await c.stop();
	});
});

describe('the account list’s budget by the request limit (#972, #976)', () => {
	it('44 KiB for UCEP’s default, the same share of a bigger limit up to the bridge’s body limit', () => {
		expect(maxAssistBytes()).toBe(MAX_ASSIST_BYTES);
		expect(maxAssistBytes(LIMITS.request)).toBe(MAX_ASSIST_BYTES);
		expect(maxAssistBytes(128 * 1024)).toBe(88 * 1024);
		expect(maxAssistBytes(MiB)).toBe(BRIDGE_BODY_LIMIT - 4096);
		expect(maxAssistBytes(Number.NaN)).toBe(MAX_ASSIST_BYTES);
	});
});
