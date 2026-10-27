// What the last backup does not have yet, and – when switched on, on this
// device – an increment for it once the books have been quiet for a while.
//
// "Nicht gesichert": a collection whose heads are not the ones the chain last
// shipped (session `unsavedCollections`). Asked again a moment after every
// write – an import, a receipt, an AI result, a link, entries that came by
// sync – and after every backup, here or on an own device (the chain is in the
// sealed settings and travels with them).
//
// Automatic: an increment, never a full backup (that costs credits every day
// it is kept, and asks first). It runs only where "Jetzt sichern" would run
// without a question: a chain this device can go on with, the network not
// paused, a key that may keep it – this browser's own once granted, else a
// paired bridge that answers – and credits for more than ASK_BELOW_DAYS.
// Otherwise the header says the backup needs the person. On for this device
// only (localStorage): two devices backing up the same chain at once would
// both write its next increment.

import { app, chainFitsBooks, currentStore, unsavedCollections } from '$lib/session.svelte.js';
import { bridge, bridgeClient } from '$lib/integrations/bridge-state.svelte.js';
import { loadBackups } from './history.js';
import { loadChain } from './chain.js';
import {
	alephEndpoints,
	backupAddressOf,
	creditsOf,
	createBackupUploader,
	creditsPerDay,
	ensureBackupKey,
	isGranted,
	loadOwner
} from './keeper.js';
import { backupRun, runBackup } from './run.svelte.js';

/** Below this many days of credits, a backup asks first: never automatic then. */
export const ASK_BELOW_DAYS = 30;
/** How long the books stay quiet before an automatic increment. */
export const AUTO_DELAY_MS = 5 * 60_000;
/** Every collection a write in which may want a backup; settings for a backup made elsewhere. */
const COLLECTIONS = /** @type {const} */ ([
	'transactions',
	'receipts',
	'partners',
	'accounts',
	'matches',
	'questions',
	'events',
	'settings',
	'travel'
]);
/** How long after a write the books are compared with the last backup. */
const SETTLE_MS = 2_000;

export const backupDue = $state({
	/** The collections the last backup does not have yet; empty: all saved. */
	collections: /** @type {string[]} */ ([]),
	/** There is a chain to compare with (a full backup was made). */
	known: false,
	/** Automatic increments, on this device. */
	auto: false,
	/** When the next automatic increment starts (ms), 0: none planned. */
	at: 0,
	/** @type {'' | 'paused' | 'chain' | 'key' | 'credits' | 'error'} why it does not run by itself */
	blocked: ''
});

/** @param {string} did */
const autoKey = (did) => `belege.backup-auto:${did}`;

/** Whether this device backs up by itself, for these books. */
function readAuto() {
	try {
		return app.did ? globalThis.localStorage?.getItem(autoKey(app.did)) === 'on' : false;
	} catch {
		return false;
	}
}

/** Switch automatic increments on or off, on this device. @param {boolean} on */
export function setAutoBackup(on) {
	try {
		if (app.did) {
			if (on) globalThis.localStorage?.setItem(autoKey(app.did), 'on');
			else globalThis.localStorage?.removeItem(autoKey(app.did));
		}
	} catch {
		// Private mode: on for this tab only.
	}
	backupDue.auto = on;
	backupDue.blocked = '';
	plan();
}

/** The quiet time, shorter in the end-to-end tests. */
const delay = () =>
	Number(/** @type {any} */ (globalThis).__belegeBackupAutoDelayMs) || AUTO_DELAY_MS;

/** @type {ReturnType<typeof setTimeout> | null} */
let settleTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let autoTimer = null;
/** @type {(() => void)[]} */
let stops = [];
let lastFinished = 0;

/** Compare again, a moment after the last write. */
function soon() {
	if (settleTimer) clearTimeout(settleTimer);
	settleTimer = setTimeout(() => {
		settleTimer = null;
		check().catch((e) => console.warn('backup due:', e));
	}, SETTLE_MS);
}

/** What the last backup does not have yet. */
export async function check() {
	const store = currentStore();
	if (!store) return;
	const chain = await loadChain(store.settings);
	backupDue.known = Boolean(chain);
	backupDue.collections = chain && chainFitsBooks(chain) ? await unsavedCollections(chain) : [];
	plan();
}

/** Writes restart the quiet time; with nothing unsaved, nothing is planned. */
function plan() {
	if (autoTimer) clearTimeout(autoTimer);
	autoTimer = null;
	backupDue.at = 0;
	if (!backupDue.auto || !backupDue.collections.length || backupRun.step) return;
	backupDue.at = Date.now() + delay();
	autoTimer = setTimeout(() => {
		autoTimer = null;
		backupDue.at = 0;
		backUpByItself().catch((e) => console.warn('automatic backup:', e));
	}, delay());
}

/**
 * Everything a backup needs without the card: the account, this browser's
 * key, whether it may keep, the bridge where it signs instead.
 */
async function context() {
	const store = currentStore();
	if (!store) return null;
	const owner = await loadOwner(store.settings);
	if (!owner) return null;
	const key = await ensureBackupKey(store.settings);
	const address = await backupAddressOf(key);
	const client = bridge.token ? bridgeClient() : null;
	/** @type {any} */
	const status = client
		? await client.backupStatus().then(
				(s) => s.aleph,
				() => null
			)
		: null;
	const endpoints = alephEndpoints(status);
	const granted = await isGranted({ owner, address, endpoints }).catch(() => null);
	const bridgeSigns = Boolean(client && status?.configured);
	if (granted !== true && !bridgeSigns) return { store, owner, endpoints, uploader: null };
	const uploader = await createBackupUploader({
		owner,
		key,
		granted: granted === true,
		endpoints,
		bridge: bridgeSigns
			? {
					keep: (cid, ref) => /** @type {any} */ (client).alephKeep(cid, ref),
					address: status?.address
				}
			: null
	});
	return { store, owner, endpoints, uploader };
}

/** One increment, when nothing stands in its way. */
async function backUpByItself() {
	if (!backupDue.auto || backupRun.step || !backupDue.collections.length) return;
	backupDue.blocked = '';
	if (app.network.paused) return void (backupDue.blocked = 'paused');
	const ctx = await context();
	if (!ctx) return;
	const chain = await loadChain(ctx.store.settings);
	const backups = await loadBackups(ctx.store.settings);
	const base = chain ? backups.find((b) => b.cid === chain.base) : undefined;
	if (
		!chain ||
		!chainFitsBooks(chain) ||
		['unknown', 'rejected', 'forgotten'].includes(base?.status ?? '')
	) {
		return void (backupDue.blocked = 'chain');
	}
	if (!ctx.uploader) return void (backupDue.blocked = 'key');
	const credits = await creditsOf({ owner: ctx.owner, endpoints: ctx.endpoints }).catch(() => null);
	const kept = backups.filter((b) => b.status === 'processed').reduce((n, b) => n + b.size, 0);
	backupDue.blocked = '';
	await runBackup({
		continuing: chain,
		uploader: ctx.uploader,
		// It never asks: what would ask stops it, and the header says so.
		askFor: (bytes) => {
			const perDay = creditsPerDay(kept) + creditsPerDay(bytes);
			const days = credits === null || perDay <= 0 ? Infinity : credits / perDay;
			if (days >= ASK_BELOW_DAYS) return null;
			backupDue.blocked = 'credits';
			return { perDay: creditsPerDay(bytes), days };
		},
		unattended: true
	});
	if (backupRun.error) backupDue.blocked = 'error';
}

/**
 * Watch the books while they are open: every collection's writes, and the
 * end of every backup run. Returns the stop.
 */
export function watchBackupDue() {
	const store = currentStore();
	if (!store) return () => {};
	backupDue.auto = readAuto();
	stops = COLLECTIONS.map((name) => store[name].onChange(soon));
	soon();
	return () => {
		for (const stop of stops) stop();
		stops = [];
		if (settleTimer) clearTimeout(settleTimer);
		if (autoTimer) clearTimeout(autoTimer);
		settleTimer = autoTimer = null;
		backupDue.at = 0;
	};
}

/** A run ended (here, by hand or by itself): compare again. */
export function afterRun() {
	if (backupRun.finished === lastFinished) return;
	lastFinished = backupRun.finished;
	soon();
}
