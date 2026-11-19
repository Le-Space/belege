// Einstellungen in parts: each has a page of its own under
// /einstellungen/<id>, and a tile on the overview that says where it stands.
// Pure: what a tile says is read off the books' state handed in.

import { cleanChart } from '../booking/chart.js';
import { cleanMatchingSettings } from '../matching/classify.js';

/** The parts, in the overview's order. `key`: its name in the catalogue (`settings.nav.*`). */
export const SETTINGS_SECTIONS = /** @type {const} */ ([
	{ id: 'einrichtung', key: 'setup', initials: '✓' },
	{ id: 'firma', key: 'company', initials: 'Fa' },
	{ id: 'abgleich', key: 'matching', initials: 'Ab' },
	{ id: 'gelerntes', key: 'learned', initials: 'Ge' },
	{ id: 'buchhaltung', key: 'books', initials: 'Bu' },
	{ id: 'kontenplan', key: 'chart', initials: 'Kp' },
	{ id: 'reisende', key: 'travellers', initials: 'Re' },
	{ id: 'schluessel', key: 'keys', initials: 'Sc' },
	{ id: 'speicher', key: 'storage', initials: 'Sp' }
]);

/** @typedef {(typeof SETTINGS_SECTIONS)[number]['id']} SettingsSectionId */

/** @param {string} id @returns {id is SettingsSectionId} */
export const isSettingsSection = (id) => SETTINGS_SECTIONS.some((s) => s.id === id);

/**
 * An anchor of the one long page Einstellungen used to be → the part it is
 * in now, so that old links (`/einstellungen#buchhaltung`) still arrive.
 * `#rekey` is a place inside "Schlüssel".
 *
 * @param {string} hash with or without `#`
 * @returns {{ id: SettingsSectionId, hash: string } | null}
 */
export function sectionOfAnchor(hash) {
	const name = hash.replace(/^#/, '');
	if (name === 'rekey') return { id: 'schluessel', hash: '#rekey' };
	return isSettingsSection(name) ? { id: name, hash: '' } : null;
}

/**
 * What each tile says of its part: a catalogue key under
 * `settings.tile.*` with its numbers, and whether it wants attention.
 *
 * @param {object} books
 * @param {Record<string, any>[]} books.accounts
 * @param {Record<string, any>[]} books.partners
 * @param {unknown} books.matchingSettings
 * @param {unknown} books.chart
 * @returns {Partial<Record<SettingsSectionId, { key: string, params?: Record<string, number>, warn?: boolean }>>}
 */
export function tileStates({ accounts, partners, matchingSettings, chart }) {
	const matching = cleanMatchingSettings(matchingSettings);
	const live = accounts.filter((a) => !a.deleted);
	const missing = live.filter((a) => !String(a.ledgerAccount ?? '').trim()).length;
	const learned = partners.filter((p) => !p.deleted && (p.aliases ?? []).length).length;
	const plan = cleanChart(chart);
	return {
		firma: matching.companyNames.length
			? { key: 'companySet', params: { count: matching.companyNames.length } }
			: { key: 'companyMissing', warn: true },
		abgleich: { key: 'rules', params: { count: matching.rules.length } },
		gelerntes: { key: 'learned', params: { count: learned } },
		buchhaltung: !live.length
			? { key: 'noAccounts' }
			: missing
				? { key: 'ledgerMissing', params: { count: missing, total: live.length }, warn: true }
				: { key: 'ledgerDone', params: { total: live.length } },
		kontenplan: plan
			? { key: 'chart', params: { count: plan.accounts.length } }
			: { key: 'chartNone' }
	};
}
