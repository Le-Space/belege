// "Wiederherstellen" (issue #77), as the backup card runs it: a backup fetched
// from Aleph's gateway by its CID and put back into these books
// (archive.js `restoreBackup`), with the increments that build on it (#454).
// The file is not fetched and then opened: it is opened as it arrives (#512),
// frame by frame, its blocks stored as they are read, so a phone holds a
// megabyte or two of a backup of several hundred. The step says how far each
// has come: bytes fetched, blocks stored, then the databases joined.
// Restoring merges: what is here stays, what the backup holds is added. The
// books are closed for it, so the page reloads at the end and the passkey
// opens them again. The state lives here so the card stays readable.

import { app, currentStore, lookForOtherBooks, restoreBackup } from '$lib/session.svelte.js';
import { t } from '$lib/i18n/index.js';
import { loadBackups } from './history.js';
import { findBackups } from './keeper.js';
import { keepAwake } from '$lib/wake-lock.js';
import { holdAlive } from '$lib/keep-alive.js';
import { createRestoreStream, gatewayHost, restorePath, setRestorePath } from './restore-path.js';

export const restoreRun = $state({
	/** @type {string | null} the CID asked about, waiting for "Ja" */
	chosen: null,
	/** @type {'' | 'fetching' | 'restoring' | 'done'} */
	phase: '',
	/** @type {import('./archive.js').RestoreProgress | null} */
	progress: null,
	/** Increments fetched so far, while fetching them. */
	fetched: /** @type {{ done: number, total: number } | null} */ (null),
	/** Bytes of the file being fetched, of how many the gateway announced (0: unknown). */
	bytes: /** @type {{ received: number, total: number } | null} */ (null),
	/** Blocks of the backup in this browser's blockstore so far, over all its files (#512). */
	stored: 0,
	/** @type {{ collection: string, joined: number }[]} what came back, per database */
	result: [],
	/** Increments restored with the full backup. */
	increments: 0,
	/** @type {string | null} */
	error: null,
	/** @type {string | null} what the failing step said, in its own words, under `error` */
	detail: null,
	/** Which way the backup comes back (restore-path.js), as this browser keeps it. */
	path: /** @type {import('./restore-path.js').RestorePath} */ (
		restorePath(globalThis.localStorage)
	),
	/** @type {'gateway' | 'peers' | null} the way the file being fetched is coming */
	via: null,
	/** @type {{ path: 'gateway' | 'peers', host: string, peers: number, ms: number } | null} what delivered the backup, for the card */
	source: null
});

/** "Erst Alephs Gateway, dann das IPFS-Netz" on or off. @param {boolean} gatewayFirst */
export function chooseRestorePath(gatewayFirst) {
	restoreRun.path = gatewayFirst ? 'gateway-first' : 'peers';
	setRestorePath(globalThis.localStorage, restoreRun.path);
}

export const isCid = (/** @type {string} */ c) =>
	/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(c) || /^b[a-z2-7]{50,100}$/.test(c);

/** Ask "Dieses Backup wiederherstellen?" for `cid`; a string that is no CID is refused. @param {string} cid */
export function askRestore(cid) {
	restoreRun.error = null;
	restoreRun.detail = null;
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

/** Aleph keeps it, or has not decided yet: a file a restore can fetch. @param {{ status: string }} b */
export const kept = (b) => b.status === 'processed' || b.status === 'pending';

/**
 * The increments of a full backup, asked for right before the restore: those
 * the caller lists, those Aleph lists by its CID now, those made here that
 * Aleph keeps. One Aleph refused, or never took, is not fetched: the chain
 * did not move on it, so the next increment shipped the same entries again,
 * and the file itself is gone from Aleph's host – a fetch would wait for it
 * for nothing and fail the whole restore.
 *
 * @param {string} base
 * @param {{ known?: string[], owner?: string | null, endpoints: import('./keeper.js').AlephEndpoints, sizes?: Record<string, number> }} params
 *   `sizes`: filled with the bytes each file has, where the history or the STORE says
 */
async function incrementsOf(base, { known = [], owner, endpoints, sizes = {} }) {
	const cids = [...known];
	const store = currentStore();
	if (store) {
		for (const b of await loadBackups(store.settings)) {
			if (b.kind === 'increment' && b.base === base && kept(b)) cids.push(b.cid);
			if (b.size > 0) sizes[b.cid] ??= b.size;
		}
	}
	if (owner) {
		for (const b of await findBackups({ owner, ref: base, endpoints }).catch(() => [])) {
			cids.push(b.cid);
			if (b.size) sizes[b.cid] ??= b.size;
		}
	}
	return cids.filter((cid, i) => cids.indexOf(cid) === i);
}

/**
 * Restore the chosen backup: fetch it and its increments from the gateway,
 * put them back, reload. Errors in words.
 *
 * @param {{ owner?: string | null, endpoints: import('./keeper.js').AlephEndpoints, known?: string[], sizes?: Record<string, number> }} params
 *   `sizes`: the bytes of every file the card knows, by CID – a download of
 *   another length is refused at the gateway (storage bridge `getBlob`)
 */
export async function runRestore({ owner, endpoints, known = [], sizes = {} }) {
	const cid = restoreRun.chosen;
	if (!cid) return;
	restoreRun.chosen = null;
	restoreRun.error = null;
	restoreRun.detail = null;
	restoreRun.progress = null;
	restoreRun.bytes = null;
	restoreRun.stored = 0;
	restoreRun.fetched = null;
	restoreRun.via = null;
	restoreRun.source = null;
	// A phone must not darken its screen meanwhile (#512), nor freeze the tab
	// when the person switches to another app (#525): a tone, started here,
	// inside the click on "Ja, wiederherstellen".
	const letSleep = keepAwake();
	const letQuiet = holdAlive({ title: t('keepAlive.restoring') });
	/** The peer node, once a file goes over peers. */
	let peers = /** @type {import('./restore-peers.js').RestorePeers | null} */ (null);
	try {
		restoreRun.phase = 'fetching';
		const { createAlephBackend } = await import('@le-space/orbitdb-storage-bridge/backends/aleph');
		const { GATEWAY_IDLE_MS } = await import('./restore-path.js');
		const gateway = createAlephBackend({ gateways: endpoints.gateways, timeout: GATEWAY_IDLE_MS });
		const host = gatewayHost(endpoints.gateways);
		// The blob as it arrives (#512); a storage bridge from before has no such thing.
		const streamFromGateway = gateway.getBlobStream;
		if (!streamFromGateway) throw new Error('This storage bridge cannot fetch a blob as a stream.');
		/** The bytes each file has, where known: a short download is refused, not opened. */
		const bytesOf = { ...sizes };
		/** @param {string} id */
		const progressOf = (id) => (/** @type {number} */ received, /** @type {number} */ total) => {
			restoreRun.bytes = { received, total: total || bytesOf[id] || 0 };
		};
		// The way this browser chose (restore-path.js): the gateway, and the
		// peers when it goes quiet – or the peers only. Either way the card
		// learns which one delivered. A stream, not the file: what arrives is
		// opened and stored at once (archive.js), and a connection that drops is
		// picked up at the byte it stopped at.
		const streamBlob = createRestoreStream({
			path: restoreRun.path,
			viaGateway: (id, options = {}) => {
				restoreRun.via = 'gateway';
				return streamFromGateway(id, {
					...(bytesOf[id] > 0 ? { size: bytesOf[id] } : {}),
					...(options.timeout ? { timeout: options.timeout } : {}),
					onProgress: progressOf(id)
				});
			},
			viaPeers: (id, options = {}) =>
				(async function* () {
					restoreRun.via = 'peers';
					peers ??= await (await import('./restore-peers.js')).createRestorePeers();
					yield* peers.stream(id, {
						...(bytesOf[id] > 0 ? { size: bytesOf[id] } : {}),
						...(options.offset ? { offset: options.offset } : {}),
						onProgress: progressOf(id)
					});
				})(),
			onPath: (path, info) => {
				restoreRun.source = { path, host, peers: peers?.reached() ?? 0, ms: info.ms };
			}
		});
		/** One file, asked for when the restore gets to it. @param {string} id */
		const fileOf = (id) => () => {
			restoreRun.bytes = null;
			return streamBlob(id, bytesOf[id] > 0 ? { size: bytesOf[id] } : {});
		};
		// The increments first, with the sizes the history and Aleph's list
		// know for them; the full backup's size is the card's to know.
		const wanted = await incrementsOf(cid, { known, owner, endpoints, sizes: bytesOf });
		// The same gateways the archive itself came from, offered as a second
		// source for a head the backup does not carry. Ten seconds, not sixty:
		// beside a restore that is otherwise done, this is a long shot.
		const { fetchFromGateways, RAW_BLOCK } = await import(
			'@le-space/orbitdb-storage-bridge/gateway-fetch'
		);
		const done = await restoreBackup(
			fileOf(cid),
			(p) => {
				if (p.stage === 'stored') restoreRun.stored = p.blocks;
				else if (p.stage === 'joining' || p.stage === 'database') {
					// Every file is in: from here the books are put back.
					restoreRun.phase = 'restoring';
					restoreRun.bytes = null;
					restoreRun.progress = p;
				}
			},
			{
				...(wanted.length
					? {
							increments: wanted.map((inc, i) => () => {
								// Each one fetched only when the one before is stored.
								restoreRun.fetched = { done: i, total: wanted.length };
								return fileOf(inc)();
							}),
							base: cid
						}
					: {}),
				fetchBytes: (/** @type {string} */ block) =>
					fetchFromGateways(block, {
						gateways: endpoints.gateways,
						accept: RAW_BLOCK,
						timeout: 10_000
					})
			}
		);
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
								: // A frame that does not open (FrameError): the file is damaged or cut short.
									name === 'BackendError' || name === 'FrameError'
									? t('restore.notFetched')
									: e instanceof Error
										? e.message
										: String(e);
		// The step's own words beside the explanation: which gateway, how many
		// bytes, which CID. What a person reports, and what a maintainer needs.
		restoreRun.detail =
			e instanceof Error && e.message && e.message !== restoreRun.error ? e.message : null;
		// A backup of another vault: this passkey may have a slot in it, on a
		// device that founded books of its own (#524). Its index on Aleph is
		// asked – the restore was talking to Aleph already – unless paused; the
		// card offers what it names (keys/OtherBooksOffer.svelte).
		if (name === 'WrongPasskeyError' && !app.network.paused) {
			await lookForOtherBooks('restore').catch((err) => console.warn('other books on Aleph:', err));
		}
	} finally {
		letSleep();
		letQuiet();
		// The peer node was this restore's only: gone with it.
		const node = /** @type {import('./restore-peers.js').RestorePeers | null} */ (peers);
		if (node) await node.stop().catch(() => {});
	}
}

/** The restore's step in words, or ''. */
export function restoreStepText() {
	const { phase, fetched, progress, bytes, via, stored } = restoreRun;
	if (phase === 'fetching') {
		const file = fetched
			? t('restore.fetchingIncrements', { done: fetched.done + 1, total: fetched.total })
			: via === 'peers'
				? t('restore.fetchingPeers')
				: t('restore.fetching');
		const fetching = !bytes
			? file
			: bytes.total
				? t('restore.fetchingBytes', {
						what: file,
						received: megabytes(bytes.received),
						total: megabytes(bytes.total),
						percent: Math.min(100, Math.floor((bytes.received / bytes.total) * 100))
					})
				: t('restore.fetchingBytesUnknown', { what: file, received: megabytes(bytes.received) });
		// What arrived is already being put away: say so, it is what the wait is for.
		return stored > 0 ? `${fetching} ${t('restore.storedBlocks', { blocks: stored })}` : fetching;
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

/** Where the backup came from and how long it took, for the card; '' before it is known. */
export function restoreSourceText() {
	const { source } = restoreRun;
	if (!source) return '';
	const seconds = Math.max(1, Math.round(source.ms / 1000));
	return source.path === 'peers'
		? t('restore.sourcePeers', { peers: source.peers, seconds })
		: t('restore.sourceGateway', { host: source.host, seconds });
}

/** Whole megabytes, as text. @param {number} n bytes */
const megabytes = (n) => String(Math.round(n / 1e6));
