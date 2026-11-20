// The settings a hosted bridge starts with (#728), kept in the books' sealed
// settings: which are kept, keeping and forgetting them, and taking over
// those of the bridge on a computer. Moved out of session.svelte.js as it
// was (#844, step B4); integrations/hosted-settings.js holds their shape.

import { getSetting, setSetting } from '$lib/store/settings.js';
import { t } from '$lib/i18n/index.js';

/** @type {import('./hosted-aleph.js').SessionContext} */
let ctx;

/** @param {import('./hosted-aleph.js').SessionContext} context set by session.svelte.js before any call */
export function bindSession(context) {
	ctx = context;
}

/**
 * The settings a hosted bridge starts with besides its pairing (#728),
 * from the books' sealed settings; empty when none are kept.
 *
 * @returns {Promise<import('../integrations/hosted-settings.js').HostedSettings>}
 */
export async function keptHostedSettings() {
	const hs = await import('../integrations/hosted-settings.js');
	if (!ctx.session?.store) return hs.emptySettings();
	return hs.cleanSettings(await getSetting(ctx.session.store.settings, hs.HOSTED_SETTINGS_KEY));
}

/**
 * What is kept for a hosted bridge, by name only (never a value): for the cards.
 *
 * @returns {Promise<{ accounts: string[], sections: string[] }>}
 */
export async function hostedSettingsNames() {
	const hs = await import('../integrations/hosted-settings.js');
	return hs.keptNames(await keptHostedSettings());
}

/**
 * What is kept for a hosted bridge, for the cards: per integration its
 * non-secret values and whether its secret part is there – never a secret
 * (integrations/hosted-settings.js `keptView`).
 *
 * @returns {Promise<import('../integrations/hosted-settings.js').KeptEntry[]>}
 */
export async function hostedSettingsView() {
	const hs = await import('../integrations/hosted-settings.js');
	return hs.keptView(await keptHostedSettings());
}

/**
 * Keep settings for a hosted bridge, sealed in the books: over what is kept,
 * a section or an account replacing the one before. Only an owner's device.
 *
 * @param {unknown} settings `{ config, secrets }`
 */
export async function keepHostedSettings(settings) {
	if (!ctx.session?.store || ctx.app.member)
		throw new Error(t('messages.hostedSettings.ownerOnly'));
	const hs = await import('../integrations/hosted-settings.js');
	const merged = hs.mergeSettings(await keptHostedSettings(), hs.cleanSettings(settings));
	await setSetting(ctx.session.store.settings, hs.HOSTED_SETTINGS_KEY, merged);
	return hs.keptNames(merged);
}

/** Forget what is kept for a hosted bridge. */
export async function forgetHostedSettings() {
	if (!ctx.session?.store || ctx.app.member)
		throw new Error(t('messages.hostedSettings.ownerOnly'));
	const hs = await import('../integrations/hosted-settings.js');
	await setSetting(ctx.session.store.settings, hs.HOSTED_SETTINGS_KEY, hs.emptySettings());
}

/**
 * Take over the settings of the bridge on a computer (#728): it hands them
 * over the stream to the device that paired it, and they are kept sealed as
 * if typed in. The bridge on the computer keeps them and keeps working.
 */
export async function takeOverBridgeSettings() {
	const { createBridgeClient } = await import('../bridge/client.js');
	const exported = await createBridgeClient().settingsExport();
	return keepHostedSettings(exported);
}
