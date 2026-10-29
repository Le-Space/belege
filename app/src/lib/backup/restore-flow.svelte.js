// "Wiederherstellen" (issue #77), as the backup card runs it: a backup fetched
// from Aleph's gateway by its CID and put back into these books
// (archive.js `restoreBackup`), with the increments that build on it (#454).
// Restoring merges: what is here stays, what the backup holds is added. The
// books are closed for it, so the page reloads at the end and the passkey
// opens them again. The state lives here so the card stays readable.

import { app, currentStore, restoreBackup } from '$lib/session.svelte.js';
import { t } from '$lib/i18n/index.js';
import { loadBackups } from './history.js';
import { findBackups } from './keeper.js';

export const restoreRun = $state({
	/** @type {string | null} the CID asked about, waiting for "Ja" */
	chosen: null,
	/** @type {'' | 'fetching' | 'restoring' | 'done'} */
	phase: '',
	/** @type {import('./archive.js').RestoreProgress | null} */
	progress: null,
	/** Increments fetched so far, while fetching them. */
	fetched: /** @type {{ done: number, total: number } | null} */ (null),
	/** @type {{ collection: string, joined: number }[]} what came back, per database */
	result: [],
	/** Increments restored with the full backup. */
	increments: 0,
	/** @type {string | null} */
	error: null
});

export const isCid = (/** @type {string} */ c) =>
	/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(c) || /^b[a-z2-7]{50,100}$/.test(c);

/** Ask "Dieses Backup wiederherstellen?" for `cid`; a string that is no CID is refused. @param {string} cid */
export function askRestore(cid) {
	restoreRun.error = null;
	const trimmed = String(cid ?? '').trim();
	if (!isCid(trimmed)) {
		restoreRun.chosen = null;
		restoreRun.error = t('restore.notACid');
		return false;
	}
	restoreRun.chosen = trimmed;
	return true;
}

export function cancelRestore() {
	restoreRun.chosen = null;
}

/** Whether a restore is under way, or nothing may start. */
export const restoreBusy = () => Boolean(restoreRun.phase) || app.network.paused;

/**
 * The increments of a full backup, asked for right before the restore: those
 * the caller lists, those Aleph lists by its CID now, those made here.
 *
 * @param {string} base
 * @param {{ known?: string[], owner?: string | null, endpoints: import('./keeper.js').AlephEndpoints }} params
 */
async function incrementsOf(base, { known = [], owner, endpoints }) {
	const cids = [...known];
	const store = currentStore();
	if (store) {
		for (const b of await loadBackups(store.settings)) {
			if (b.kind === 'increment' && b.base === base) cids.push(b.cid);
		}
	}
	if (owner) {
		for (const b of await findBackups({ owner, ref: base, endpoints }).catch(() => [])) {
			cids.push(b.cid);
		}
	}
	return cids.filter((cid, i) => cids.indexOf(cid) === i);
}

/**
 * Restore the chosen backup: fetch it and its increments from the gateway,
 * put them back, reload. Errors in words.
 *
 * @param {{ owner?: string | null, endpoints: import('./keeper.js').AlephEndpoints, known?: string[] }} params
 */
export async function runRestore({ owner, endpoints, known = [] }) {
	const cid = restoreRun.chosen;
	if (!cid) return;
	restoreRun.chosen = null;
	restoreRun.error = null;
	restoreRun.progress = null;
	try {
		restoreRun.phase = 'fetching';
		const { createAlephBackend } = await import('@le-space/orbitdb-storage-bridge/backends/aleph');
		const gateway = createAlephBackend({ gateways: endpoints.gateways });
		const sealed = await gateway.getBlob(cid);
		const wanted = await incrementsOf(cid, { known, owner, endpoints });
		/** @type {Uint8Array[]} */
		const increments = [];
		restoreRun.fetched = wanted.length ? { done: 0, total: wanted.length } : null;
		for (const inc of wanted) {
			increments.push(await gateway.getBlob(inc));
			restoreRun.fetched = { done: increments.length, total: wanted.length };
		}
		restoreRun.phase = 'restoring';
		// The same gateways the archive itself came from, offered as a second
		// source for a head the backup does not carry. Ten seconds, not sixty:
		// beside a restore that is otherwise done, this is a long shot.
		const { fetchFromGateways, RAW_BLOCK } = await import(
			'@le-space/orbitdb-storage-bridge/gateway-fetch'
		);
		const done = await restoreBackup(sealed, (p) => (restoreRun.progress = p), {
			...(increments.length ? { increments, base: cid } : {}),
			fetchBytes: (/** @type {string} */ block) =>
				fetchFromGateways(block, {
					gateways: endpoints.gateways,
					accept: RAW_BLOCK,
					timeout: 10_000
				})
		});
		restoreRun.result = done.databases;
		restoreRun.increments = done.increments ?? 0;
		restoreRun.phase = 'done';
		// The books were closed for the restore: open them again, with what came back.
		setTimeout(() => location.reload(), 2500);
	} catch (e) {
		restoreRun.phase = '';
		// Failed after the books were closed for it: they open again only on a reload.
		if (/** @type {any} */ (e)?.booksClosed) setTimeout(() => location.reload(), 4000);
		const name = e instanceof Error ? e.name : '';
		/** @type {number[]} increments a chain lacks (ChainGapError) */
		const missing = e instanceof Error && 'missing' in e ? /** @type {any} */ (e).missing : [];
		restoreRun.error =
			name === 'WrongPasskeyError'
				? t('restore.wrongPasskey')
				: name === 'IncrementWithoutBaseError'
					? t('restore.isIncrement')
					: name === 'ChainGapError'
						? t('restore.gap', { missing: missing.join(', ') })
						: name === 'MissingHeadsError'
							? t('restore.incomplete')
							: name === 'BlocksNotStoredError'
								? t('restore.noSpace')
								: e instanceof Error && e.name === 'BackendError'
									? t('restore.notFetched')
									: e instanceof Error
										? e.message
										: String(e);
	}
}

/** The restore's step in words, or ''. */
export function restoreStepText() {
	const { phase, fetched, progress } = restoreRun;
	if (phase === 'fetching') {
		return fetched ? t('restore.fetchingIncrements', fetched) : t('restore.fetching');
	}
	if (phase === 'restoring') {
		return progress?.stage === 'database'
			? t('restore.database', {
					index: progress.index + 1,
					total: progress.total,
					name: t(`storage.databases.${progress.name}`)
				})
			: t('restore.opening');
	}
	return '';
}
