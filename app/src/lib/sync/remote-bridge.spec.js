// The desktop's bridge for own devices (issue #142): who may call, what may
// be called, the desktop's token and not the caller's, and the phone's fetch
// that falls back to it. No libp2p here; made-up values only.
import { describe, expect, it } from 'vitest';

import { allowed, bridgeFetch, serveRequest } from './remote-bridge.js';

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
