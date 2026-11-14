// What the hosted bridges' cards last read (HostedBridgeCard, NearBridgeCard),
// shared with the status block above them (BridgeStatus.svelte) so a start,
// an unlock or a stop on a card shows there at once.
import { hostedBridgeRecord, hostedVmRecord } from '$lib/session.svelte.js';

export const hosted = $state({
	/** @type {{ vm: any, kept: any }} */
	aleph: { vm: null, kept: null },
	/** @type {{ running: boolean, pending: string | null, peerId: string | null, attestedAt: string | null } | null} */
	near: null
});

/**
 * @param {any} kept the VM unlocked last (hostedBridgeRecord)
 * @param {any} vm the VM the books started (hostedVmRecord)
 */
export function noteAleph(kept, vm) {
	hosted.aleph = { kept, vm };
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
}
