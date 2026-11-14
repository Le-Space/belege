// What the hosted bridges' cards last read (HostedBridgeCard, NearBridgeCard),
// shared with the status block above them (BridgeStatus.svelte) so a start,
// an unlock or a stop on a card shows there at once.
import { app, hostedBridgeRecord, hostedVmRecord, nearHostedRecord } from '$lib/session.svelte.js';
import { bridge } from './bridge-state.svelte.js';
import { hostedBridgeOf } from './bridge-status.js';

export const hosted = $state({
	/** @type {{ vm: any, kept: any }} */
	aleph: { vm: null, kept: null },
	/** @type {{ running: boolean, pending: string | null, peerId: string | null, attestedAt: string | null } | null} */
	near: null,
	/** @type {{ aleph: string | null, near: string | null }} the hosted bridges' nodes, as the books keep them */
	peers: { aleph: null, near: null }
});

/**
 * @param {any} kept the VM unlocked last (hostedBridgeRecord)
 * @param {any} vm the VM the books started (hostedVmRecord)
 */
export function noteAleph(kept, vm) {
	hosted.aleph = { kept, vm };
	hosted.peers.aleph = kept?.peerId ?? null;
}

/** Read the Aleph records from the sealed settings (no network). */
export async function loadAleph() {
	const [kept, vm] = await Promise.all([hostedBridgeRecord(), hostedVmRecord()]);
	noteAleph(kept, vm);
}

/** @param {{ contract: any, kept: any } | null} status what nearBridgeStatus answered */
export function noteNear(status) {
	hosted.near = status
		? {
				running: Boolean(status.contract?.bridge?.valid),
				pending: status.contract?.request?.kind ?? null,
				peerId: status.kept?.peerId ?? null,
				attestedAt: status.kept?.attestedAt ?? null
			}
		: null;
	if (status) hosted.peers.near = status.kept?.peerId ?? null;
}

/** Read the hosted bridges' peer ids from the sealed settings (no network). */
export async function loadHostedPeers() {
	const [kept, near] = await Promise.all([hostedBridgeRecord(), nearHostedRecord()]);
	hosted.peers = { aleph: kept?.peerId ?? null, near: near?.peerId ?? null };
}

/** The books' bridge is a hosted one: what is asked over the stream goes to the VM. */
export const booksBridgeHosted = () => hostedBridgeOf(bridge.peerId, hosted.peers);

/** A hosted bridge answers this device right now (over the stream, never over HTTP). */
export const hostedBridgeAnswers = () =>
	bridge.state === 'online' && app.sync.bridgeRoute === 'stream' ? booksBridgeHosted() : null;
