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
 * @property {{ vm?: any, kept?: any }} [aleph] the VM the books started and the one unlocked last
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
