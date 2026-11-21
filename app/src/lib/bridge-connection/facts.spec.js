// The selectors on the connection state against the ones they replace (#844,
// B6): over every combination of what the app keeps, they answer the same –
// except where listed below, each with its reason.
import { describe, expect, it } from 'vitest';

import { expectedBridge, hostedBridgeOf } from '$lib/integrations/bridge-status.js';
import { factsFrom } from './facts.js';
import { connectionOf } from './state.js';

// Not imported from state.svelte.js: that module reads the app's state.
/** @param {import('./state.js').Connection} c */
const viaDevice = (c) => c.state === 'reachable' && c.route === 'device';
/** @param {import('./state.js').Connection} c */
const viaStream = (c) =>
	c.state === 'reachable' && (c.route === 'stream-sync' || c.route === 'stream-loopback');
/** @param {import('./state.js').Connection} c */
const hostedAnswers = (c) =>
	viaStream(c) && (c.expected === 'aleph' || c.expected === 'near') ? c.expected : null;
/** @param {import('./state.js').Connection} c */
const expected = (c) => (c.expected === 'computer' ? 'local' : c.expected);

/** The selectors as they were before the connection state (bridge-state, hosted-status). */
const before = (/** @type {import('./facts.js').KeptState} */ k) => {
	const online = k.bridge.state === 'online';
	return {
		viaDevice: online && k.route === 'device',
		viaStream: online && k.route === 'stream',
		hostedAnswers:
			online && k.route === 'stream' ? hostedBridgeOf(k.bridge.peerId, k.hosted.peers) : null,
		expected: expectedBridge({
			peerId: k.bridge.peerId,
			paired: Boolean(k.bridge.token || k.bridge.peerId),
			peers: k.hosted.peers,
			alephVm: k.hosted.aleph.vm
		})
	};
};

const after = (/** @type {import('./facts.js').KeptState} */ k) => {
	const c = connectionOf(factsFrom(k));
	return {
		viaDevice: viaDevice(c),
		viaStream: viaStream(c),
		hostedAnswers: hostedAnswers(c),
		expected: expected(c)
	};
};

const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const ALEPH = '12D3KooWaleph';
const NEAR = '12D3KooWnear';
const kept = { instance: 'a'.repeat(64), peerId: ALEPH, attestedAt: '2026-01-01T11:59:00.000Z' };

/** Every combination of what the app keeps about its bridge. */
function* everything() {
	for (const state of /** @type {const} */ (['unknown', 'checking', 'online', 'offline']))
		for (const route of /** @type {const} */ (['local', 'stream', 'device']))
			for (const token of [null, 'made-up-token'])
				for (const peerId of [null, '12D3KooWcomputer', ALEPH, NEAR])
					for (const peers of [
						{ aleph: null, near: null },
						{ aleph: ALEPH, near: null },
						{ aleph: null, near: NEAR },
						{ aleph: ALEPH, near: NEAR }
					])
						for (const aleph of [
							{ vm: null, kept: null },
							{ vm: null, kept },
							{ vm: { instance: kept.instance }, kept },
							{ vm: { instance: kept.instance }, kept: null },
							{ vm: { instance: 'b'.repeat(64) }, kept },
							{ vm: { instance: kept.instance, stoppedAt: '2026-01-01T11:00:00.000Z' }, kept }
						])
							for (const near of [
								null,
								{ running: true, pending: null },
								{ running: false, pending: 'start' },
								{ running: false, pending: null }
							])
								yield /** @type {import('./facts.js').KeptState} */ ({
									bridge: { state, token, peerId },
									route,
									hosted: { aleph, near, peers },
									now: NOW
								});
}

describe('the selectors on the connection state', () => {
	it('answer as the ones before them, over everything the app can keep', () => {
		let seen = 0;
		/** @type {string[]} */
		const differences = [];
		for (const k of everything()) {
			seen++;
			const was = before(k);
			const is = after(k);
			for (const name of /** @type {const} */ ([
				'viaDevice',
				'viaStream',
				'hostedAnswers',
				'expected'
			])) {
				if (was[name] === is[name]) continue;
				// 1. Nothing paired and no VM started, yet a status came over the stream
				//    or a device: the state says "not paired". No books get there – a
				//    stream needs the bridge's node in the books, a device its token.
				if (is.expected === null && (name === 'viaStream' || name === 'viaDevice')) continue;
				// 2. No bridge's node in the books, a VM started on Aleph, and a status
				//    that came over the stream: the state takes the VM's bridge to be
				//    the one that answered. Without a node in the books there is no
				//    stream, so no books get there either.
				if (name === 'hostedAnswers' && k.bridge.peerId === null && k.route === 'stream') continue;
				differences.push(`${name}: ${was[name]} → ${is[name]} for ${JSON.stringify(k)}`);
			}
		}
		expect(seen).toBe(4 * 3 * 2 * 4 * 4 * 6 * 4);
		expect(differences.slice(0, 5)).toEqual([]);
	});

	it('which bridge is expected never differs', () => {
		for (const k of everything()) expect(after(k).expected).toBe(before(k).expected);
	});

	it('the listed differences exist: none is listed for nothing', () => {
		const all = [...everything()];
		const unpaired = all.filter((k) => before(k).viaStream && !after(k).viaStream);
		expect(unpaired.length).toBeGreaterThan(0);
		for (const k of unpaired) expect(after(k).expected).toBeNull();
		const vmOnly = all.filter((k) => before(k).hostedAnswers !== after(k).hostedAnswers);
		expect(vmOnly.length).toBeGreaterThan(0);
		for (const k of vmOnly) expect(k.bridge.peerId).toBeNull();
	});
});
