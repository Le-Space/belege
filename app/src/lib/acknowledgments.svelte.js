// The open books' confirmations (acknowledgments.js), for the places that ask:
// read once per books, written through to the sealed settings. A reader of
// someone else's books cannot write their settings: then the confirmation
// holds for this page load only.
import {
	ACK_KINDS,
	addAcknowledgment,
	isCurrent,
	readAcknowledgment,
	recordAcknowledgment
} from './acknowledgments.js';
import { currentStore } from './session.svelte.js';

/** @typedef {import('./acknowledgments.js').AckKind} AckKind */

export const acks = $state({
	/** @type {boolean} */
	loaded: false,
	/** @type {Partial<Record<AckKind, import('./acknowledgments.js').AckRecord>>} */
	records: {}
});

/** @type {unknown} the store the records were read from */
let readFrom = null;
/** @type {Promise<void> | null} */
let reading = null;

/** Read the confirmations of the open books, once per books. */
export function loadAcknowledgments() {
	const store = currentStore();
	if (!store) return Promise.resolve();
	if (readFrom === store && reading) return reading;
	readFrom = store;
	acks.loaded = false;
	acks.records = {};
	reading = (async () => {
		/** @type {typeof acks.records} */
		const records = {};
		for (const kind of ACK_KINDS) {
			try {
				records[kind] = await readAcknowledgment(store.settings, kind);
			} catch {
				// Unreadable: asked again, never taken as confirmed.
			}
		}
		if (readFrom !== store) return;
		acks.records = records;
		acks.loaded = true;
	})();
	return reading;
}

/** @param {AckKind} kind whether the open books hold a confirmation of the current text */
export const acknowledged = (kind) => isCurrent(acks.records[kind], kind);

/**
 * Confirm `kind` for the open books.
 *
 * @param {AckKind} kind
 * @param {Record<string, unknown>} [extra]
 * @returns {Promise<import('./acknowledgments.js').AckEntry>}
 */
export async function acknowledge(kind, extra = {}) {
	const store = currentStore();
	let done;
	if (store) {
		try {
			done = await recordAcknowledgment(store.settings, kind, extra);
		} catch {
			// Not writable (a reader): for this page load.
		}
	}
	done ??= addAcknowledgment(acks.records[kind], kind, extra);
	acks.records = { ...acks.records, [kind]: done.record };
	return done.entry;
}

/** The consent screen as accepted, into the open books, once per version. */
export async function recordConsent() {
	await loadAcknowledgments();
	if (!acks.loaded || acknowledged('consent')) return;
	await acknowledge('consent');
}
