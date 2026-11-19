// How far the start of the hosted bridge's VM is, as the VM itself says it:
// `https://<its 2n6.me name>/bridge/status.json` (bridge/rootfs/files/
// belege-bridge-status), a public file without secrets. Read only for a VM
// the books unlocked whose bridge does not answer, so the card can say "its
// bridge is still starting" or "its node does not start" instead of asking
// for a bridge on this computer. The host is the VM's own, named in the
// consent text for the hosted bridge.

import { twoN6Host } from '$lib/ucep/net.js';

/** After this long without the next step the card says the start is stuck. */
export const STUCK_AFTER_S = 3 * 60;

/**
 * @typedef {object} StartStatus
 * @property {'starting' | 'ready'} phase
 * @property {string | null} peerId the bridge's node, once it started
 * @property {boolean} relayed a relay holds a reservation for the node
 * @property {number} at the VM's clock when it wrote the file (seconds)
 * @property {{ unlocked?: number, bridge?: number, node?: number, relay?: number }} timeline
 *   when the VM first saw each step (seconds, its clock)
 */

/** @param {unknown} v */
const seconds = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * What the VM answered, reduced to what the card uses; `null` for anything
 * that is not this file. It is data from outside: nothing of it is shown as
 * text, and nothing of it decides more than which sentence the card says.
 *
 * @param {unknown} raw
 * @returns {StartStatus | null}
 */
export function parseStartStatus(raw) {
	const o = /** @type {any} */ (raw);
	if (!o || typeof o !== 'object' || o.v !== 1) return null;
	if (o.phase !== 'starting' && o.phase !== 'ready') return null;
	const at = seconds(o.at);
	if (!at) return null;
	const peerId = typeof o.node?.peerId === 'string' && o.node.peerId ? o.node.peerId : null;
	const t = o.timeline && typeof o.timeline === 'object' ? o.timeline : {};
	return {
		phase: o.phase,
		peerId,
		relayed: o.node?.relayed === true,
		at,
		timeline: {
			unlocked: seconds(t.unlocked),
			bridge: seconds(t.bridge),
			node: seconds(t.node),
			relay: seconds(t.relay)
		}
	};
}

/**
 * Which sentence fits a hosted bridge that does not answer, by the VM's own
 * clock (so this device's clock does not matter):
 *
 * - `starting`   the disk is open, the bridge or its node is not up yet
 * - `nodeStuck`  the bridge runs, its node has not started for minutes
 * - `noRelay`    the node runs, no relay has held a reservation for minutes
 * - `null`       the VM says it is ready and reachable: nothing to add
 *
 * @param {StartStatus | null} status
 * @param {number} [stuckAfter] seconds
 * @returns {'starting' | 'nodeStuck' | 'noRelay' | null}
 */
export function hostedStartHint(status, stuckAfter = STUCK_AFTER_S) {
	if (!status) return null;
	const { timeline, at } = status;
	if (!status.peerId) {
		const since = timeline.bridge ?? timeline.unlocked;
		return since && at - since >= stuckAfter ? 'nodeStuck' : 'starting';
	}
	if (status.relayed) return null;
	return timeline.node && at - timeline.node >= stuckAfter ? 'noRelay' : 'starting';
}

/**
 * Reads the status of the VM with this INSTANCE hash. `null` when the VM
 * does not serve it: not unlocked, its disk not open, an image from before
 * the file existed, or no network.
 *
 * @param {string} instance the INSTANCE's item hash
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [opts]
 * @returns {Promise<StartStatus | null>}
 */
export async function fetchStartStatus(instance, opts = {}) {
	if (!/^[0-9a-f]{64}$/.test(instance)) return null;
	// An E2E build's VMs are the tests' own and have no name at 2n6.me: ask nobody.
	if (import.meta.env.VITE_E2E === 'true' && !opts.fetch) return null;
	const doFetch = opts.fetch ?? fetch;
	try {
		const res = await doFetch(`https://${twoN6Host(instance)}/bridge/status.json`, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: opts.signal ?? AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const text = await res.text();
		if (text.length > 16_384) return null;
		return parseStartStatus(JSON.parse(text));
	} catch {
		return null;
	}
}
