// "Jetzt sichern", run for the whole app rather than inside the backup card:
// a backup of 500 MB takes minutes, and the person goes on working meanwhile.
// The card starts it and shows it; the header shows how far it is from every
// page (BackupBadge.svelte); closing or reloading the tab asks first, since
// that ends the upload. What a run made lands in the books' settings as
// before (history.js, chain.js), and the card reloads from there when a run
// ends (`backupRun.finished`).

import { intlLocale, t } from '$lib/i18n/index.js';
import { releaseName } from '$lib/build-info.js';
import {
	app,
	currentStore,
	makeBackup,
	makeIncrement,
	publishBooksVault
} from '$lib/session.svelte.js';
import { backupName, rememberBackup } from './history.js';
import { chainAfter, chainFromBase, saveChain } from './chain.js';
import { keepAwake } from '$lib/wake-lock.js';
import { holdAlive } from '$lib/keep-alive.js';
import { BackupRefusedError } from './keeper.js';

/**
 * @typedef {'' | 'packing' | 'asking' | 'uploading' | 'keeping'} BackupStep
 */

export const backupRun = $state({
	/** @type {BackupStep} */
	step: '',
	/** @type {import('./archive.js').BackupProgress | null} what packing is at */
	progress: null,
	/** Bytes uploaded so far, of `total` – counted only while `measured`. */
	sent: 0,
	total: 0,
	/** Whether the host lets the upload be counted: true once a progress event came. */
	measured: false,
	/** When the upload began (ms), for "seit 42 s". */
	uploadStarted: 0,
	/** @type {string | null} */
	error: null,
	/** @type {import('./history.js').BackupRecord | null} */
	made: null,
	/** The last run found nothing new. */
	nothingNew: false,
	/** A backup packed and waiting for "Hochladen" because of what it costs. */
	asking: /** @type {{ size: number, perDay: number, days: number } | null} */ (null),
	/** Counts the runs that ended: the card reloads the history on a change. */
	finished: 0
});

/** @type {((go: boolean) => void) | null} */
let answer = null;

/** The answer to "Hochladen?". @param {boolean} go */
export function decideBackup(go) {
	answer?.(go);
	answer = null;
	backupRun.asking = null;
}

/** Uploaded so far, in whole percent; 0 before the upload. */
export const uploadPercent = () =>
	backupRun.total > 0 ? Math.min(100, Math.floor((backupRun.sent / backupRun.total) * 100)) : 0;

/**
 * How far the current step is, 0…1; null where it cannot be told (sealing,
 * an upload the host does not let be counted, Aleph being asked).
 *
 * @returns {number | null}
 */
export function stepFraction() {
	const p = backupRun.progress;
	if (backupRun.step === 'packing' && p?.stage === 'database') return (p.index + 1) / p.total;
	if (backupRun.step === 'packing' && p?.stage === 'files' && p.total) return p.done / p.total;
	if (backupRun.step === 'uploading' && backupRun.measured) return uploadPercent() / 100;
	return null;
}

/** "499 MB", "12 kB". @param {number} bytes */
export const sizeText = (bytes) =>
	bytes < 1e6
		? `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(bytes / 1e3)} kB`
		: `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: bytes < 1e7 ? 1 : 0 }).format(bytes / 1e6)} MB`;

/**
 * The current step in words, with its counts.
 *
 * @param {number} now ms, for how long the upload has been going
 */
export function stepText(now) {
	const p = backupRun.progress;
	if (backupRun.step === 'packing') {
		return !p
			? t('backup.step.packing')
			: p.stage === 'database'
				? t('backup.progress.database', {
						index: p.index + 1,
						total: p.total,
						name: t(`storage.databases.${p.name}`),
						entries: p.entries
					})
				: p.stage === 'files'
					? t('backup.progress.files', { done: p.done, total: p.total })
					: t('backup.progress.sealing', { size: sizeText(p.bytes) });
	}
	if (backupRun.step === 'uploading') {
		return backupRun.measured
			? t('backup.progress.upload', {
					sent: sizeText(backupRun.sent),
					total: sizeText(backupRun.total),
					percent: uploadPercent()
				})
			: t('backup.progress.uploadUnmeasured', {
					size: sizeText(backupRun.total),
					seconds: Math.max(0, Math.round((now - backupRun.uploadStarted) / 1000))
				});
	}
	return backupRun.step ? t(`backup.step.${backupRun.step}`) : '';
}

/** @param {BeforeUnloadEvent} e */
const holdTheTab = (e) => {
	e.preventDefault();
	// Older browsers show the dialog only with this set.
	e.returnValue = '';
};

/** Aleph's refusal in words. @param {unknown} e */
export const refused = (e) =>
	/** @type {any} */ (e)?.name === 'UploadTimeoutError'
		? t('backup.uploadTimedOut', {
				minutes: /** @type {any} */ (e).minutes,
				size: sizeText(/** @type {any} */ (e).size)
			})
		: /** @type {any} */ (e)?.reason === 'unsigned-limit'
			? t('backup.ingestGone', {
					size: sizeText(/** @type {any} */ (e).size),
					limit: sizeText(/** @type {any} */ (e).limit)
				})
			: /** @type {any} */ (e)?.reason === 'signed-limit'
				? t('backup.tooBig', {
						size: sizeText(/** @type {any} */ (e).size),
						limit: sizeText(/** @type {any} */ (e).limit)
					})
				: e instanceof BackupRefusedError
					? e.kind === 'credits'
						? t('messages.bridge.alephNotKept', {
								credits: Number(e.reason.credits).toLocaleString(intlLocale()),
								required: Number(e.reason.required).toLocaleString(intlLocale())
							})
						: t('messages.bridge.alephRejected', { error: String(e.reason.errorCode ?? '') })
					: e instanceof Error
						? e.message
						: String(e);

/**
 * Per database, as the app names them.
 *
 * @param {import('./archive.js').BackupManifest} manifest
 * @returns {{ collection: string, entries: number }[]}
 */
const databasesOf = (manifest) =>
	manifest.metadata.databases.map((/** @type {any} */ d) => ({
		collection: String(d.collection ?? d.name),
		entries: Number(d.entryCount ?? 0)
	}));

/**
 * One backup: after a full backup, only what is new since the chain's last
 * backup (#454) – an increment, kept with its base's CID as `ref`. Without
 * `continuing`, a full one, which starts a new chain. Does nothing while a
 * run is going.
 *
 * @param {object} params
 * @param {import('./archive.js').BackupChain | null} params.continuing the chain to add to; null: a full backup
 * @param {import('./keeper.js').BackupUploader} params.uploader where it goes up, and what keeps it (keeper.js)
 * @param {(size: number) => { perDay: number, days: number } | null} params.askFor what a backup of this size costs, when it should be asked first
 * @param {boolean} [params.unattended] started by itself (auto.svelte.js): what would ask stops it instead
 */
export async function runBackup({ continuing, uploader, askFor, unattended = false }) {
	const store = currentStore();
	if (!store || backupRun.step) return;
	Object.assign(backupRun, {
		error: null,
		made: null,
		nothingNew: false,
		progress: null,
		sent: 0,
		total: 0,
		measured: false,
		uploadStarted: 0
	});
	window.addEventListener('beforeunload', holdTheTab);
	// A phone must not darken its screen meanwhile (#512), nor freeze the tab
	// when the person switches to another app (#525): a tone, from the click
	// on "Jetzt sichern". Not when the backup started by itself: no gesture
	// would let it play, and nobody asked for a sound.
	const letSleep = keepAwake();
	const letQuiet = unattended ? () => {} : holdAlive({ title: t('keepAlive.backingUp') });
	try {
		backupRun.step = 'packing';
		// A point in time, read and never changed: nothing to react to.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const at = new Date();
		const appVersion = releaseName() || 'dev';
		const onProgress = (/** @type {any} */ p) => (backupRun.progress = p);
		const built = continuing
			? await makeIncrement({ chain: continuing, appVersion, onProgress })
			: await makeBackup({ appVersion, onProgress });
		if (!built) {
			backupRun.nothingNew = true;
			return;
		}
		// A whole copy costs credits every day it is kept: when the credits
		// would not last a month with it, ask before it goes up.
		const cost = askFor(built.sealed.length);
		if (cost && unattended) return;
		if (cost) {
			backupRun.step = 'asking';
			backupRun.asking = { size: built.sealed.length, ...cost };
			const go = await new Promise((resolve) => (answer = resolve));
			if (!go) return;
		}
		backupRun.step = 'uploading';
		backupRun.total = built.sealed.length;
		backupRun.uploadStarted = Date.now();
		// The storage bridge's Aleph backend: the IPFS host, else an API node;
		// with this browser's key granted, kept in the same call (keeper.js).
		const handle = await uploader.backend.putBlob(built.sealed, {
			name: backupName(at, continuing ? continuing.sequence + 1 : 0),
			contentType: 'application/octet-stream',
			...(continuing ? { ref: continuing.base } : {}),
			onProgress: (/** @type {number} */ sent, /** @type {number} */ total) => {
				backupRun.measured = true;
				backupRun.sent = sent;
				if (total) backupRun.total = total;
			}
		});
		backupRun.step = 'keeping';
		const kept = await uploader.keep(handle, continuing?.base);
		/** @type {import('./history.js').BackupRecord} */
		const record = {
			at: at.toISOString(),
			provider: 'aleph',
			cid: handle.id,
			size: built.sealed.length,
			status: kept.status,
			itemHash: kept.itemHash,
			address: kept.address,
			...(kept.sender ? { sender: kept.sender } : {}),
			...('heads' in built
				? {
						kind: /** @type {const} */ ('increment'),
						base: continuing?.base,
						sequence: (continuing?.sequence ?? 0) + 1,
						entries: built.entries,
						databases: built.databases,
						files: built.files.length,
						blocks: built.blocks,
						missing: built.missing
					}
				: {
						kind: /** @type {const} */ ('full'),
						entries: databasesOf(built.manifest).reduce((n, d) => n + d.entries, 0),
						databases: databasesOf(built.manifest),
						files: built.manifest.files.length,
						blocks: built.blocks,
						missing: built.manifest.missing
					})
		};
		await rememberBackup(store.settings, record);
		backupRun.made = record;
		// The books' index on Aleph names the account the backups are kept
		// for (#406): kept current, when the vault is kept there at all.
		if (app.vault.indexOn && !app.network.paused) {
			publishBooksVault().catch((e) => console.warn('vault index:', e));
		}
		// The chain moves once Aleph has taken it. An increment the bridge
		// kept without its `ref` (an older bridge) is not found by its chain:
		// the next one ships everything since again.
		if (kept.status !== 'rejected') {
			if (!('heads' in built)) {
				await saveChain(store.settings, chainFromBase(built.manifest, handle.id));
			} else if (continuing && kept.ref === continuing.base) {
				await saveChain(store.settings, chainAfter(continuing, built, handle.id));
			} else {
				backupRun.error = t('backup.oldBridge');
			}
		}
	} catch (e) {
		backupRun.error = refused(e);
	} finally {
		letSleep();
		letQuiet();
		window.removeEventListener('beforeunload', holdTheTab);
		answer = null;
		Object.assign(backupRun, { step: '', progress: null, asking: null });
		backupRun.finished += 1;
	}
}
