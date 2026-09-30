// The setup checklist's facts (issue #200), gathered from the books (session),
// the bridge (bridge-state) and what Integrationen keeps; and the one thing it
// stores itself, the steps put off (settings key `setup`, sealed).
import { app, currentStore } from '$lib/session.svelte.js';
import { getSetting, setSetting } from '$lib/store/settings.js';
import { deviceSyncOn } from '$lib/sync/device-sync.js';
import { bridge, bridgeViaDevice } from '$lib/integrations/bridge-state.svelte.js';
import { integrationFacts } from '$lib/integrations/facts.svelte.js';
import { asksForStart, cleanSetup, setupSteps, withStart } from './steps.js';
import { isSample } from '$lib/sample/sample.js';

export const setup = $state({
	/** @type {string[]} */
	later: [],
	/** @type {import('./steps.js').Start | null} */
	start: null,
	loaded: false
});

/** Read what was put off. */
export async function loadSetup() {
	const store = currentStore();
	if (!store) return;
	const kept = cleanSetup(await getSetting(store.settings, 'setup'));
	setup.later = kept.later;
	setup.start = kept.start;
	setup.loaded = true;
}

/**
 * Put a step off, or take it up again.
 *
 * @param {string} id
 * @param {boolean} later
 */
export async function setLater(id, later) {
	const store = currentStore();
	if (!store) return;
	const rest = setup.later.filter((s) => s !== id);
	const next = later ? [...rest, id] : rest;
	const kept = { later: cleanSetup({ later: next }).later, start: setup.start };
	// Stored first, shown after: what the list says is what a reload finds.
	await setSetting(store.settings, 'setup', kept);
	setup.later = kept.later;
}

/**
 * Choose how to start (or null: ask again).
 *
 * @param {import('./steps.js').Start | null} start
 */
export async function chooseStart(start) {
	const store = currentStore();
	if (!store) return;
	const next = withStart(setup, start);
	await setSetting(store.settings, 'setup', next);
	setup.later = next.later;
	setup.start = next.start;
}

/** @returns {import('./steps.js').SetupFacts} */
export function setupFacts() {
	const f = integrationFacts();
	return {
		bridge: {
			paired: Boolean(bridge.token),
			online: bridge.state === 'online',
			viaDevice: bridgeViaDevice(),
			llm: bridge.health.llm
		},
		devices: (app.sync.state?.devices ?? []).length,
		deviceSync: deviceSyncOn(),
		invoiceApp: f.invoiceApp,
		// Sample books are for looking around: they set nothing up.
		accounts: app.accounts.filter((a) => !isSample(a)),
		transactions: app.transactions.filter((t) => !isSample(t)),
		receipts: app.receipts.filter((r) => !isSample(r)),
		events: app.events,
		datev: app.datevSettings ?? null,
		later: setup.later,
		start: setup.start
	};
}

/** The checklist as it stands. */
export const currentSetup = () => setupSteps(setupFacts());

/** Whether Home asks how to start. */
export const startAsked = () => setup.loaded && bridge.loaded && asksForStart(setupFacts());

/** Whether the way in can still be chosen anew: the books are as new as on the first run. */
export const startOpen = () =>
	setup.loaded && bridge.loaded && asksForStart({ ...setupFacts(), start: null });
