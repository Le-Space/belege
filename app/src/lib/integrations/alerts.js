// What the last run of an integration left for the person (issue #152): a
// refused Kraken key, wallets whose sync left hints. Kept in the sealed
// settings (`integrationAlerts`) so the overview's "Braucht dich" knows it
// without running anything. Set by the sync that found it, cleared by the
// next one that did not.
//
// Also the end of each Enable Banking consent (#224, step 5), as the bridge
// last told it: the bank and the day, nothing else. Written whenever the
// Bank page or the return page read the links.
import { getSetting, setSetting } from '../store/settings.js';

const KEY = 'integrationAlerts';

/**
 * @typedef {object} Alerts
 * @property {{ raw: string } | null} kraken the last Kraken sync failed
 * @property {Record<string, number>} wallets per wallet id: hints its last sync left
 * @property {ConsentEnd[]} enablebanking the end of each Enable Banking consent
 */

/**
 * @typedef {object} ConsentEnd
 * @property {string} bank
 * @property {string} country
 * @property {'business' | 'personal'} psuType
 * @property {string} validUntil ISO
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
				: {},
		enablebanking: (Array.isArray(v.enablebanking) ? v.enablebanking : [])
			.filter(
				(/** @type {any} */ c) =>
					c &&
					typeof c.bank === 'string' &&
					typeof c.validUntil === 'string' &&
					Number.isFinite(Date.parse(c.validUntil))
			)
			.slice(0, 20)
			.map((/** @type {any} */ c) => ({
				bank: c.bank.slice(0, 120),
				country: String(c.country ?? '').slice(0, 2),
				psuType: c.psuType === 'personal' ? 'personal' : 'business',
				validUntil: c.validUntil
			}))
	};
}

/**
 * Keep the consents' ends the bridge just told.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {{ bank: string, country: string, psuType: 'business' | 'personal', validUntil: string | null }[]} links
 */
export async function rememberConsents(settings, links) {
	const enablebanking = links
		.filter((l) => l.validUntil)
		.map((l) => ({
			bank: l.bank,
			country: l.country,
			psuType: l.psuType,
			validUntil: /** @type {string} */ (l.validUntil)
		}));
	await updateAlerts(settings, (a) => ({ ...a, enablebanking }));
}

/** Days before its end a consent asks to be renewed. */
export const CONSENT_WARN_DAYS = 14;

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
