// What the last run of an integration left for the person (issue #152): a
// refused Kraken key, wallets whose sync left hints. Kept in the sealed
// settings (`integrationAlerts`) so the overview's "Braucht dich" knows it
// without running anything. Set by the sync that found it, cleared by the
// next one that did not.
import { getSetting, setSetting } from '../store/settings.js';

const KEY = 'integrationAlerts';

/**
 * @typedef {object} Alerts
 * @property {{ raw: string } | null} kraken the last Kraken sync failed
 * @property {Record<string, number>} wallets per wallet id: hints its last sync left
 */

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<Alerts>} */
export async function loadAlerts(settings) {
	const v = /** @type {any} */ (await getSetting(settings, KEY)) ?? {};
	return {
		kraken:
			v.kraken && typeof v.kraken.raw === 'string' ? { raw: v.kraken.raw.slice(0, 200) } : null,
		wallets:
			v.wallets && typeof v.wallets === 'object'
				? Object.fromEntries(
						Object.entries(v.wallets).filter(([, n]) => Number.isInteger(n) && Number(n) > 0)
					)
				: {}
	};
}

/**
 * @param {import('../store/repository.js').Collection} settings
 * @param {(a: Alerts) => Alerts} change
 */
export async function updateAlerts(settings, change) {
	await setSetting(settings, KEY, change(await loadAlerts(settings)));
}

/** A Kraken error that means the key: refused, wrong, or without the permissions. @param {string} message */
export const krakenKeyProblem = (message) =>
	/EAPI:Invalid (nonce|key|signature)|EGeneral:Permission denied|EAPI:Bad request/i.test(message);
