// What the Integrationen overview is decided from (issue #152), gathered in one
// place so the overview and Home show the same "Braucht dich": the bridge
// (bridge-state), device sync and the books (session), and what the settings
// keep – wallets, Aleph accounts, the invoice app, the last runs' alerts.
import { app, currentStore } from '$lib/session.svelte.js';
import { getSetting } from '$lib/store/settings.js';
import { loadWallets } from '$lib/wallets/wallet-sync.js';
import { loadAleph } from '$lib/aleph/aleph.js';
import { isWalletSource } from '$lib/wallets/chains.js';
import { loadAlerts } from './alerts.js';
import { bridge, loadBridge } from './bridge-state.svelte.js';

const kept = $state({
	wallets: 0,
	aleph: 0,
	invoiceApp: false,
	deviceFlag: false,
	/** @type {import('./alerts.js').Alerts} */
	alerts: { kraken: null, wallets: {} }
});

/**
 * Read what the settings keep, and ask the bridge – again with `recheck`,
 * otherwise only if no page has asked yet.
 *
 * @param {{ recheck?: boolean }} [options]
 */
export async function loadIntegrationFacts({ recheck = false } = {}) {
	const store = currentStore();
	if (!store) return;
	try {
		kept.deviceFlag = localStorage.getItem('belege.device-sync') !== null;
	} catch {
		kept.deviceFlag = false;
	}
	const [w, a, inv, al] = await Promise.all([
		loadWallets(store.settings),
		loadAleph(store.settings),
		getSetting(store.settings, 'ucepInvoiceApp'),
		loadAlerts(store.settings)
	]);
	kept.alerts = al;
	kept.wallets = w.length;
	kept.aleph = a.accounts.length;
	kept.invoiceApp = Boolean(inv);
	if (recheck || !bridge.loaded) await loadBridge();
}

/** @returns {import('./overview.js').Facts} */
export const integrationFacts = () => ({
	bridge: {
		token: bridge.token,
		state: bridge.state,
		via: app.sync.bridgeRoute,
		health: bridge.health
	},
	devices: {
		flag: kept.deviceFlag,
		online: app.sync.online,
		removed: app.sync.removed,
		error: app.sync.error,
		connected: (app.sync.state?.devices ?? []).filter((d) => d.connected).length
	},
	accounts: app.accounts,
	events: app.events,
	wallets: kept.wallets,
	aleph: kept.aleph,
	invoiceApp: kept.invoiceApp,
	alerts: kept.alerts,
	isWalletSource
});
