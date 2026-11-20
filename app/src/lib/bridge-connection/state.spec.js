import { describe, expect, it } from 'vitest';
import { NODE_DIAL_MS, connectionOf } from './state.js';
import { NOT_UP_AFTER_MS } from '$lib/integrations/bridge-status.js';
import { STUCK_AFTER_S } from '$lib/integrations/hosted-start.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const NODE = '12D3KooWnode';
const VM_NODE = '12D3KooWvm';
const ago = (/** @type {number} */ ms) => new Date(NOW - ms).toISOString();

/** @param {import('./state.js').Connection} c */
const said = (c) =>
	[c.expected ?? 'none', c.state, c.reason ?? c.route].filter((x) => x !== null).join(':');
/** @param {Omit<import('./state.js').ConnectionFacts, 'now'>} f */
const of = (f) => said(connectionOf({ now: NOW, ...f }));

/** A bridge on a computer, paired by code, whose node these books paired. */
const paired = { token: true, peerId: NODE, nodePairedAt: ago(86_400_000) };
const armed = { enabled: true, armed: true, peerId: NODE };

/** A VM on Aleph the books started and unlocked a minute ago, as their bridge. */
const hosted = {
	record: { peerId: VM_NODE },
	peers: { aleph: VM_NODE },
	aleph: {
		vm: { instance: HASH },
		kept: { instance: HASH, peerId: VM_NODE, attestedAt: ago(60_000) }
	},
	deviceSync: true
};
/**
 * @param {Partial<import('$lib/integrations/hosted-start.js').StartStatus>} s
 * @returns {import('$lib/integrations/hosted-start.js').StartStatus}
 */
const start = (s) => ({
	phase: 'starting',
	peerId: null,
	relayed: false,
	at: 1000,
	timeline: {},
	...s
});

describe('connectionOf', () => {
	it('no bridge paired, no VM started: not paired', () => {
		expect(of({})).toBe('none:not-paired');
		expect(of({ health: 'online', node: armed })).toBe('none:not-paired');
	});

	describe('the bridge on a computer', () => {
		it('its node proved on this machine, device sync off: over the loopback stream', () => {
			expect(of({ record: paired, health: 'online', node: armed, streamUp: true })).toBe(
				'computer:reachable:stream-loopback'
			);
		});

		it('its node proved with device sync on: over device sync’s node', () => {
			expect(of({ record: paired, streamUp: true, deviceSync: true, health: 'offline' })).toBe(
				'computer:reachable:stream-sync'
			);
		});

		it('a bridge without a node of its own answers over HTTP, by the token', () => {
			expect(of({ record: { token: true }, health: 'online', node: null })).toBe(
				'computer:reachable:http'
			);
		});

		it('through an own device’s bridge, when none answers here', () => {
			expect(of({ record: paired, health: 'offline', deviceSync: true, deviceUp: true })).toBe(
				'computer:reachable:device'
			);
		});

		it('the transport is being set up after an unlock: starting', () => {
			expect(of({ record: paired, held: true, health: 'online', node: armed })).toBe(
				'computer:starting:transport'
			);
			expect(of({ record: paired })).toBe('computer:starting:transport');
			expect(of({ record: paired, health: 'checking' })).toBe('computer:starting:transport');
		});

		it('its status answers, its node is still being dialled: starting', () => {
			expect(
				of({ record: paired, health: 'online', node: armed, nodeAwaitedSince: NOW - 5000 })
			).toBe('computer:starting:node-dial');
		});

		it('its status answers, its node never came: not reachable, and not "is it running"', () => {
			expect(
				of({ record: paired, health: 'online', node: armed, nodeAwaitedSince: NOW - NODE_DIAL_MS })
			).toBe('computer:not-reachable:node-unreachable');
			expect(of({ record: paired, health: 'online', node: armed })).toBe(
				'computer:not-reachable:node-unreachable'
			);
		});

		it('a node on this machine paired with other books', () => {
			expect(
				of({
					record: paired,
					health: 'online',
					node: { enabled: true, armed: true, peerId: '12D3KooWother' }
				})
			).toBe('computer:not-reachable:other-books');
		});

		it('paired by these books before, unarmed now: unpaired on its own machine', () => {
			expect(
				of({
					record: paired,
					health: 'online',
					node: { enabled: true, armed: false, peerId: NODE }
				})
			).toBe('computer:not-reachable:unpaired-there');
		});

		it('paired by code, its node never paired and unarmed: waited for, not "unpaired"', () => {
			expect(
				of({
					record: { token: true },
					health: 'online',
					node: { enabled: true, armed: false, peerId: NODE },
					nodeAwaitedSince: NOW - 1000
				})
			).toBe('computer:starting:node-dial');
		});

		it('nothing answers here: is it running', () => {
			expect(of({ record: paired, health: 'offline' })).toBe(
				'computer:not-reachable:computer-silent'
			);
		});

		it('it runs, but does not let this page in', () => {
			expect(of({ record: paired, health: 'offline', originRefused: true })).toBe(
				'computer:not-reachable:origin-refused'
			);
		});

		it('the bridge is another machine’s, and that machine is not connected', () => {
			expect(of({ record: { peerId: NODE }, health: 'offline', deviceSync: true })).toBe(
				'computer:not-reachable:device-offline'
			);
			expect(of({ record: paired, health: 'offline', usesDevice: true })).toBe(
				'computer:not-reachable:device-offline'
			);
		});

		it('the network is switched off here', () => {
			expect(of({ record: paired, health: 'online', node: armed, paused: true })).toBe(
				'computer:not-reachable:network-paused'
			);
		});

		it('paused, a bridge without a node still answers over HTTP on this machine', () => {
			expect(of({ record: { token: true }, health: 'online', paused: true })).toBe(
				'computer:reachable:http'
			);
		});
	});

	describe('the hosted bridge on Aleph', () => {
		it('its node proved: over device sync’s node', () => {
			expect(of({ ...hosted, streamUp: true })).toBe('aleph:reachable:stream-sync');
		});

		it('its node proved before this page read the records: it answers all the same', () => {
			expect(of({ ...hosted, aleph: { vm: null, kept: null }, streamUp: true })).toBe(
				'aleph:reachable:stream-sync'
			);
		});

		it('an own desktop’s bridge answered for this device', () => {
			expect(of({ ...hosted, deviceUp: true })).toBe('aleph:reachable:device');
		});

		it('never "is pnpm bridge running", whatever HTTP on this machine says', () => {
			expect(of({ ...hosted, health: 'offline' })).toBe('aleph:starting:vm-boot');
			expect(of({ ...hosted, health: 'online', node: armed })).toBe('aleph:starting:vm-boot');
		});

		it('a VM the books started and no other bridge paired: expected, and locked', () => {
			expect(of({ aleph: { vm: { instance: HASH }, kept: null } })).toBe(
				'aleph:not-reachable:vm-locked'
			);
		});

		it('a new VM while the kept unlock is another one’s: locked', () => {
			expect(of({ ...hosted, aleph: { vm: { instance: OTHER }, kept: hosted.aleph.kept } })).toBe(
				'aleph:not-reachable:vm-locked'
			);
		});

		it('stopped', () => {
			expect(
				of({
					...hosted,
					aleph: { vm: { instance: HASH, stoppedAt: ago(1000) }, kept: hosted.aleph.kept }
				})
			).toBe('aleph:not-reachable:vm-stopped');
		});

		it('the VM says its bridge is still starting: starting, however long ago the unlock was', () => {
			const kept = { ...hosted.aleph.kept, attestedAt: ago(NOT_UP_AFTER_MS * 2) };
			expect(
				of({
					...hosted,
					aleph: { ...hosted.aleph, kept, start: start({ timeline: { unlocked: 990 } }) }
				})
			).toBe('aleph:starting:vm-boot');
		});

		it('the VM says its node has not started for minutes: it did not come up', () => {
			expect(
				of({
					...hosted,
					aleph: {
						...hosted.aleph,
						start: start({ timeline: { bridge: 1000 - STUCK_AFTER_S } })
					}
				})
			).toBe('aleph:not-reachable:vm-not-up');
		});

		it('the VM says nothing, and its node never reached this device for minutes', () => {
			const kept = { ...hosted.aleph.kept, attestedAt: ago(NOT_UP_AFTER_MS) };
			expect(of({ ...hosted, aleph: { ...hosted.aleph, kept } })).toBe(
				'aleph:not-reachable:vm-not-up'
			);
		});

		it('its node was here since the unlock and is gone: its node, not its start', () => {
			const kept = { ...hosted.aleph.kept, attestedAt: ago(NOT_UP_AFTER_MS * 2) };
			const here = { ...hosted, aleph: { ...hosted.aleph, kept, reached: true } };
			expect(of({ ...here, nodeAwaitedSince: NOW - 1000 })).toBe('aleph:starting:node-dial');
			expect(of(here)).toBe('aleph:not-reachable:node-unreachable');
		});

		it('the network is switched off here', () => {
			expect(of({ ...hosted, paused: true })).toBe('aleph:not-reachable:network-paused');
		});
	});

	describe('the hosted bridge on Phala', () => {
		const near = { record: { peerId: VM_NODE }, peers: { near: VM_NODE }, deviceSync: true };

		it('running and proved', () => {
			expect(of({ ...near, near: { running: true }, streamUp: true })).toBe(
				'near:reachable:stream-sync'
			);
		});

		it('proved before the contract was asked: it answers all the same', () => {
			expect(of({ ...near, streamUp: true })).toBe('near:reachable:stream-sync');
		});

		it('an own desktop’s bridge answered for this device', () => {
			expect(of({ ...near, near: { running: true }, deviceUp: true })).toBe(
				'near:reachable:device'
			);
		});

		it('a start asked of the contract and not answered yet: starting', () => {
			expect(of({ ...near, near: { running: false, pending: 'start' } })).toBe(
				'near:starting:vm-boot'
			);
		});

		it('not running', () => {
			expect(of({ ...near, near: { running: false } })).toBe('near:not-reachable:vm-stopped');
			expect(of(near)).toBe('near:not-reachable:vm-stopped');
		});

		it('running, its node dialled, then not reachable', () => {
			expect(of({ ...near, near: { running: true }, nodeAwaitedSince: NOW - 1000 })).toBe(
				'near:starting:node-dial'
			);
			expect(of({ ...near, near: { running: true } })).toBe('near:not-reachable:node-unreachable');
		});
	});
});
