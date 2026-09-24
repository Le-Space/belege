// Receipts into the sealed store: from the bridge's mail listing, from an
// upload, from a shared folder. One record per file, the file itself sealed
// in the blockstore (blob-store.js).
//
// No duplicates: a file whose plaintext SHA-256 is already on a record (a
// soft-deleted one too – deleting a receipt and fetching mail again does not
// bring it back) is skipped. A mail part already imported is skipped before
// its bytes are even fetched (by `sourceRef`).
//
// A mail whose sender did not pass DKIM/SPF (and that is not our own, from
// Sent) comes in as `rückfrage`: shown with a warning, neither previewed nor
// sent to the LLM until someone confirms it (docs/phase-0.md: look-alike
// phishing, PDFs as a malware vector).

import { recordEvent } from '../activity/events.js';
import { sha256Hex } from './blob-store.js';

/** @typedef {'mail' | 'upload' | 'folder'} ReceiptSource */
/** @typedef {'neu' | 'ausgelesen' | 'rückfrage' | 'zugeordnet' | 'ignoriert'} ReceiptStatus */

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * What the bytes are, whatever the name or the declared type say.
 *
 * @param {Uint8Array} bytes
 * @returns {{ kind: 'pdf' | 'image' | 'other', mime: string | null }}
 */
export function sniff(bytes) {
	const b = bytes ?? new Uint8Array();
	/** @param {number[]} sig @param {number} [offset] */
	const starts = (sig, offset = 0) =>
		b.length >= sig.length + offset && sig.every((x, i) => b[i + offset] === x);
	const head = new TextDecoder('latin1').decode(b.subarray(0, 1024));
	if (head.includes('%PDF-')) return { kind: 'pdf', mime: 'application/pdf' };
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return { kind: 'image', mime: 'image/png' };
	if (starts([0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
	if (starts([0x47, 0x49, 0x46, 0x38])) return { kind: 'image', mime: 'image/gif' };
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
		return { kind: 'image', mime: 'image/webp' };
	}
	return { kind: 'other', mime: null };
}

/**
 * Whether a receipt needs a person's yes before it is opened or sent anywhere.
 *
 * @param {Record<string, any>} record source, authVerdict, outgoing, confirmedByUser
 */
export function needsConfirmation(record) {
	return (
		record.source === 'mail' &&
		record.authVerdict !== 'pass' &&
		!record.outgoing &&
		record.confirmedByUser !== true
	);
}

/**
 * @param {import('../store/repository.js').Collection} receipts
 */
async function known(receipts) {
	const all = await receipts.list({ includeDeleted: true });
	return {
		sha: new Set(all.map((r) => r.sha256).filter(Boolean)),
		refs: new Set(all.map((r) => r.sourceRef).filter(Boolean)),
		/** @type {Map<string, import('../store/repository.js').StoredRecord>} */
		byRef: new Map(all.filter((r) => r.sourceRef && !r.deleted).map((r) => [r.sourceRef, r]))
	};
}

/**
 * A mail fetched again whose sender verdict the bridge now reports otherwise
 * (a bridge update fixed its check, say): the stored verdict follows, unless
 * the person already decided – confirmed the sender, or ignored the receipt.
 * A verdict that now passes lifts the hold on reading it; one that no longer
 * does puts a receipt not yet read on hold.
 *
 * @param {import('../store/repository.js').Collection} receipts
 * @param {import('../store/repository.js').StoredRecord | undefined} record
 * @param {{ authVerdict: string, outgoing: boolean }} fields as the bridge reports them now
 * @param {import('../store/repository.js').Collection} [events]
 * @returns {Promise<boolean>} whether the record changed
 */
export async function refreshVerdict(receipts, record, fields, events) {
	if (!record || record.source !== 'mail') return false;
	if (record.confirmedByUser === true || record.status === 'ignoriert') return false;
	if (record.authVerdict === fields.authVerdict && Boolean(record.outgoing) === fields.outgoing) {
		return false;
	}
	const next = { ...record, authVerdict: fields.authVerdict, outgoing: fields.outgoing };
	const held = needsConfirmation(next);
	const status =
		record.status === 'rückfrage' && !held
			? record.extraction
				? 'ausgelesen'
				: 'neu'
			: record.status === 'neu' && held
				? 'rückfrage'
				: record.status;
	await receipts.put({ ...next, status });
	await recordEvent(events, 'sender-verdict', {
		receiptId: record.id,
		was: record.outgoing ? 'outgoing' : (record.authVerdict ?? 'none'),
		now: fields.outgoing ? 'outgoing' : fields.authVerdict,
		released: record.status === 'rückfrage' && !held
	});
	return true;
}

/**
 * One file (upload, folder, or a mail attachment's bytes).
 *
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {Uint8Array} params.bytes
 * @param {string} params.fileName
 * @param {ReceiptSource} params.source
 * @param {string} params.sourceRef
 * @param {Record<string, any>} [params.fields] from, subject, receivedAt, authVerdict, …
 * @param {{ sha: Set<string>, refs: Set<string> }} [params.seen] shared across a batch
 * @returns {Promise<{ record: import('../store/repository.js').StoredRecord | null, outcome: 'new' | 'duplicate' | 'unsupported' | 'too-large' }>}
 */
export async function importFile({
	receipts,
	blobs,
	bytes,
	fileName,
	source,
	sourceRef,
	fields = {},
	seen
}) {
	if (bytes.length > MAX_FILE_BYTES) return { record: null, outcome: 'too-large' };
	const { kind, mime } = sniff(bytes);
	if (kind === 'other' || !mime) return { record: null, outcome: 'unsupported' };
	const index = seen ?? (await known(receipts));
	const sha256 = await sha256Hex(bytes);
	if (index.sha.has(sha256)) {
		index.refs.add(sourceRef);
		return { record: null, outcome: 'duplicate' };
	}
	const fileCid = await blobs.put(bytes);
	const record = await receipts.put({
		source,
		sourceRef,
		receivedAt: null,
		from: null,
		subject: null,
		authVerdict: null,
		outgoing: false,
		confirmedByUser: false,
		excerpt: '',
		...fields,
		fileCid,
		fileName,
		mime,
		size: bytes.length,
		sha256,
		extraction: null,
		extractionModel: null,
		extractionError: null,
		status: needsConfirmation({ source, ...fields }) ? 'rückfrage' : 'neu'
	});
	index.sha.add(sha256);
	index.refs.add(sourceRef);
	return { record, outcome: 'new' };
}

/**
 * @typedef {{ new: number, duplicate: number, skipped: number, unsupported: number, verdicts: number }} MailCounts
 * `verdicts`: receipts already here whose sender verdict was brought up to date
 */

/**
 * The accounting mails the bridge listed: every PDF or image attachment one
 * receipt; a mail with neither one receipt of its text (an order
 * confirmation, a "your invoice is online" mail).
 *
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {{ mailAttachment: (id: string, part: string) => Promise<Uint8Array> }} params.client
 * @param {any[]} params.messages from GET /mail/messages (or hits of /mail/search)
 * @param {import('../store/repository.js').StoredRecord[]} [params.created] the new records are pushed here
 * @param {import('../store/repository.js').Collection} [params.events] for "Absenderprüfung aktualisiert"
 * @returns {Promise<MailCounts>}
 */
export async function importMailMessages({ receipts, blobs, client, messages, created, events }) {
	const seen = await known(receipts);
	/** @type {MailCounts} */
	const counts = { new: 0, duplicate: 0, skipped: 0, unsupported: 0, verdicts: 0 };
	/** @param {string} sourceRef @param {{ authVerdict: string, outgoing: boolean }} fields */
	const again = async (sourceRef, fields) => {
		counts.skipped++;
		if (await refreshVerdict(receipts, seen.byRef.get(sourceRef), fields, events)) {
			counts.verdicts++;
		}
	};
	for (const m of messages) {
		const fields = {
			mailId: m.id,
			receivedAt: m.receivedAt ?? m.date ?? null,
			from: m.from?.name ? `${m.from.name} <${m.from.address}>` : (m.from?.address ?? null),
			subject: m.subject ?? '',
			authVerdict: m.auth?.verdict ?? 'none',
			outgoing: Boolean(m.outgoing),
			excerpt: String(m.excerpt ?? '').slice(0, 2000)
		};
		const files = (m.attachments ?? []).filter(
			(/** @type {any} */ a) => a.kind === 'pdf' || a.kind === 'image'
		);
		if (files.length === 0) {
			const sourceRef = `${m.id}#text`;
			if (seen.refs.has(sourceRef)) {
				await again(sourceRef, fields);
				continue;
			}
			if (!fields.excerpt.trim()) {
				counts.unsupported++;
				continue;
			}
			const record = await receipts.put({
				source: 'mail',
				sourceRef,
				...fields,
				fileCid: null,
				fileName: null,
				mime: 'text/plain',
				size: fields.excerpt.length,
				sha256: null,
				extraction: null,
				extractionModel: null,
				extractionError: null,
				confirmedByUser: false,
				status: needsConfirmation({ source: 'mail', ...fields }) ? 'rückfrage' : 'neu'
			});
			created?.push(record);
			seen.refs.add(sourceRef);
			counts.new++;
			continue;
		}
		for (const a of files) {
			const sourceRef = `${m.id}#${a.part}`;
			if (seen.refs.has(sourceRef)) {
				await again(sourceRef, fields);
				continue;
			}
			const bytes = await client.mailAttachment(m.id, a.part);
			const { outcome, record } = await importFile({
				receipts,
				blobs,
				bytes,
				fileName: a.name,
				source: 'mail',
				sourceRef,
				fields,
				seen
			});
			if (record) created?.push(record);
			if (outcome === 'new') counts.new++;
			else if (outcome === 'duplicate') counts.duplicate++;
			else counts.unsupported++;
		}
	}
	return counts;
}

/**
 * "E-Mails abrufen": the accounting mails of [since, until) from the bridge,
 * into the store, and one event with the counts.
 *
 * @param {object} params
 * @param {{ receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {{ mailMessages: (since: string, until: string | null) => Promise<{ messages: any[] }>, mailAttachment: (id: string, part: string) => Promise<Uint8Array> }} params.client
 * @param {string} params.since YYYY-MM-DD
 * @param {string | null} params.until YYYY-MM-DD, exclusive, or open
 * @returns {Promise<{ mails: number, counts: MailCounts }>}
 */
export async function fetchAccountingMail({ store, blobs, client, since, until }) {
	const { messages } = await client.mailMessages(since, until);
	const counts = await importMailMessages({
		receipts: store.receipts,
		blobs,
		client,
		messages,
		events: store.events
	});
	await recordEvent(store.events, 'mail-fetch', {
		since,
		until,
		mails: messages.length,
		...counts
	});
	return { mails: messages.length, counts };
}

/**
 * Files from an upload or a folder.
 *
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {{ name: string, path?: string, bytes: () => Promise<Uint8Array> }[]} params.files
 * @param {'upload' | 'folder'} params.source
 * @param {boolean} [params.skipKnown] skip a path already imported without reading it (the folder watch)
 * @param {import('../store/repository.js').StoredRecord[]} [params.created] the new records are pushed here
 * @param {import('../store/repository.js').Collection} [params.events] one event when anything was read
 * @returns {Promise<{ new: number, duplicate: number, unsupported: number, known: number }>}
 */
export async function importFiles({
	receipts,
	blobs,
	files,
	source,
	skipKnown = false,
	created,
	events
}) {
	const seen = await known(receipts);
	const counts = { new: 0, duplicate: 0, unsupported: 0, known: 0 };
	for (const f of files) {
		const sourceRef = `${source}:${f.path ?? f.name}`;
		if (skipKnown && seen.refs.has(sourceRef)) {
			counts.known++;
			continue;
		}
		const bytes = await f.bytes();
		const { outcome, record } = await importFile({
			receipts,
			blobs,
			bytes,
			fileName: f.name,
			source,
			sourceRef,
			seen
		});
		if (record) created?.push(record);
		if (outcome === 'new') counts.new++;
		else if (outcome === 'duplicate') counts.duplicate++;
		else counts.unsupported++;
	}
	if (counts.new + counts.duplicate + counts.unsupported > 0) {
		await recordEvent(events, 'file-import', { source, files: files.length, ...counts });
	}
	return counts;
}
