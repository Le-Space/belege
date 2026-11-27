// What a person confirmed, and when (#1053): before a DATEV export, that
// there is no backup and no second device, that the recovery words are theirs
// alone to keep, and the consent screen. Each goes into the books' sealed
// `settings` collection – never localStorage – with the version of the text
// it confirmed and the time, so it travels with every backup and every own
// device. Le Space has no server and keeps no copy; the notice in the export
// ZIP is the copy that leaves the books.
//
// A text changes → its version here goes up, and the place asks again.
import { CONSENT_VERSION } from './consent.js';
import { getSetting, setSetting } from './store/settings.js';

/** @typedef {'export' | 'no-backup' | 'onboarding' | 'recovery-words' | 'consent'} AckKind */

/** The version of each text, as it is confirmed. */
export const ACK_TEXTS = /** @type {const} */ ({
	export: 'export-1',
	// The banner on Home, and the same sentence once at the first start.
	'no-backup': 'no-backup-1',
	onboarding: 'no-backup-1',
	'recovery-words': 'keys-1',
	consent: `consent-${CONSENT_VERSION}`
});

/** @type {AckKind[]} */
export const ACK_KINDS = /** @type {AckKind[]} */ (Object.keys(ACK_TEXTS));

/** How many confirmations of one kind are kept, newest first. */
export const ACK_KEEP = 100;

/** @param {AckKind} kind */
export const ackKey = (kind) => `ack/${kind}`;

/**
 * @typedef {object} AckEntry
 * @property {string} text the text's version (ACK_TEXTS)
 * @property {string} at ISO time of the confirmation
 * @property {string} [month] the exported month, YYYY-MM
 * @property {string} [app] the app's release
 */

/** @typedef {{ entries: AckEntry[] }} AckRecord */

/** Only these, and only short plain strings: no amount, no name, no purpose. */
const EXTRA = /** @type {const} */ (['month', 'app']);

/** @param {Record<string, unknown>} extra */
function cleanExtra(extra) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const key of EXTRA) {
		const v = extra[key];
		if (typeof v === 'string' && v && v.length <= 40) out[key] = v;
	}
	return out;
}

/**
 * The stored record, cleaned: entries newest first.
 *
 * @param {unknown} value
 * @returns {AckRecord}
 */
export function cleanAckRecord(value) {
	const entries = /** @type {any} */ (value)?.entries;
	return {
		entries: Array.isArray(entries)
			? entries.filter(
					(e) => e && typeof e.text === 'string' && typeof e.at === 'string' && e.at.length
				)
			: []
	};
}

/**
 * Whether the newest confirmation of `kind` is of the text as it is now.
 *
 * @param {unknown} value the stored record
 * @param {AckKind} kind
 */
export function isCurrent(value, kind) {
	return cleanAckRecord(value).entries[0]?.text === ACK_TEXTS[kind];
}

/**
 * Add one confirmation, newest first.
 *
 * @param {unknown} value the stored record
 * @param {AckKind} kind
 * @param {Record<string, unknown>} [extra]
 * @param {Date} [now]
 * @returns {{ record: AckRecord, entry: AckEntry }}
 */
export function addAcknowledgment(value, kind, extra = {}, now = new Date()) {
	const text = ACK_TEXTS[kind];
	if (!text) throw new Error(`Unknown acknowledgment: ${kind}`);
	/** @type {AckEntry} */
	const entry = { text, at: now.toISOString(), ...cleanExtra(extra) };
	return {
		entry,
		record: { entries: [entry, ...cleanAckRecord(value).entries].slice(0, ACK_KEEP) }
	};
}

/**
 * @param {import('./store/repository.js').Collection} settings the sealed settings
 * @param {AckKind} kind
 * @returns {Promise<AckRecord>}
 */
export async function readAcknowledgment(settings, kind) {
	return cleanAckRecord(await getSetting(settings, ackKey(kind)));
}

/**
 * Keep a confirmation in the sealed settings.
 *
 * @param {import('./store/repository.js').Collection} settings the sealed settings
 * @param {AckKind} kind
 * @param {Record<string, unknown>} [extra]
 * @param {Date} [now]
 * @returns {Promise<{ record: AckRecord, entry: AckEntry }>}
 */
export async function recordAcknowledgment(settings, kind, extra = {}, now = new Date()) {
	const done = addAcknowledgment(await getSetting(settings, ackKey(kind)), kind, extra, now);
	await setSetting(settings, ackKey(kind), done.record);
	return done;
}
