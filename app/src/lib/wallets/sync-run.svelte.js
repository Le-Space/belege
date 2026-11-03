// A wallet's sync, and "Alle Wallets synchronisieren", as runs of the app
// rather than of the card: they go on, and say how far they are, while the
// person clicks elsewhere in Belege (the tab Integrationen shows the percent).
// Only a reload ends a run; the wallets synced so far stay synced.

import { updateAlerts } from '$lib/integrations/alerts.js';
import { bridgeClient } from '$lib/integrations/bridge-state.svelte.js';
import { currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
import { t } from '$lib/i18n/index.js';
import { notifyInBackground } from '$lib/notify.js';
import { syncInTurn } from './sync-turn.js';
import { loadWallets, syncWallet } from './wallet-sync.js';
import { importedChain, walletChain } from './chains.js';

/** @typedef {import('./wallet-sync.js').Wallet} Wallet */

/** A timestamp for the note, not reactive state. */
const isoNow = () => new Date().toISOString();
/** @typedef {Awaited<ReturnType<typeof syncWallet>>} WalletResult */

export const walletRun = $state({
	/** @type {string | null} the wallet being synced now */
	syncing: null,
	/** @type {{ done: number, count: number, current: string | null } | null} the turn through all wallets */
	progress: null,
	/** @type {Record<string, WalletResult>} each wallet's last result, by id */
	results: {},
	/** @type {Record<string, string>} each wallet's last error, by id */
	errors: {},
	/** @type {(import('./sync-turn.js').TurnSummary & { at: string }) | null} the last turn's, until dismissed */
	summary: null
});

/** A wallet synced by its address (not Monero, whose history is a file). @param {Wallet} wallet */
export const syncable = (wallet) => !importedChain(walletChain(wallet.chain));

/** The label a wallet goes by in the progress. @param {Wallet} wallet */
const labelOf = (wallet) => wallet.name || walletChain(wallet.chain)?.name || wallet.chain;

/**
 * One wallet: its history from the bridge into the books, its hints for
 * "Braucht dich". Throws on failure, after noting the error.
 *
 * @param {Wallet} wallet
 * @param {{ client?: ReturnType<typeof bridgeClient> }} [p]
 * @returns {Promise<WalletResult>}
 */
async function syncOne(wallet, { client = bridgeClient() } = {}) {
	const store = currentStore();
	if (!store) throw new Error(t('messages.sync.off'));
	walletRun.syncing = wallet.id;
	walletRun.errors = Object.fromEntries(
		Object.entries(walletRun.errors).filter(([id]) => id !== wallet.id)
	);
	try {
		const result = await syncWallet({ client, store, wallet });
		walletRun.results = { ...walletRun.results, [wallet.id]: result };
		// What this sync leaves for the person, for "Braucht dich" (issue #152).
		const hints =
			result.unpriced.length +
			(result.history.pruned && result.history.completedBy !== 'indexer' ? 1 : 0) +
			((result.history.unknownAmounts ?? 0) ? 1 : 0);
		await updateAlerts(store.settings, (a) => ({
			...a,
			wallets: { ...a.wallets, [wallet.id]: hints }
		}));
		await refreshNow();
		return result;
	} catch (e) {
		walletRun.errors = {
			...walletRun.errors,
			[wallet.id]: e instanceof Error ? e.message : String(e)
		};
		throw e;
	} finally {
		walletRun.syncing = null;
	}
}

/**
 * "Synchronisieren" on one wallet.
 *
 * @param {Wallet} wallet
 * @param {{ client?: ReturnType<typeof bridgeClient> }} [p]
 */
export async function syncOneWallet(wallet, p = {}) {
	if (walletRun.syncing || walletRun.progress) return;
	let done = false;
	try {
		await syncOne(wallet, p);
		done = true;
	} catch {
		// Noted in walletRun.errors.
	}
	if (done) await runMatchingNow();
}

/**
 * "Alle Wallets synchronisieren": every wallet synced by its address, one
 * after the other; the matching once at the end; a note, and a system
 * notification when Belege is in the background and new bookings came.
 *
 * @param {{ client?: ReturnType<typeof bridgeClient> }} [p]
 */
export async function syncAllWallets(p = {}) {
	if (walletRun.syncing || walletRun.progress) return;
	const store = currentStore();
	if (!store) return;
	const wallets = (await loadWallets(store.settings)).filter(syncable);
	if (!wallets.length) return;
	walletRun.summary = null;
	walletRun.progress = { done: 0, count: wallets.length, current: null };
	try {
		const summary = await syncInTurn({
			wallets,
			syncOne: (wallet) => syncOne(wallet, p),
			countsOf: (result) => ({
				new: result.totals.new,
				updated: result.totals.updated,
				unpriced: result.unpriced.length
			}),
			onProgress: ({ done, count, current }) => {
				walletRun.progress = { done, count, current: current ? labelOf(current) : null };
			},
			// A store closed (the books locked) ends the turn.
			stopped: () => currentStore() !== store
		});
		walletRun.summary = { ...summary, at: isoNow() };
		if (summary.newEntries > 0 || summary.failed > 0) {
			await notifyInBackground({
				title: t('integrationen.wallets.all.notifyTitle'),
				body: [
					summary.newEntries > 0
						? t('integrationen.wallets.all.notifyNew', {
								count: summary.newEntries,
								wallets: summary.withNew
							})
						: t('integrationen.wallets.all.notifyNone'),
					summary.failed > 0
						? t('integrationen.wallets.all.notifyFailed', { count: summary.failed })
						: ''
				]
					.filter(Boolean)
					.join(' '),
				tag: 'belege-wallets',
				url: summary.newEntries > 0 ? '/zahlungen' : '/integrationen/wallets'
			});
		}
	} finally {
		walletRun.progress = null;
	}
	if ((walletRun.summary?.newEntries ?? 0) + (walletRun.summary?.updated ?? 0) > 0) {
		await runMatchingNow();
	}
}

/**
 * The note of a turn, in words: new bookings, rates missing, wallets not read.
 *
 * @param {import('./sync-turn.js').TurnSummary} s
 */
export function walletSummaryText(s) {
	return [
		s.newEntries > 0
			? t('integrationen.wallets.all.summaryNew', { count: s.newEntries, wallets: s.withNew })
			: t('integrationen.wallets.all.summaryNone', { wallets: s.wallets }),
		s.updated > 0 ? t('integrationen.wallets.all.summaryUpdated', { count: s.updated }) : '',
		s.unpriced > 0 ? t('integrationen.wallets.all.summaryUnpriced', { count: s.unpriced }) : '',
		s.failed > 0 ? t('integrationen.wallets.all.summaryFailed', { count: s.failed }) : ''
	]
		.filter(Boolean)
		.join(' · ');
}

/** The note of the last turn, closed. */
export function dismissWalletSummary() {
	walletRun.summary = null;
}
