// Paperless-ngx as a receipt source (issue #318), read only.
//
// People who run Paperless keep their receipts there: scanned, OCR'd, tagged,
// often fed by Paperless' own mail rules. The bridge lists what Paperless has
// added since a moment, with the OCR text, and hands out one document's bytes.
// The app decides what is new and imports it like any other receipt.
//
// The API token lives in the keychain (service `belege-bridge`, account
// `paperless`), put there by `pnpm setup:paperless`, and goes out only as the
// Authorization header to the configured Paperless – which is https, or http on
// this machine (config.js `paperlessBaseUrl`). No redirect is followed: a token
// never travels to a host the person did not name.
//
// The original file is handed out, not Paperless' archive PDF: a mail
// attachment and its Paperless copy then have the same bytes, and the app's
// import drops the second one by its hash. Only where the original is neither
// a PDF nor an image (a mail kept as .eml, an office file) does the archive PDF
// stand in. At most 15 MB, sniffed by its bytes, whatever Paperless calls it.
//
// The OCR text is data for the receipt's reading, never an instruction, and is
// not logged. Correspondent, document type and tags are names for the app to
// show and filter by, nothing more.

import { MAX_INVOICE_BYTES, isPdf } from './portals/pdf.js';

/** Pages of this many documents; Paperless allows up to 100 000, 100 keeps answers small. */
export const PAGE_SIZE = 100;
/** A list stops after this many pages (10 000 documents) rather than run on. */
const MAX_PAGES = 100;
/** The OCR text of one document, at most (the extraction reads no more either). */
export const MAX_CONTENT = 30_000;
const LIST_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 120_000;

export class PaperlessError extends Error {
	/** @param {string} message @param {string} code @param {number} [status] */
	constructor(message, code, status = 502) {
		super(message);
		this.name = 'PaperlessError';
		this.code = code;
		this.status = status;
	}
}

/**
 * @typedef {object} PaperlessDocument
 * @property {number} id
 * @property {string} title
 * @property {string | null} created YYYY-MM-DD, the document's own date as Paperless has it
 * @property {string | null} added ISO, when it came into Paperless
 * @property {string | null} correspondent
 * @property {string | null} documentType
 * @property {string[]} tags
 * @property {string | null} originalFileName
 * @property {string | null} mimeType of the original, as Paperless says
 * @property {string} content the OCR text, at most MAX_CONTENT characters
 */

/**
 * An image the app takes, by its first bytes: its type, or null.
 *
 * @param {Uint8Array} b
 * @returns {string | null}
 */
export function imageType(b) {
	const starts = (/** @type {number[]} */ sig, offset = 0) =>
		b.length >= sig.length + offset && sig.every((x, i) => b[i + offset] === x);
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
	return null;
}

/** @param {unknown} v */
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * @param {object} options
 * @param {string} options.baseUrl config.paperless.baseUrl, already checked
 * @param {() => Promise<string>} options.getToken from the keychain
 * @param {typeof fetch} [options.fetch]
 */
export function createPaperlessClient({ baseUrl, getToken, fetch: doFetch = fetch }) {
	const base = baseUrl.replace(/\/+$/, '');

	/**
	 * @param {string} path with query, below the base
	 * @param {number} timeout
	 */
	async function get(path, timeout) {
		const token = (await getToken()).trim();
		let res;
		try {
			res = await doFetch(`${base}${path}`, {
				headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
				redirect: 'error',
				signal: AbortSignal.timeout(timeout)
			});
		} catch (/** @type {any} */ error) {
			throw new PaperlessError(
				`Paperless is not reachable (${error?.name === 'TimeoutError' ? 'timeout' : (error?.cause?.code ?? error?.name ?? 'error')})`,
				'PAPERLESS_UNREACHABLE'
			);
		}
		if (res.status === 401 || res.status === 403) {
			throw new PaperlessError(
				'Paperless refused the token: run `pnpm setup:paperless` again',
				'PAPERLESS_AUTH'
			);
		}
		if (res.status === 404)
			throw new PaperlessError('not found in Paperless', 'PAPERLESS_NOT_FOUND', 404);
		if (!res.ok)
			throw new PaperlessError(`Paperless answered HTTP ${res.status}`, 'PAPERLESS_HTTP');
		return res;
	}

	/** @param {string} path */
	async function json(path) {
		const res = await get(path, LIST_TIMEOUT_MS);
		try {
			return await res.json();
		} catch {
			throw new PaperlessError('Paperless did not answer JSON', 'PAPERLESS_HTTP');
		}
	}

	/**
	 * Every result of a paged list, page by page (never Paperless' `next` URL,
	 * which names whatever host Paperless believes it is on).
	 *
	 * @param {string} path
	 * @param {Record<string, string>} [query]
	 */
	async function all(path, query = {}) {
		/** @type {any[]} */
		const out = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const q = new URLSearchParams({ ...query, page_size: String(PAGE_SIZE), page: String(page) });
			const body = await json(`${path}?${q}`);
			const results = Array.isArray(body?.results) ? body.results : [];
			out.push(...results);
			if (!body?.next || !results.length) break;
		}
		return out;
	}

	/** id → name of a Paperless list (tags, correspondents, document types). @param {string} path */
	async function names(path) {
		return new Map(
			(await all(path)).map((r) => [Number(r?.id), typeof r?.name === 'string' ? r.name : ''])
		);
	}

	return {
		/** A cheap call that needs the token: how many documents there are. */
		async count() {
			const body = await json('/api/documents/?page_size=1&fields=id');
			return Number(body?.count ?? 0);
		},

		/**
		 * The documents added after `since` (ISO), oldest first, with their OCR text.
		 *
		 * @param {{ since?: string | null }} [options]
		 * @returns {Promise<PaperlessDocument[]>}
		 */
		async documents({ since = null } = {}) {
			const [tags, correspondents, types] = await Promise.all([
				names('/api/tags/'),
				names('/api/correspondents/'),
				names('/api/document_types/')
			]);
			/** @type {Record<string, string>} */
			const query = { ordering: 'added' };
			if (since) query.added__gt = since;
			const rows = await all('/api/documents/', query);
			return rows
				.filter((r) => Number.isSafeInteger(r?.id))
				.map((r) => ({
					id: Number(r.id),
					title: typeof r.title === 'string' ? r.title : '',
					created: day(r.created_date) ?? day(r.created),
					added: typeof r.added === 'string' ? r.added : null,
					correspondent:
						r.correspondent == null ? null : (correspondents.get(Number(r.correspondent)) ?? null),
					documentType:
						r.document_type == null ? null : (types.get(Number(r.document_type)) ?? null),
					tags: (Array.isArray(r.tags) ? r.tags : [])
						.map((/** @type {unknown} */ id) => tags.get(Number(id)))
						.filter((/** @type {unknown} */ n) => typeof n === 'string' && n),
					originalFileName: typeof r.original_file_name === 'string' ? r.original_file_name : null,
					mimeType: typeof r.mime_type === 'string' ? r.mime_type : null,
					content: typeof r.content === 'string' ? r.content.slice(0, MAX_CONTENT) : ''
				}));
		},

		/**
		 * One document's bytes: the original when it is a PDF or an image, else the
		 * archive PDF Paperless made of it.
		 *
		 * @param {number} id
		 * @returns {Promise<{ bytes: Buffer, mime: string, variant: 'original' | 'archive' }>}
		 */
		async document(id) {
			if (!Number.isSafeInteger(id) || id < 1) {
				throw new PaperlessError('id must be a document number', 'PAPERLESS_BAD_ID', 400);
			}
			for (const variant of /** @type {const} */ (['original', 'archive'])) {
				const bytes = await download(
					`/api/documents/${id}/download/${variant === 'original' ? '?original=true' : ''}`
				);
				if (isPdf(bytes)) return { bytes, mime: 'application/pdf', variant };
				const image = variant === 'original' ? imageType(bytes) : null;
				if (image) return { bytes, mime: image, variant };
			}
			throw new PaperlessError(
				'the document is neither a PDF nor an image, and Paperless has no archive PDF of it',
				'PAPERLESS_NOT_A_RECEIPT',
				422
			);
		}
	};

	/** @param {string} path */
	async function download(path) {
		const res = await get(path, FILE_TIMEOUT_MS);
		const declared = Number(res.headers.get('content-length') ?? 0);
		if (declared > MAX_INVOICE_BYTES) {
			await res.body?.cancel();
			throw new PaperlessError('the document is larger than 15 MB', 'PAPERLESS_TOO_LARGE', 413);
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.length > MAX_INVOICE_BYTES) {
			throw new PaperlessError('the document is larger than 15 MB', 'PAPERLESS_TOO_LARGE', 413);
		}
		return bytes;
	}
}
