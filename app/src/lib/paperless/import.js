// Paperless-ngx as a receipt source (issue #318), the app's part. The bridge
// lists what Paperless added since the last fetch, with its OCR text, and hands
// out each document's original file (bridge/src/paperless.js). Here the new
// ones become receipts with source 'paperless' and sourceRef `paperless:<id>`.
//
// No duplicates:
//   - a document whose sourceRef is on a record (a soft-deleted one too) is
//     not even asked for;
//   - its bytes already on a record – the same PDF came by mail – make it a
//     duplicate (receipts/import.js), since the bridge hands out the original;
//   - a document carrying a tag the person named is skipped: the tag a
//     Paperless mail rule sets, when Belege still reads the mailbox itself.
//
// Paperless' OCR text is kept on the receipt (`paperlessContent`), sealed like
// everything else, for scans and photos that have no text layer of their own
// (receipts/extract.js). It is data for the reading, never an instruction.
// Correspondent, document type and tags are shown and passed as hints; the
// amount, date and vendor still come from Belege's own reading.

import { recordEvent } from '../activity/events.js';
import { importFile } from '../receipts/import.js';
import { getSetting, setSetting } from '../store/settings.js';

export const PAPERLESS_SETTING = 'paperless';
const PREFIX = 'paperless:';

/** @param {number | string} id */
export const paperlessSourceRef = (id) => `${PREFIX}${id}`;

/**
 * @typedef {object} PaperlessSettings
 * @property {string | null} since ISO: the newest `added` fetched so far
 * @property {string[]} skipTags documents with one of these tags are not taken
 * @property {boolean} mailToo Belege still fetches mail itself while Paperless is on
 */

/** @param {unknown} raw @returns {PaperlessSettings} */
export function cleanPaperlessSettings(raw) {
	const r = /** @type {Record<string, any>} */ (raw && typeof raw === 'object' ? raw : {});
	return {
		since: typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : null,
		skipTags: Array.isArray(r.skipTags)
			? [...new Set(r.skipTags.map((t) => String(t).trim()).filter(Boolean))]
			: [],
		mailToo: r.mailToo === true
	};
}

/** @param {import('../store/repository.js').Collection} settings */
export async function loadPaperlessSettings(settings) {
	return cleanPaperlessSettings(await getSetting(settings, PAPERLESS_SETTING));
}

/**
 * @param {import('../store/repository.js').Collection} settings
 * @param {Partial<PaperlessSettings>} change
 */
export async function savePaperlessSettings(settings, change) {
	const next = cleanPaperlessSettings({ ...(await loadPaperlessSettings(settings)), ...change });
	await setSetting(settings, PAPERLESS_SETTING, next);
	return next;
}

/** "Rechnung, aus-Mail" → the tags, trimmed, without empties. @param {string} text */
export const parseTags = (text) =>
	String(text ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

/**
 * @typedef {object} PaperlessDocument as GET /paperless/documents lists it
 * @property {number} id
 * @property {string} title
 * @property {string | null} created YYYY-MM-DD
 * @property {string | null} added ISO
 * @property {string | null} correspondent
 * @property {string | null} documentType
 * @property {string[]} tags
 * @property {string | null} originalFileName
 * @property {string | null} mimeType
 * @property {string} content the OCR text
 */

/**
 * @typedef {{ new: number, known: number, duplicate: number, skipped: number, unsupported: number }} PaperlessCounts
 */

/**
 * The documents of a list into the books.
 *
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('../receipts/blob-store.js').BlobStore} params.blobs
 * @param {{ paperlessDocument: (id: number) => Promise<Uint8Array> }} params.client
 * @param {PaperlessDocument[]} params.documents
 * @param {string[]} [params.skipTags]
 * @param {import('../store/repository.js').StoredRecord[]} [params.created] the new records are pushed here
 * @returns {Promise<PaperlessCounts>}
 */
export async function importPaperlessDocuments({
	receipts,
	blobs,
	client,
	documents,
	skipTags = [],
	created
}) {
	const all = await receipts.list({ includeDeleted: true });
	const seen = {
		sha: new Set(all.map((r) => r.sha256).filter(Boolean)),
		refs: new Set(all.map((r) => r.sourceRef).filter(Boolean))
	};
	const skip = new Set(skipTags.map((t) => t.toLowerCase()));
	/** @type {PaperlessCounts} */
	const counts = { new: 0, known: 0, duplicate: 0, skipped: 0, unsupported: 0 };
	for (const doc of documents) {
		const sourceRef = paperlessSourceRef(doc.id);
		if (seen.refs.has(sourceRef)) {
			counts.known++;
			continue;
		}
		if ((doc.tags ?? []).some((t) => skip.has(String(t).toLowerCase()))) {
			counts.skipped++;
			continue;
		}
		let bytes;
		try {
			bytes = await client.paperlessDocument(doc.id);
		} catch (error) {
			// Neither a PDF nor an image, nor an archive PDF of it: not a receipt here.
			if (/** @type {any} */ (error)?.code === 'PAPERLESS_NOT_A_RECEIPT') {
				counts.unsupported++;
				continue;
			}
			throw error;
		}
		const { outcome, record } = await importFile({
			receipts,
			blobs,
			bytes,
			fileName: doc.originalFileName || `paperless-${doc.id}.pdf`,
			source: 'paperless',
			sourceRef,
			fields: {
				from: doc.correspondent ?? null,
				subject: doc.title || null,
				receivedAt: doc.created ?? (doc.added ? doc.added.slice(0, 10) : null),
				paperless: {
					id: doc.id,
					title: doc.title,
					created: doc.created,
					added: doc.added,
					correspondent: doc.correspondent,
					documentType: doc.documentType,
					tags: doc.tags ?? []
				},
				paperlessContent: doc.content ?? ''
			},
			seen
		});
		if (record) created?.push(record);
		if (outcome === 'new') counts.new++;
		else if (outcome === 'duplicate') counts.duplicate++;
		else counts.unsupported++;
	}
	return counts;
}

/** The newest `added` of a list, or the one before. @param {PaperlessDocument[]} documents @param {string | null} before */
export function newestAdded(documents, before) {
	let best = before;
	for (const d of documents) {
		if (d.added && (!best || Date.parse(d.added) > Date.parse(best))) best = d.added;
	}
	return best;
}

/**
 * "Aus Paperless holen": what Paperless added since the last fetch, into the
 * books; the moment is remembered only once all of it is in.
 *
 * @param {object} params
 * @param {{ receipts: import('../store/repository.js').Collection, settings: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {import('../receipts/blob-store.js').BlobStore} params.blobs
 * @param {{ paperlessDocuments: (since: string | null) => Promise<PaperlessDocument[]>, paperlessDocument: (id: number) => Promise<Uint8Array> }} params.client
 * @returns {Promise<{ documents: number, counts: PaperlessCounts, createdIds: string[] }>}
 */
export async function fetchPaperless({ store, blobs, client }) {
	const settings = await loadPaperlessSettings(store.settings);
	const documents = await client.paperlessDocuments(settings.since);
	/** @type {import('../store/repository.js').StoredRecord[]} */
	const created = [];
	const counts = await importPaperlessDocuments({
		receipts: store.receipts,
		blobs,
		client,
		documents,
		skipTags: settings.skipTags,
		created
	});
	const since = newestAdded(documents, settings.since);
	if (since !== settings.since) await savePaperlessSettings(store.settings, { since });
	await recordEvent(store.events, 'paperless-fetch', { documents: documents.length, ...counts });
	return { documents: documents.length, counts, createdIds: created.map((r) => r.id) };
}
