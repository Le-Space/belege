// Reading the lists again, matching and the day's rates (#844, B10): moved out
// of session.svelte.js unchanged. #78 redesigns the refresh; it then changes
// this file only.
import { getSetting } from '$lib/store/settings.js';
import { classifyTransaction } from '$lib/matching/classify.js';
import { buildMatchingContext } from '$lib/matching/context.js';
import { cleanChart } from '$lib/booking/chart.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {() => boolean} readOnly
 * @property {typeof import('$lib/session.svelte.js').pairedClient} pairedClient
 */

/** @type {SessionContext} */
let host;

/** @param {SessionContext} context */
export function bindSession(context) {
	host = context;
}

/** @type {Promise<void> | null} the refresh running now */
let refreshing = null;
/** Whether something asked for a refresh while one was running. */
let refreshAgain = false;

/**
 * Read the lists again. One at a time: asked while one runs, it runs once
 * more after that one (so a caller that just wrote sees its write), instead
 * of a second full read side by side.
 *
 * @returns {Promise<void>}
 */
export function refresh() {
	if (refreshing) {
		refreshAgain = true;
		return refreshing;
	}
	refreshing = (async () => {
		do {
			refreshAgain = false;
			await readAll();
		} while (refreshAgain && host.session);
	})().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

async function readAll() {
	if (!host.session) return;
	const [
		transactions,
		receipts,
		partners,
		accounts,
		matches,
		questions,
		events,
		travel,
		matchingSettings,
		datevSettings,
		chart,
		alephSettings
	] = await Promise.all([
		host.session.store.transactions.list(),
		host.session.store.receipts.list(),
		host.session.store.partners.list(),
		host.session.store.accounts.list(),
		host.session.store.matches.list(),
		host.session.store.questions.list(),
		host.session.store.events.list(),
		host.session.store.travel.list(),
		getSetting(host.session.store.settings, 'matching'),
		getSetting(host.session.store.settings, 'datev'),
		getSetting(host.session.store.settings, 'chart'),
		getSetting(host.session.store.settings, 'aleph')
	]);
	const ctx = await buildMatchingContext({
		accounts,
		transactions,
		settings: matchingSettings,
		partners,
		alephPurchases: Array.isArray(alephSettings?.purchases) ? alephSettings.purchases : []
	});
	/** @type {Record<string, import('../matching/classify.js').Classification>} */
	const classifications = {};
	for (const tx of transactions) {
		const c = classifyTransaction(tx, ctx);
		if (c) classifications[tx.id] = c;
	}
	host.app.transactions = transactions;
	host.app.receipts = receipts;
	host.app.partners = partners;
	host.app.accounts = accounts;
	host.app.matches = matches;
	host.app.questions = questions;
	host.app.events = events;
	host.app.travel = travel;
	host.app.classifications = classifications;
	host.app.matchingSettings = matchingSettings;
	host.app.datevSettings = datevSettings;
	host.app.chart = cleanChart(chart);
}

/** @type {Promise<unknown>} */
let matchingQueue = Promise.resolve();

/**
 * "Abgleich": receipts against transactions (matching/engine.js). Runs one at
 * a time; the lists are read again afterwards.
 *
 * @param {'manual' | 'auto'} [trigger] "Abgleich starten" is manual; after a sync, fetch or read it is auto
 * @returns {Promise<import('../matching/engine.js').MatchingResult | null>}
 */
export function runMatchingNow(trigger = 'auto') {
	const next = matchingQueue.then(async () => {
		// A member who only reads (#641) writes no matches: the owner's devices do.
		if (!host.session || host.readOnly()) return null;
		host.app.matching = true;
		host.app.matchingProgress = null;
		try {
			const { runMatching } = await import('../matching/engine.js');
			const result = await runMatching({
				store: host.session.store,
				trigger,
				onProgress: (p) => (host.app.matchingProgress = p)
			});
			// New network fees take the account the person set for all of them (#305).
			const { applyFeeRule } = await import('../booking/fee-rule.js');
			await applyFeeRule(/** @type {any} */ (host.session.store));
			return result;
		} catch (error) {
			console.error('matching failed:', error);
			return null;
		} finally {
			host.app.matching = false;
			host.app.matchingProgress = null;
			await refresh();
			// Links the run made may be to an invoice in another currency.
			fillExchangeRates();
			// The books as this run left them, for the catch-up after the next unlock (#473).
			if (host.app.did) {
				const { fingerprint, noteRun } = await import('../matching/catch-up.js');
				noteRun(globalThis.localStorage, host.app.did, fingerprint(host.app));
			}
		}
	});
	matchingQueue = next;
	return next;
}

/** Quiet this long after the last write, and the lists are read again. */
export const REFRESH_QUIET_MS = 250;
/** A long burst (an import, reading many receipts) still shows progress this often. */
export const REFRESH_MAX_WAIT_MS = 2000;

/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;
/** When the first write of the current burst came; 0 when none waits. */
let burstStart = 0;
/**
 * An import writes hundreds of records; the lists are read again once the
 * writes stop (REFRESH_QUIET_MS), and during a long burst at most every
 * REFRESH_MAX_WAIT_MS – not after every write: each read goes through all
 * the books (docs/performance.md). A matching run reads them itself when it
 * ends, so its writes schedule nothing.
 */
export function scheduleRefresh() {
	if (host.app.matching) return;
	const now = Date.now();
	if (!burstStart) burstStart = now;
	if (refreshTimer) clearTimeout(refreshTimer);
	const wait = Math.max(0, Math.min(REFRESH_QUIET_MS, burstStart + REFRESH_MAX_WAIT_MS - now));
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		burstStart = 0;
		void refresh();
	}, wait);
}

/** Read the lists again now (after an import, so its result shows at once). */
export function refreshNow() {
	return refresh();
}

/** @type {Promise<number>} */
let fxQueue = Promise.resolve(0);

/**
 * The ECB rate of the day for payments linked to an invoice in another
 * currency, where none is kept yet (matching/fx.js): so instalments in euros
 * – a bank transfer, a Monero payment valued in euros – count in the
 * invoice's currency. And for euro bookings that, at it, come near an open
 * receipt in another currency (#474), with matching run again for them.
 * Through the bridge; without one, nothing happens.
 * One run at a time; the books are read again when a rate came.
 *
 * @returns {Promise<number>} bookings that got a rate
 */
export function fillExchangeRates() {
	const next = fxQueue
		.then(async () => {
			if (!host.session || host.readOnly()) return 0;
			const { fxGaps, fxCandidateGaps, fillFx } = await import('../matching/fx.js');
			const books = {
				receipts: host.app.receipts,
				matches: host.app.matches,
				transactions: host.app.transactions
			};
			const linked = fxGaps(books);
			const candidates = fxCandidateGaps(books);
			if (!linked.length && !candidates.length) return 0;
			const client = await host.pairedClient();
			if (!client || !host.session) return 0;
			const filled = await fillFx({
				client,
				transactions: host.session.store.transactions,
				gaps: [...linked, ...candidates]
			});
			if (!filled) return 0;
			await refresh();
			// A booking that now comes near an open receipt in another currency
			// may be its payment (#474): matching counts it on the next run.
			const kept = (/** @type {any} */ g) =>
				host.app.transactions.some((t) => t.id === g.tx.id && t.fx?.[g.currency]?.rate);
			if (candidates.some(kept)) runMatchingNow();
			return filled;
		})
		.catch((error) => {
			console.error('exchange rates:', error);
			return 0;
		});
	fxQueue = next;
	return next;
}
