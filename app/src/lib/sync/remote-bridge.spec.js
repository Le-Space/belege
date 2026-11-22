// The desktop's bridge for own devices (issue #142): who may call, what may
// be called, the desktop's token and not the caller's, and the phone's fetch
// that falls back to it. No libp2p here; made-up values only.
import { UcepError } from '@le-space/ucep';
import { describe, expect, it } from 'vitest';

import {
	DEVICE_COMMANDS,
	allowed,
	askPeer,
	NODE_UNREACHABLE,
	STREAM_TOO_LARGE,
	StreamTooLarge,
	bridgeFetch,
	checkRequestSize,
	commandOf,
	bridgeNodePeer,
	grantRefusal,
	serveNamed,
	serveRequest,
	setBridgeNode
} from './remote-bridge.js';

const OWN = '12D3KooWown';
const STRANGER = '12D3KooWstranger';
const bridge = () => ({ url: 'http://127.0.0.1:8765', token: 'desktop-token' });
const isOwnDevice = (/** @type {string} */ id) => id === OWN;

/** A bridge that records what it was asked. @param {Response} answer */
function fakeBridge(answer) {
	/** @type {{ url: string, init: any }[]} */
	const calls = [];
	return {
		calls,
		fetch: /** @type {typeof fetch} */ (
			async (url, init) => {
				calls.push({ url: String(url), init });
				return answer.clone();
			}
		)
	};
}
const json = (/** @type {unknown} */ body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('what another device may call', () => {
	it('reading and asking; no pairing, setup, shares, portals or deleting', () => {
		expect(allowed('GET', '/health')).toBe(true);
		expect(allowed('POST', '/transfer/assist')).toBe(true);
		expect(allowed('POST', '/booking/assist')).toBe(true);
		expect(allowed('POST', '/travel/assist')).toBe(true);
		expect(allowed('POST', '/ethereum/wallet')).toBe(true);
		expect(allowed('GET', '/aleph/statement')).toBe(true);
		for (const [m, p] of [
			['POST', '/pair'],
			['POST', '/unpair'],
			['POST', '/share'],
			['GET', '/share'],
			['POST', '/mail/trash'],
			['POST', '/portals/new'],
			['GET', '/transfer/assist'],
			['GET', '/booking/assist'],
			['POST', '/health']
		])
			expect(allowed(m, p), `${m} ${p}`).toBe(false);
	});
});

describe('the desktop answering', () => {
	it('an own device gets the answer, asked with the desktop’s token', async () => {
		const b = fakeBridge(json({ pick: null }));
		const answer = await serveRequest({
			args: { method: 'POST', path: '/transfer/assist', body: { booking: {}, candidates: [] } },
			peerId: OWN,
			isOwnDevice,
			bridge,
			fetch: b.fetch
		});
		expect(answer).toMatchObject({ status: 200, json: { pick: null } });
		expect(b.calls[0].url).toBe('http://127.0.0.1:8765/transfer/assist');
		expect(b.calls[0].init.headers.Authorization).toBe('Bearer desktop-token');
		expect(JSON.parse(b.calls[0].init.body)).toEqual({ booking: {}, candidates: [] });
	});

	it('a query goes along; bytes come back as base64', async () => {
		const b = fakeBridge(
			new Response(new Uint8Array([37, 80, 68, 70]), {
				headers: { 'content-type': 'application/pdf' }
			})
		);
		const answer = await serveRequest({
			args: { method: 'GET', path: '/mail/attachment?id=abc&part=2' },
			peerId: OWN,
			isOwnDevice,
			bridge,
			fetch: b.fetch
		});
		expect(b.calls[0].url).toBe('http://127.0.0.1:8765/mail/attachment?id=abc&part=2');
		expect(answer).toMatchObject({
			status: 200,
			contentType: 'application/pdf',
			base64: 'JVBERg=='
		});
	});

	it('refused: a stranger, a path not on the list, a path to elsewhere, no bridge here', async () => {
		const b = fakeBridge(json({}));
		const ask = (/** @type {any} */ over) =>
			serveRequest({
				args: { method: 'GET', path: '/health' },
				peerId: OWN,
				isOwnDevice,
				bridge,
				fetch: b.fetch,
				...over
			});
		await expect(ask({ peerId: STRANGER })).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
		await expect(ask({ args: { method: 'POST', path: '/pair' } })).rejects.toMatchObject({
			code: 'INVALID_ARGUMENTS'
		});
		await expect(
			ask({ args: { method: 'GET', path: '//evil.example/health' } })
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
		await expect(ask({ args: { method: 'GET', path: 'health' } })).rejects.toMatchObject({
			code: 'INVALID_ARGUMENTS'
		});
		await expect(ask({ bridge: () => null })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(b.calls).toHaveLength(0);
	});
});

describe('the phone’s fetch', () => {
	it('the local bridge when it answers; the desktop’s when not, without this token', async () => {
		/** @type {any[]} */
		const remoteCalls = [];
		const remote = async (/** @type {any} */ input, /** @type {any} */ init) => {
			remoteCalls.push({ input: String(input), init });
			return json({ ok: true });
		};
		const up = bridgeFetch({ local: async () => json({ local: true }), remote: () => remote });
		expect(await (await up('http://127.0.0.1:8765/health')).json()).toEqual({ local: true });
		expect(remoteCalls).toHaveLength(0);

		const down = bridgeFetch({
			local: async () => {
				throw new TypeError('Failed to fetch');
			},
			remote: () => remote
		});
		const r = await down('http://127.0.0.1:8765/health', {
			headers: { Authorization: 'Bearer phone' }
		});
		expect(await r.json()).toEqual({ ok: true });
		expect(remoteCalls[0].init.headers.Authorization).toBeUndefined();

		const alone = bridgeFetch({
			local: async () => {
				throw new TypeError('Failed to fetch');
			},
			remote: () => null
		});
		await expect(alone('http://127.0.0.1:8765/health')).rejects.toThrow('Failed to fetch');
	});

	it('says which way each call went', async () => {
		/** @type {string[]} */
		const routes = [];
		let localUp = true;
		const f = bridgeFetch({
			local: async () => {
				if (!localUp) throw new TypeError('Failed to fetch');
				return json({});
			},
			remote: () => async () => json({}),
			onRoute: (r) => routes.push(r)
		});
		await f('http://127.0.0.1:8765/health');
		localUp = false;
		await f('http://127.0.0.1:8765/health');
		expect(routes).toEqual(['local', 'device']);
	});
});

describe('the bridge’s own node (#575)', () => {
	it('the stream first when it is there; HTTP when the stream fails; pairing stays with HTTP', async () => {
		/** @type {string[]} */
		const routes = [];
		/** @type {any[]} */
		const streamCalls = [];
		let streamUp = true;
		const stream = async (/** @type {any} */ input, /** @type {any} */ init) => {
			streamCalls.push({ input: String(input), init });
			if (!streamUp) throw new Error('TOO_LARGE');
			return json({ stream: true });
		};
		const f = bridgeFetch({
			local: async () => json({ local: true }),
			stream: () => stream,
			remote: () => null,
			onRoute: (r) => routes.push(r)
		});
		expect(
			await (
				await f('http://127.0.0.1:8765/health', { headers: { Authorization: 'Bearer phone' } })
			).json()
		).toEqual({ stream: true });
		expect(streamCalls[0].init.headers.Authorization).toBeUndefined();
		// Too big for the stream: HTTP on this machine answers.
		streamUp = false;
		expect(await (await f('http://127.0.0.1:8765/mail/raw?id=x')).json()).toEqual({ local: true });
		// Pairing and unpairing never go over the stream.
		streamUp = true;
		await f('http://127.0.0.1:8765/pair', { method: 'POST' });
		await f('http://127.0.0.1:8765/unpair', { method: 'POST' });
		expect(streamCalls).toHaveLength(2);
		expect(routes).toEqual(['stream', 'local', 'local', 'local']);
		// No node known: HTTP as before.
		const plain = bridgeFetch({ local: async () => json({ local: true }), remote: () => null });
		expect(await (await plain('http://127.0.0.1:8765/health')).json()).toEqual({ local: true });
	});

	it('waits for the node without a token, not with one', async () => {
		/** @type {(number | undefined)[]} */
		const waits = [];
		const f = bridgeFetch({
			local: async () => json({ local: true }),
			stream: () => async (_i, _init, options) => {
				waits.push(options?.waitMs);
				return json({ stream: true });
			},
			remote: () => null,
			waitMs: 1234
		});
		await f('http://127.0.0.1:8765/health');
		await f('http://127.0.0.1:8765/health', { headers: { Authorization: 'Bearer t' } });
		expect(waits).toEqual([1234, 0]);
	});

	it('knows the bridge’s node only by a peer id', () => {
		setBridgeNode({ peerId: 'nope' });
		expect(bridgeNodePeer()).toBeNull();
		setBridgeNode({ peerId: '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp' });
		expect(bridgeNodePeer()).toBe('12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp');
		setBridgeNode(null);
		expect(bridgeNodePeer()).toBeNull();
	});
});

describe('what the bridge’s node refuses a device (#579)', () => {
	it('as the answer the bridge client knows, never as a way that failed', () => {
		expect(grantRefusal(new UcepError('SCOPE_MISSING', 'bridge:llm'))).toEqual({
			status: 403,
			json: { error: 'bridge:llm', code: 'BRIDGE_SCOPE_MISSING' }
		});
		expect(grantRefusal(new UcepError('GRANT_EXPIRED'))?.json.code).toBe('BRIDGE_GRANT_EXPIRED');
		// The model's per-minute limit is a provider's 429: a run waits and goes on.
		expect(grantRefusal(new UcepError('RATE_LIMITED', 'llm-per-minute'))).toMatchObject({
			status: 429,
			json: { code: 'LLM_RATE_LIMIT' }
		});
		expect(grantRefusal(new UcepError('RATE_LIMITED', 'llm-tokens-per-day'))?.json.code).toBe(
			'BRIDGE_LLM_DAY'
		);
		expect(grantRefusal(new UcepError('RATE_LIMITED', 'backup-per-hour'))?.status).toBe(429);
		// Anything else is a way that failed: the fetch may try the next.
		expect(grantRefusal(new UcepError('TOO_LARGE'))).toBeNull();
		expect(grantRefusal(new UcepError('RATE_LIMITED', 'relayed'))).toBeNull();
		expect(grantRefusal(new TypeError('not connected'))).toBeNull();
	});
});

describe('by name (#577)', () => {
	it('a desktop serves by name what it serves by path, nothing more', () => {
		expect(DEVICE_COMMANDS).toContain('bank.transactions');
		expect(DEVICE_COMMANDS).toContain('chains.wallet');
		for (const name of [
			'session.pair',
			'share.create',
			'mail.trash',
			'backup.put',
			'device.scopes'
		])
			expect(DEVICE_COMMANDS, name).not.toContain(name);
	});

	it('the desktop asks its bridge the same path, after the catalogue’s check', async () => {
		const b = fakeBridge(json({ transactions: [] }));
		const answer = await serveNamed({
			name: 'bank.transactions',
			args: { account: 'a1', since: '2026-01-01' },
			peerId: OWN,
			isOwnDevice,
			bridge,
			fetch: b.fetch
		});
		expect(answer.status).toBe(200);
		expect(b.calls[0].url).toBe(
			'http://127.0.0.1:8765/hibiscus/transactions?account=a1&since=2026-01-01'
		);
		expect(b.calls[0].init.headers.Authorization).toBe('Bearer desktop-token');
		// By name to its own bridge too: the transport goes over the bridge's node (#580).
		expect(b.calls[0].init.command).toEqual({
			name: 'bank.transactions',
			args: { account: 'a1', since: '2026-01-01' }
		});
		// A desktop paired by invitation only has no token: none goes along.
		const noToken = fakeBridge(json({ ok: true }));
		await serveNamed({
			name: 'bridge.health',
			args: {},
			peerId: OWN,
			isOwnDevice,
			bridge: () => ({ url: 'http://127.0.0.1:8765', token: '' }),
			fetch: noToken.fetch
		});
		expect(noToken.calls[0].init.headers.Authorization).toBeUndefined();
		const refused = (/** @type {any} */ p) =>
			serveNamed({ peerId: OWN, isOwnDevice, bridge, fetch: b.fetch, ...p });
		await expect(refused({ name: 'mail.trash', args: { id: 'm1' } })).rejects.toMatchObject({
			code: 'UNKNOWN_COMMAND'
		});
		await expect(
			refused({ name: 'bank.transactions', args: { account: 'a1', since: '01.01.2026' } })
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
		await expect(
			serveNamed({
				name: 'bridge.health',
				args: {},
				peerId: STRANGER,
				isOwnDevice,
				bridge,
				fetch: b.fetch
			})
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
		expect(b.calls).toHaveLength(1);
	});

	it('a device calls by name, and by path where the peer does not know the command', async () => {
		/** @type {[string, unknown][]} */
		const asked = [];
		/** @param {Set<string>} known */
		const peer = (known) => async (/** @type {string} */ name, /** @type {any} */ args) => {
			asked.push([name, args]);
			if (name !== 'request' && !known.has(name)) throw new UcepError('UNKNOWN_COMMAND', name);
			return { status: 200, contentType: 'application/json', json: {} };
		};
		const init = /** @type {any} */ ({
			method: 'GET',
			command: { name: 'bank.accounts', args: {} }
		});
		const pathOnly = new Set();
		const input = 'http://127.0.0.1:8765/hibiscus/accounts';
		await askPeer({ call: peer(new Set(['bank.accounts'])), peerId: 'p1', input, init, pathOnly });
		expect(asked).toEqual([['bank.accounts', {}]]);

		// A bridge from before: once by name, then by path – and only by path after.
		asked.length = 0;
		const old = peer(new Set());
		await askPeer({ call: old, peerId: 'p2', input, init, pathOnly });
		await askPeer({ call: old, peerId: 'p2', input, init, pathOnly });
		expect(asked.map(([n]) => n)).toEqual(['bank.accounts', 'request', 'request']);
		expect(asked[1][1]).toEqual({ method: 'GET', path: '/hibiscus/accounts' });

		// Any other refusal is the answer, not a reason to try the path.
		const scope = async () => {
			throw new UcepError('SCOPE_MISSING', 'bank');
		};
		await expect(
			askPeer({ call: scope, peerId: 'p3', input, init, pathOnly })
		).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
	});

	it('a big answer as blocks: `$accept` beside the arguments, once refused not again (#578)', async () => {
		/** @type {[string, any][]} */
		const asked = [];
		const init = /** @type {any} */ ({
			method: 'GET',
			command: { name: 'paperless.document', args: { id: 7 } }
		});
		const input = 'http://127.0.0.1:8765/paperless/document?id=7';
		const pathOnly = new Set();
		const noBlocks = new Set();
		const answer = {
			status: 200,
			contentType: 'application/pdf',
			block: { cid: 'b', size: 1, key: 'k' }
		};
		await askPeer({
			call: async (name, args) => (asked.push([name, args]), answer),
			peerId: 'p1',
			input,
			init,
			pathOnly,
			blocks: true,
			noBlocks
		});
		expect(asked).toEqual([['paperless.document', { id: 7, $accept: ['blocks'] }]]);

		// A bridge from before #578 refuses the unknown argument: asked again without, and remembered.
		asked.length = 0;
		const old = async (/** @type {string} */ name, /** @type {any} */ args) => {
			asked.push([name, args]);
			if (args.$accept) throw new UcepError('INVALID_ARGUMENTS', '$accept: not expected');
			return { status: 200, contentType: 'application/pdf', base64: 'AA==' };
		};
		const p = { call: old, peerId: 'p2', input, init, pathOnly, blocks: true, noBlocks };
		await askPeer(p);
		await askPeer(p);
		expect(asked.map(([, a]) => Boolean(a.$accept))).toEqual([true, false, false]);

		// JSON answers and a desktop (no blocks) never send it.
		asked.length = 0;
		await askPeer({ ...p, peerId: 'p3', blocks: false });
		await askPeer({
			...p,
			peerId: 'p4',
			init: /** @type {any} */ ({ method: 'GET', command: { name: 'bank.accounts', args: {} } })
		});
		expect(asked.every(([, a]) => !a.$accept)).toBe(true);
	});

	it('the desktop forwards what the asking device may call, by its own scopes (#579, #580)', async () => {
		const b = fakeBridge(json({ accounts: [] }));
		/** @type {[string, string][]} */
		const asked = [];
		const mayCall = async (/** @type {string} */ peer, /** @type {string} */ name) => {
			asked.push([peer, name]);
			if (name === 'bank.accounts') throw new UcepError('SCOPE_MISSING', 'bridge:bank:read');
		};
		const base = { peerId: OWN, isOwnDevice, bridge, fetch: b.fetch, mayCall };
		await expect(serveNamed({ ...base, name: 'bank.accounts', args: {} })).rejects.toMatchObject({
			code: 'SCOPE_MISSING'
		});
		// As `request` too: the path's command decides.
		await expect(
			serveRequest({ ...base, args: { method: 'GET', path: '/hibiscus/accounts' } })
		).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
		expect(b.calls).toHaveLength(0);
		await serveNamed({ ...base, name: 'llm.status', args: {} });
		expect(b.calls).toHaveLength(1);
		expect(asked.map(([, n]) => n)).toEqual(['bank.accounts', 'bank.accounts', 'llm.status']);
		expect(commandOf('POST', '/nyx/wallet')).toBe('chains.wallet');
		expect(commandOf('GET', '/nope')).toBe(null);
	});

	it('HTTP that answers 410 is no way to the bridge: another device’s is asked (#580)', async () => {
		/** @type {string[]} */
		const routes = [];
		const gone = new Response(JSON.stringify({ code: 'HTTP_GONE' }), { status: 410 });
		const fetchLike = bridgeFetch({
			local: async () => gone.clone(),
			stream: () => null,
			remote: () => async () => json({ ok: true }),
			onRoute: (r) => routes.push(r)
		});
		const res = await fetchLike('http://127.0.0.1:8765/llm/status', {});
		expect(res.status).toBe(200);
		expect(routes).toEqual(['device']);
		// No other device: the 410 itself, for the client's message.
		const alone = bridgeFetch({
			local: async () => gone.clone(),
			stream: () => null,
			remote: () => null
		});
		expect((await alone('http://127.0.0.1:8765/llm/status', {})).status).toBe(410);
	});
});

describe('a call when the bridge’s node is not connected', () => {
	const notConnected = () => async () => {
		throw new TypeError('the bridge’s node is not connected');
	};

	it('without a token: the node is not reachable – not HTTP’s 401 “unknown device”', async () => {
		/** @type {string[]} */
		const routes = [];
		const f = bridgeFetch({
			local: async () => json({ error: 'unauthorized' }, 401),
			stream: notConnected,
			remote: () => null,
			onRoute: (r) => routes.push(r),
			waitMs: 0
		});
		const res = await f('http://127.0.0.1:8765/booking/assist', { method: 'POST' });
		expect(res.status).toBe(503);
		expect((await res.json()).code).toBe(NODE_UNREACHABLE);
		expect(routes).toEqual([]);
	});

	it('without a token and no bridge on this machine either: the same, not “Failed to fetch”', async () => {
		const f = bridgeFetch({
			local: async () => {
				throw new TypeError('Failed to fetch');
			},
			stream: notConnected,
			remote: () => null,
			waitMs: 0
		});
		expect((await (await f('http://127.0.0.1:8765/health')).json()).code).toBe(NODE_UNREACHABLE);
	});

	it('with a token, HTTP’s answer stands: a 401 there means this token is unknown', async () => {
		const f = bridgeFetch({
			local: async () => json({ error: 'unauthorized' }, 401),
			stream: notConnected,
			remote: () => null
		});
		const res = await f('http://127.0.0.1:8765/health', {
			headers: { Authorization: 'Bearer old' }
		});
		expect(res.status).toBe(401);
	});

	it('a stream that failed otherwise (an answer too big): HTTP’s answer stands', async () => {
		const f = bridgeFetch({
			local: async () => json({ error: 'unauthorized' }, 401),
			stream: () => async () => {
				throw new Error('TOO_LARGE');
			},
			remote: () => null,
			waitMs: 0
		});
		expect((await f('http://127.0.0.1:8765/health')).status).toBe(401);
	});

	it('no node known at all: HTTP’s answer stands', async () => {
		const f = bridgeFetch({
			local: async () => json({ error: 'unauthorized' }, 401),
			stream: () => null,
			remote: () => null
		});
		expect((await f('http://127.0.0.1:8765/health')).status).toBe(401);
	});
});

describe('a call too large for the bridge’s node (#969)', () => {
	const tooBig = () => async () => {
		throw new StreamTooLarge('llm.booking', 70_000);
	};

	it('says so, and goes neither to HTTP on this machine nor to another device', async () => {
		/** @type {string[]} */
		const asked = [];
		const f = bridgeFetch({
			local: async () => {
				asked.push('local');
				return json({ error: 'unauthorized' }, 401);
			},
			stream: tooBig,
			remote: () => async () => {
				asked.push('device');
				return json({});
			},
			waitMs: 0
		});
		const res = await f('http://127.0.0.1:8765/booking/assist', {
			method: 'POST',
			headers: { Authorization: 'Bearer token-of-another-pairing' }
		});
		expect(res.status).toBe(413);
		expect((await res.json()).code).toBe(STREAM_TOO_LARGE);
		expect(asked).toEqual([]);
	});

	it('through an own device, the same answer', async () => {
		const f = bridgeFetch({
			local: async () => {
				throw new TypeError('Failed to fetch');
			},
			stream: () => null,
			remote: () => tooBig(),
			waitMs: 0
		});
		const res = await f('http://127.0.0.1:8765/booking/assist', { method: 'POST' });
		expect(res.status).toBe(413);
	});

	it('another failure of the stream still falls back to HTTP, as before', async () => {
		/** @type {string[]} */
		const routes = [];
		const f = bridgeFetch({
			local: async () => json({ ok: true }),
			stream: () => async () => {
				throw new Error('stream reset');
			},
			remote: () => null,
			onRoute: (r) => routes.push(r),
			waitMs: 0
		});
		const res = await f('http://127.0.0.1:8765/llm/status', {
			headers: { Authorization: 'Bearer t' }
		});
		expect(res.status).toBe(200);
		expect(routes).toEqual(['local']);
	});

	it('checkRequestSize: a request of UCEP’s size and more is refused, a small one not', () => {
		expect(() => checkRequestSize('llm.booking', { x: 'a'.repeat(64 * 1024) })).toThrow(
			StreamTooLarge
		);
		expect(() => checkRequestSize('llm.booking', { x: 'a'.repeat(1000) })).not.toThrow();
	});
});
