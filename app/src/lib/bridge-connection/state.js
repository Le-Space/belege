// The bridge connection as one state (#844): which bridge the books expect,
// which way reaches it now, and – when none does – why. Decided here from
// facts the session, the cards and the VM already have; nothing is asked
// anew, and nothing here dials. One reason, one sentence: the page that has
// to say why no bridge answers picks its text by `reason`.

import { expectedBridge, hostedNotUp } from '$lib/integrations/bridge-status.js';
import { hostedStartHint } from '$lib/integrations/hosted-start.js';

/** How long a paired node may take to be dialled and proved before it counts as not reachable. */
export const NODE_DIAL_MS = 45_000;

/**
 * @typedef {'computer' | 'aleph' | 'near' | null} Expected which bridge the books expect to answer
 * @typedef {'http' | 'stream-loopback' | 'stream-sync' | 'device' | null} Route
 *   `http`: on this computer over HTTP; `stream-loopback`: its node on this
 *   computer, device sync off; `stream-sync`: its node as a device of the
 *   books, over device sync's node; `device`: through an own device's bridge
 * @typedef {'not-paired' | 'starting' | 'reachable' | 'not-reachable'} State
 * @typedef {'transport' | 'vm-boot' | 'node-dial'} StartingReason
 * @typedef {'network-paused' | 'computer-silent' | 'origin-refused' | 'node-unreachable'
 *   | 'other-books' | 'unpaired-there' | 'device-offline' | 'vm-stopped' | 'vm-locked'
 *   | 'vm-not-up'} SilentReason
 * @typedef {{ expected: Expected, route: Route, state: State, reason: StartingReason | SilentReason | null }} Connection
 */

/**
 * @typedef {object} ConnectionFacts
 * @property {{ token?: boolean, peerId?: string | null, nodePairedAt?: string | null }} [record]
 *   the saved pairing (settings `bridge`): whether it holds a token, and the bridge's node
 * @property {{ aleph?: string | null, near?: string | null }} [peers] the hosted bridges' nodes, as the books keep them
 * @property {{ vm?: any, kept?: any, start?: import('$lib/integrations/hosted-start.js').StartStatus | null, reached?: boolean }} [aleph]
 *   the VM the books started, the one unlocked last, what it says about its
 *   own start, and whether its node reached this device since the unlock
 * @property {{ running: boolean, pending?: string | null }} [near] the bridge on Phala, as the contract has it
 * @property {'unknown' | 'checking' | 'online' | 'offline'} [health] what `/health` over HTTP said last
 * @property {boolean} [originRefused] the bridge runs, but does not let this page in
 * @property {{ enabled?: boolean, armed?: boolean, peerId?: string | null } | null} [node]
 *   the bridge's own node, as `/health` on this computer names it
 * @property {boolean} [streamUp] the bridge's node is connected and proved right now
 * @property {boolean} [deviceSync] device sync is on: the stream goes over its node
 * @property {boolean} [deviceUp] an own device that shares its bridge is connected
 * @property {boolean} [usesDevice] this device's last answer came through an own device's bridge
 * @property {boolean} [held] the session is setting the transport up (after an unlock)
 * @property {boolean} [paused] the network is switched off here
 * @property {number | null} [nodeAwaitedSince] since when the node is waited for (ms); null: not waited for
 * @property {number} now
 */

/** @type {(route: Route) => Pick<Connection, 'route' | 'state' | 'reason'>} */
const reachable = (route) => ({ route, state: 'reachable', reason: null });
/** @type {(reason: StartingReason) => Pick<Connection, 'route' | 'state' | 'reason'>} */
const starting = (reason) => ({ route: null, state: 'starting', reason });
/** @type {(reason: SilentReason) => Pick<Connection, 'route' | 'state' | 'reason'>} */
const silent = (reason) => ({ route: null, state: 'not-reachable', reason });

/**
 * A paired node that is not connected: still on its way for a while, then
 * not reachable.
 *
 * @param {ConnectionFacts} f
 */
const awaitedNode = (f) =>
	typeof f.nodeAwaitedSince === 'number' && f.now - f.nodeAwaitedSince < NODE_DIAL_MS
		? starting('node-dial')
		: silent('node-unreachable');

/** @param {ConnectionFacts} f */
function computer(f) {
	const record = f.record ?? {};
	const node = f.node ?? null;
	if (f.streamUp) return reachable(f.deviceSync ? 'stream-sync' : 'stream-loopback');
	if (f.held) return starting('transport');
	if (f.health === 'online') {
		// A bridge without a node of its own answers its functions over HTTP, by the token.
		if (!node?.enabled) return record.token ? reachable('http') : silent('node-unreachable');
		// A node paired, but not with these books: theirs is not ours to call.
		if (node.armed && node.peerId !== record.peerId) return silent('other-books');
		// Paired by these books before and unarmed now: unpaired on its own machine.
		if (!node.armed && record.nodePairedAt) return silent('unpaired-there');
		return awaitedNode(f);
	}
	if (f.deviceUp) return reachable('device');
	if (f.health === 'unknown' || f.health === 'checking' || f.health === undefined) {
		return starting('transport');
	}
	if (f.originRefused) return silent('origin-refused');
	// The bridge is another machine's, and that machine is not connected.
	if (f.usesDevice || (!record.token && record.peerId && f.deviceSync)) {
		return silent('device-offline');
	}
	return silent('computer-silent');
}

/** @param {ConnectionFacts} f */
function aleph(f) {
	const vm = f.aleph?.vm ?? null;
	const kept = f.aleph?.kept ?? null;
	// Its node proved on this connection: it answers, whatever the records say
	// (a page may not have read them yet).
	if (f.streamUp) return reachable('stream-sync');
	// An own desktop shares its bridge and answered for this device (#142).
	if (f.deviceUp) return reachable('device');
	if (vm?.stoppedAt) return silent('vm-stopped');
	if (!kept || (vm && kept.instance !== vm.instance))
		return silent(vm ? 'vm-locked' : 'vm-stopped');
	// What the VM says about its own start outranks this device's clock.
	const hint = hostedStartHint(f.aleph?.start ?? null);
	if (hint === 'starting') return starting('vm-boot');
	if (hint) return silent('vm-not-up');
	if (hostedNotUp({ kept, vm, reached: Boolean(f.aleph?.reached), now: f.now })) {
		return silent('vm-not-up');
	}
	// It was here since the unlock and is gone: its node, not its start.
	if (f.aleph?.reached) return awaitedNode(f);
	return starting('vm-boot');
}

/** @param {ConnectionFacts} f */
function near(f) {
	// As on Aleph: a proved node answers, before the contract was asked.
	if (f.streamUp) return reachable('stream-sync');
	if (f.deviceUp) return reachable('device');
	if (!f.near?.running) return f.near?.pending ? starting('vm-boot') : silent('vm-stopped');
	return awaitedNode(f);
}

/**
 * The bridge connection, from what is known right now.
 *
 * @param {ConnectionFacts} f
 * @returns {Connection}
 */
export function connectionOf(f) {
	const record = f.record ?? {};
	const which = expectedBridge({
		peerId: record.peerId ?? null,
		paired: Boolean(record.token || record.peerId),
		peers: f.peers ?? null,
		alephVm: f.aleph?.vm ?? null
	});
	/** @type {Expected} */
	const expected = which === 'local' ? 'computer' : which;
	if (!expected) return { expected, route: null, state: 'not-paired', reason: null };
	// A hosted bridge is reached over the network only; the one on this computer
	// keeps answering over HTTP, where a bridge still serves its functions there.
	if (f.paused && !(expected === 'computer' && f.health === 'online' && !f.node?.enabled)) {
		return { expected, ...silent('network-paused') };
	}
	const rest = expected === 'aleph' ? aleph(f) : expected === 'near' ? near(f) : computer(f);
	return { expected, ...rest };
}
