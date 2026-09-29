// The setup checklist's facts (issue #200), gathered from the books (session),
// the bridge (bridge-state) and what Integrationen keeps; and the one thing it
// stores itself, the steps put off (settings key `setup`, sealed).
import { app, currentStore } from '$lib/session.svelte.js';
import { getSetting, setSetting } from '$lib/store/settings.js';
import { deviceSyncOn } from '$lib/sync/device-sync.js';
import { bridge, bridgeViaDevice } from '$lib/integrations/bridge-state.svelte.js';
import { integrationFacts } from '$lib/integrations/facts.svelte.js';
import { cleanSetup, setupSteps } from './steps.js';

export const setup = $state({
	/** @type {string[]} */
	later: [],
	loaded: false
});

/** Read what was put off. */
export async function loadSetup() {
	const store = currentStore();
	if (!store) return;
	setup.later = cleanSetup(await getSetting(store.settings, 'setup')).later;
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
	setup.later = cleanSetup({ later: next }).later;
	await setSetting(store.settings, 'setup', { later: setup.later });
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
		accounts: app.accounts,
		transactions: app.transactions,
		receipts: app.receipts,
		events: app.events,
		datev: app.datevSettings ?? null,
		later: setup.later
	};
}

/** The checklist as it stands. */
export const currentSetup = () => setupSteps(setupFacts());
