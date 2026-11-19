import { describe, expect, it } from 'vitest';
import { twoN6Host } from '$lib/ucep/net.js';
import { fetchStartStatus, hostedStartHint, parseStartStatus } from './hosted-start.js';

const A = 'a'.repeat(64);
const T = 1_800_000_000;

/** @param {object} [over] */
const file = (over = {}) => ({
	v: 1,
	phase: 'starting',
	node: { peerId: null, armed: false, addrs: [], relayed: false },
	timeline: { unlocked: T },
	at: T + 10,
	...over
});

describe('parseStartStatus', () => {
	it('keeps the phase, the node and the timeline', () => {
		expect(parseStartStatus(file())).toEqual({
			phase: 'starting',
			peerId: null,
			relayed: false,
			at: T + 10,
			timeline: { unlocked: T, bridge: undefined, node: undefined, relay: undefined }
		});
	});

	it('refuses what is not this file', () => {
		for (const raw of [
			null,
			'x',
			[],
			{},
			file({ v: 2 }),
			file({ phase: 'done' }),
			file({ at: 'x' })
		])
			expect(parseStartStatus(raw)).toBeNull();
	});

	it('takes nothing but numbers and one string from it', () => {
		const s = parseStartStatus(
			file({ node: { peerId: 7, relayed: 'yes' }, timeline: { bridge: '<b>', node: -1 } })
		);
		expect(s?.peerId).toBeNull();
		expect(s?.relayed).toBe(false);
		expect(s?.timeline).toEqual({
			unlocked: undefined,
			bridge: undefined,
			node: undefined,
			relay: undefined
		});
	});
});

describe('hostedStartHint', () => {
	const hint = (/** @type {object} */ over) => hostedStartHint(parseStartStatus(file(over)));

	it('says nothing without a status', () => {
		expect(hostedStartHint(null)).toBeNull();
	});

	it('is starting right after the unlock', () => {
		expect(hint({})).toBe('starting');
		expect(hint({ timeline: { unlocked: T, bridge: T + 5 }, at: T + 60 })).toBe('starting');
	});

	it('names a node that does not start while the bridge runs', () => {
		expect(hint({ timeline: { unlocked: T, bridge: T + 5 }, at: T + 5 + 180 })).toBe('nodeStuck');
	});

	it('names a node no relay holds a reservation for', () => {
		const up = {
			phase: 'ready',
			node: { peerId: '12D3KooWExample', relayed: false },
			timeline: { unlocked: T, bridge: T + 5, node: T + 20 }
		};
		expect(hint({ ...up, at: T + 30 })).toBe('starting');
		expect(hint({ ...up, at: T + 20 + 180 })).toBe('noRelay');
	});

	it('adds nothing when the VM says it is ready and reachable', () => {
		expect(
			hint({
				phase: 'ready',
				node: { peerId: '12D3KooWExample', relayed: true },
				timeline: { unlocked: T, bridge: T + 5, node: T + 20, relay: T + 25 },
				at: T + 900
			})
		).toBeNull();
	});
});

describe('fetchStartStatus', () => {
	it("asks the VM's own name, without credentials or redirects", async () => {
		/** @type {any[]} */
		const calls = [];
		const status = await fetchStartStatus(A, {
			fetch: /** @type {any} */ (
				async (/** @type {string} */ url, /** @type {any} */ init) => {
					calls.push([url, init]);
					return new Response(JSON.stringify(file()));
				}
			)
		});
		expect(status?.phase).toBe('starting');
		expect(calls[0][0]).toBe(`https://${twoN6Host(A)}/bridge/status.json`);
		expect(calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
	});

	it('is null for no instance, no answer, or another answer', async () => {
		const never = /** @type {any} */ (
			async () => {
				throw new Error('must not be called');
			}
		);
		expect(await fetchStartStatus('not-a-hash', { fetch: never })).toBeNull();
		const fails = /** @type {any} */ (
			async () => {
				throw new TypeError('Failed to fetch');
			}
		);
		expect(await fetchStartStatus(A, { fetch: fails })).toBeNull();
		const html = /** @type {any} */ (async () => new Response('<html>'));
		expect(await fetchStartStatus(A, { fetch: html })).toBeNull();
		const gone = /** @type {any} */ (async () => new Response('{}', { status: 502 }));
		expect(await fetchStartStatus(A, { fetch: gone })).toBeNull();
	});
});
