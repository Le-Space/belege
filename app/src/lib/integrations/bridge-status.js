// "Welche Bridge antwortet?" (Integrationen → Bridge): one line each for the
// bridge on this computer, the hosted one on Aleph and the one on Phala over
// NEAR – whether it runs, whether it is unlocked (attested from this browser
// or by the contract), and which of them answers this device right now.
// Decided here from what the cards already know; nothing is asked anew.

/**
 * @typedef {'ok' | 'warn' | 'idle' | 'err'} Kind
 * @typedef {{ id: 'local' | 'aleph' | 'near', kind: Kind, state: string, answers: boolean }} Row
 * @typedef {object} StatusFacts
 * @property {{ state: string, route?: string, paired: boolean, peerId?: string | null }} local
 *   the bridge as this device reaches it (bridge-state)
 * @property {{ vm?: any, kept?: any, startHint?: 'starting' | 'nodeStuck' | 'noRelay' | null, notUp?: boolean }} [aleph]
 *   the VM the books started and the one unlocked last; what the unlocked VM says about its own
 *   start (hosted-start.js `hostedStartHint`), and whether it never came up (`hostedNotUp`)
 * @property {{ running: boolean, pending?: string | null, peerId?: string | null } | null} [near]
 */

/**
 * @param {StatusFacts} f
 * @returns {Row[]}
 */
export function bridgeStatusRows(f) {
	const { local } = f;
	const vm = f.aleph?.vm ?? null;
	const kept = f.aleph?.kept ?? null;
	const near = f.near ?? null;

	const alephRunning = Boolean(vm && !vm.stoppedAt);
	const alephUnlocked = Boolean(kept && (!vm || (alephRunning && kept.instance === vm.instance)));
	const nearRunning = Boolean(near?.running);

	// Whose node the books' bridge is: a hosted one's peer id, else the computer's.
	const peer = local.peerId ?? null;
	const paired = /** @type {'aleph' | 'near' | 'local' | null} */ (
		peer && alephUnlocked && peer === kept.peerId
			? 'aleph'
			: peer && nearRunning && peer === near?.peerId
				? 'near'
				: local.paired
					? 'local'
					: null
	);
	const online = local.state === 'online';
	// Over HTTP or through an own device it is the computer's, whatever node is paired.
	const answering = !online ? null : local.route === 'stream' ? (paired ?? 'local') : 'local';
	const silent = local.state === 'offline';

	/** @type {Row} */
	const localRow =
		answering === 'local'
			? {
					id: 'local',
					kind: 'ok',
					state: local.route === 'device' ? 'viaDevice' : 'answers',
					answers: true
				}
			: paired === 'local' && silent
				? { id: 'local', kind: 'err', state: 'silent', answers: false }
				: { id: 'local', kind: 'idle', state: 'none', answers: false };

	/** @type {Row} */
	const alephRow = alephUnlocked
		? answering === 'aleph'
			? { id: 'aleph', kind: 'ok', state: 'answers', answers: true }
			: // Unlocked is not up: the VM says its bridge is still starting, or it never came.
				f.aleph?.startHint === 'starting'
				? { id: 'aleph', kind: 'warn', state: 'starting', answers: false }
				: f.aleph?.startHint || f.aleph?.notUp
					? { id: 'aleph', kind: 'err', state: 'notUp', answers: false }
					: paired === 'aleph' && silent
						? { id: 'aleph', kind: 'err', state: 'silent', answers: false }
						: { id: 'aleph', kind: 'ok', state: 'unlocked', answers: false }
		: alephRunning
			? { id: 'aleph', kind: 'warn', state: 'locked', answers: false }
			: { id: 'aleph', kind: 'idle', state: vm ? 'stopped' : 'none', answers: false };

	/** @type {Row} */
	const nearRow = nearRunning
		? answering === 'near'
			? { id: 'near', kind: 'ok', state: 'answers', answers: true }
			: paired === 'near' && silent
				? { id: 'near', kind: 'err', state: 'silent', answers: false }
				: { id: 'near', kind: 'ok', state: 'unlocked', answers: false }
		: near?.pending
			? { id: 'near', kind: 'warn', state: 'pending', answers: false }
			: { id: 'near', kind: 'idle', state: 'none', answers: false };

	return [localRow, alephRow, nearRow];
}

/**
 * Which hosted bridge the books' bridge is, by its node's peer id: the VM on
 * Aleph or the one on Phala that was unlocked last, else none (the bridge on
 * a computer, or no bridge). What the app asks over the stream goes to it.
 *
 * @param {string | null | undefined} peerId the books' bridge (settings `bridge.peerId`)
 * @param {{ aleph?: string | null, near?: string | null } | null | undefined} peers the hosted bridges' peer ids
 * @returns {'aleph' | 'near' | null}
 */
export function hostedBridgeOf(peerId, peers) {
	if (!peerId) return null;
	if (peers?.aleph && peerId === peers.aleph) return 'aleph';
	if (peers?.near && peerId === peers.near) return 'near';
	return null;
}

/**
 * A hosted VM runs right now: what is kept for it reaches it only at its
 * next start.
 *
 * @param {{ aleph?: { vm?: any } | null, near?: { running: boolean } | null }} f
 */
export function hostedVmRunning(f) {
	const vm = f.aleph?.vm ?? null;
	return Boolean(vm && !vm.stoppedAt) || Boolean(f.near?.running);
}

/**
 * Which bridge the books expect to answer, for a page that has to say why
 * none does: a hosted one when it is the books' bridge, or when the books
 * started a VM on Aleph and no other bridge is paired; else the one on a
 * computer, if one is paired; else none.
 *
 * @param {{ peerId?: string | null, paired: boolean, peers?: { aleph?: string | null, near?: string | null } | null, alephVm?: any }} f
 * @returns {'aleph' | 'near' | 'local' | null}
 */
export function expectedBridge(f) {
	const hosted = hostedBridgeOf(f.peerId, f.peers);
	if (hosted) return hosted;
	if (f.paired) return 'local';
	return f.alephVm ? 'aleph' : null;
}

/**
 * The model's enclave as the bridge itself reports it attested (`/llm/status`):
 * a model set up, a pin, a check that held and no failure since. A setting
 * that is only kept, or a pin not yet checked, is not this.
 *
 * @param {any} status what `/llm/status` answered
 * @returns {{ model: string, verifiedAt: string } | null}
 */
export function llmAttested(status) {
	const tee = status?.tee;
	if (!status?.configured || !tee || tee.error) return null;
	if (typeof tee.verifiedAt !== 'string' || Number.isNaN(Date.parse(tee.verifiedAt))) return null;
	return { model: String(status.models?.primary ?? ''), verifiedAt: tee.verifiedAt };
}

/** How long a VM may take after the unlock before the card says it did not come up. */
export const NOT_UP_AFTER_MS = 3 * 60_000;

/**
 * The VM was unlocked from here, but its bridge's node has not reached this
 * device since: most often the image's passphrase was wrong. Aleph's agent
 * takes the passphrase with the secrets and confirms both, but the disk stays
 * closed, so nothing in the VM starts (no Caddy, no bridge, no node).
 *
 * @param {object} f
 * @param {any} f.kept the VM unlocked last (hostedBridgeRecord)
 * @param {any} f.vm the VM the books started (hostedVmRecord), or none
 * @param {boolean} f.reached its node was connected to this device since the unlock
 * @param {number} f.now
 * @param {number} [f.afterMs]
 */
export function hostedNotUp({ kept, vm, reached, now, afterMs = NOT_UP_AFTER_MS }) {
	if (!kept?.instance || reached) return false;
	if (vm && (vm.stoppedAt || vm.instance !== kept.instance)) return false;
	const at = Date.parse(kept.attestedAt ?? '');
	return Number.isFinite(at) && now - at >= afterMs;
}
