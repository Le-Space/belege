// What came and went between own devices (device sync, #123): one line per
// entry, newest first – when, which device, which book, what it is (a
// receipt's file name, size and date; a payment's counterparty and amount).
// Kept on this device only, never in the books: every device's log would
// replicate to the others and make entries of its own there. Sealed under a
// key of its own from the passkey (`SYNC_LOG_INFO`), in localStorage, the
// newest `MAX` lines.
//
// "Here" and "there": every device writes with the passkey's identity, so an
// entry does not say where it was made. The collections know which entries
// this session wrote (repository.js `wroteHere`); the others came by sync,
// from the device the database last exchanged heads with (OrbitDB's `join`).

/** The HKDF info of the log's key: a key of its own. */
export const SYNC_LOG_INFO = 'belege sync log v1';
/** Where the sealed log lies in this browser. */
export const SYNC_LOG_KEY = 'belege.sync-log';
/** The newest this many lines are kept. */
export const MAX = 300;

/**
 * @typedef {object} SyncLine
 * @property {number} at ms
 * @property {'in' | 'out'} direction in: came from another device; out: written here, for the others
 * @property {string} collection
 * @property {string | null} peerId the other device, where known
 * @property {'new' | 'changed' | 'deleted'} op
 * @property {string} id the record's
 * @property {{ fileName?: string, size?: number, date?: string, counterparty?: string, amountCents?: number, key?: string }} what
 */

/**
 * What an entry is, in a few facts: enough to recognise it, nothing more.
 *
 * @param {string} collection
 * @param {{ payload?: { op?: string, key?: string, value?: any } }} entry
 * @returns {Pick<SyncLine, 'op' | 'id' | 'what'>}
 */
export function describeEntry(collection, entry) {
	const value = entry?.payload?.value ?? {};
	const op =
		entry?.payload?.op === 'DEL' || value.deleted === true
			? 'deleted'
			: value.createdAt && value.createdAt === value.updatedAt
				? 'new'
				: 'changed';
	/** @type {SyncLine['what']} */
	const what = {};
	if (collection === 'receipts') {
		if (value.fileName) what.fileName = String(value.fileName);
		if (Number.isFinite(value.size)) what.size = Number(value.size);
		// As the receipts page dates it (receipts/view.js `receiptDate`), else when it came.
		const date = value.documentDate ?? value.receivedAt ?? value.createdAt;
		if (date) what.date = String(date).slice(0, 10);
	} else if (collection === 'transactions') {
		if (value.counterparty) what.counterparty = String(value.counterparty).slice(0, 80);
		if (Number.isSafeInteger(value.amountCents)) what.amountCents = value.amountCents;
		if (value.bookedOn) what.date = String(value.bookedOn).slice(0, 10);
	} else if (collection === 'settings' && value.key) {
		what.key = String(value.key);
	}
	return { op, id: String(value.id ?? entry?.payload?.key ?? ''), what };
}

/**
 * The log, sealed in this browser.
 *
 * @param {{ seal: (bytes: Uint8Array) => Promise<Uint8Array>, open: (bytes: Uint8Array) => Promise<Uint8Array> }} sealer
 * @param {{ storage?: Storage, max?: number, saveAfter?: number }} [options]
 */
export function createSyncLog(
	sealer,
	{ storage = globalThis.localStorage, max = MAX, saveAfter = 1000 } = {}
) {
	/** @type {SyncLine[]} */
	let lines = [];
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	const b64 = (/** @type {Uint8Array} */ bytes) => btoa(String.fromCharCode(...bytes));
	const unb64 = (/** @type {string} */ text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

	async function save() {
		try {
			const sealed = await sealer.seal(new TextEncoder().encode(JSON.stringify(lines)));
			storage?.setItem(SYNC_LOG_KEY, b64(sealed));
		} catch {
			// No room, or no storage: the log of this session stays in memory.
		}
	}

	return {
		/** What this browser kept, opened. */
		async load() {
			try {
				const kept = storage?.getItem(SYNC_LOG_KEY);
				if (kept) {
					const parsed = JSON.parse(new TextDecoder().decode(await sealer.open(unb64(kept))));
					if (Array.isArray(parsed)) lines = parsed.slice(0, max);
				}
			} catch {
				// Another passkey's, or broken: started anew.
				lines = [];
			}
			return lines;
		},
		/** @param {SyncLine} line */
		add(line) {
			lines = [line, ...lines].slice(0, max);
			clearTimeout(timer);
			timer = setTimeout(save, saveAfter);
			return lines;
		},
		list: () => lines,
		async clear() {
			lines = [];
			clearTimeout(timer);
			try {
				storage?.removeItem(SYNC_LOG_KEY);
			} catch {
				// Nothing to clear.
			}
		},
		flush: save
	};
}
