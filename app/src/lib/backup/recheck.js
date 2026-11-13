// Aleph answers a STORE `pending` first and decides later. After a run that
// left a backup pending, the backup card asks Aleph again a few times – the
// same question as on opening the card (keeper.js storeAnswer, the storage
// bridge's messageStatus) – so that "von Aleph aufbewahrt", or a refusal,
// shows without a reload. Then it stops: what is still pending by then is
// asked again when the card opens next, and before the next run.

import { storeAnswer } from './keeper.js';
import { loadBackups, updateBackup } from './history.js';

/** When to ask, in ms after the run ended: 15 s, 45 s, 2 min, 5 min – then stop. */
export const RECHECK_AFTER_MS = [15_000, 45_000, 120_000, 300_000];

/** The schedule, shorter in the end-to-end tests (only in a build for them). */
export const recheckSchedule = () => {
	if (import.meta.env?.VITE_E2E !== 'true') return RECHECK_AFTER_MS;
	const given = /** @type {any} */ (globalThis).__belegeBackupRecheckMs;
	return Array.isArray(given) && given.every((n) => Number.isFinite(n) && n >= 0)
		? given.map(Number)
		: RECHECK_AFTER_MS;
};

/**
 * Ask on a schedule until nothing is pending, the schedule ends, `stopped`
 * says so (the network paused) or the returned function is called (the card
 * left). One question at a time; a failed one counts as still pending.
 *
 * @param {object} params
 * @param {() => Promise<boolean>} params.ask asks once; true while something stays pending
 * @param {() => boolean} [params.stopped] checked before every question
 * @param {number[]} [params.after] ms after the start, ascending
 * @param {(fn: () => void, ms: number) => any} [params.setTimer]
 * @param {(timer: any) => void} [params.clearTimer]
 * @returns {() => void} stops it
 */
export function recheckPending({
	ask,
	stopped = () => false,
	after = RECHECK_AFTER_MS,
	setTimer = (fn, ms) => setTimeout(fn, ms),
	clearTimer = (timer) => clearTimeout(timer)
}) {
	let done = false;
	/** @type {any} */
	let timer = null;
	const stop = () => {
		done = true;
		if (timer !== null) clearTimer(timer);
		timer = null;
	};
	/** @param {number} i */
	const next = (i) => {
		if (done || i >= after.length) return stop();
		timer = setTimer(
			async () => {
				timer = null;
				if (done || stopped()) return stop();
				const still = await ask().catch(() => true);
				if (done) return;
				if (still) next(i + 1);
				else stop();
			},
			Math.max(0, after[i] - (i ? after[i - 1] : 0))
		);
	};
	next(0);
	return stop;
}

/**
 * Ask Aleph about every backup in the history it had not decided on, and
 * keep its answer there. Returns the history then.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {import('./keeper.js').AlephEndpoints} endpoints
 * @param {typeof storeAnswer} [answer]
 */
export async function settlePending(settings, endpoints, answer = storeAnswer) {
	let backups = await loadBackups(settings);
	for (const b of backups.filter((r) => r.status === 'pending' && r.itemHash)) {
		const now = await answer({ itemHash: String(b.itemHash), endpoints }).catch(() => null);
		if (now && now.status !== b.status) {
			backups = await updateBackup(settings, b, {
				status: now.status,
				...(now.errorCode !== undefined ? { errorCode: now.errorCode } : {})
			});
		}
	}
	return backups;
}

/** Aleph has not decided on one of them yet. @param {import('./history.js').BackupRecord[]} backups */
export const anyPending = (backups) => backups.some((b) => b.status === 'pending' && b.itemHash);
