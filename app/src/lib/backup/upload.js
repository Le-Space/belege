// The sealed backup to Aleph's IPFS host, with how far it is when the host
// lets that be known. The storage bridge's Aleph backend (`putBlob`) posts
// with fetch, which says nothing until the last byte is through; for 500 MB
// that is minutes of silence. The same POST – one file in a form, the host's
// `add` answer one JSON object per line – sent with XMLHttpRequest reports
// every chunk, but listening to it makes the browser ask the host first
// (a CORS preflight), and Aleph's IPFS host allows that for its own console
// only (measured 2026-10-25; its POST itself is open to every origin –
// aleph-im/pyaleph#1280). So: asked with
// progress once; refused before a byte went, sent again without, and that
// host is not asked again in this tab.
//
// Since 2026-10-26 Aleph's IPFS hosts answer every `/api/v0/` call with 404:
// they serve the gateway only. Aleph's API nodes still take files
// (`/api/v0/ipfs/add_file`), and let any page count the upload – but without
// a signed STORE message only up to 25 MiB (pyaleph's
// max_unauthenticated_upload_file_size). So when the host is gone, a backup
// that fits – an increment, as a rule – goes there; a bigger one says why
// not (`IngestGoneError`). The STORE that keeps it follows as before.

/** Two minutes for the host to answer, and the time the bytes take on top. */
const TIMEOUT_MS = 120_000;
/**
 * At least 100 kB/s: a 500 MB backup may take its 85 minutes. The storage
 * bridge's two minutes, and 1 MB/s after them, were too little for a home
 * uplink – a full backup never went through. Without progress (Aleph's host,
 * above) a stalled upload cannot be told from a slow one, so the bound is wide.
 */
const BYTES_PER_MS = 100;

/** The upload took longer than a slow line would: `minutes` allowed. */
export class UploadTimeoutError extends Error {
	/** @param {number} minutes @param {number} size bytes */
	constructor(minutes, size) {
		super(`Aleph ingest did not answer within ${minutes} minutes`);
		this.name = 'UploadTimeoutError';
		this.minutes = minutes;
		this.size = size;
	}
}

/** What Aleph's API nodes take without a signed STORE message: 25 MiB. */
export const API_UPLOAD_LIMIT = 25 * 1024 * 1024;

/** Aleph's IPFS host takes no uploads, and the backup is too big for its API nodes. */
export class IngestGoneError extends Error {
	/** @param {number} size bytes */
	constructor(size) {
		super(`Aleph's IPFS host takes no uploads, and ${size} bytes are too many for its API`);
		this.name = 'IngestGoneError';
		this.size = size;
		this.limit = API_UPLOAD_LIMIT;
	}
}

/** The host answered that it has no such endpoint. */
class Gone extends Error {}

/**
 * The file's own hash from the host's `add` answer: a name with a path makes
 * it wrap the file in directories and add a line for each (storage bridge,
 * measured 2026-09-17); the id kept is the file's, never a wrapper's.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
export function addedHash(text, name) {
	let entries;
	try {
		entries = text
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line));
	} catch {
		throw new Error('Aleph ingest answered something that is not JSON');
	}
	const body = entries.find((entry) => entry?.Name === name) ?? entries[0];
	if (!body?.Hash) throw new Error('Aleph ingest returned no Hash');
	return String(body.Hash);
}

/** Hosts that refused the preflight in this tab. */
const unmeasured = new Set();
/** IPFS hosts that answered 404 in this tab: not asked again. */
const gone = new Set();

/** Refused before anything was sent: the preflight. */
class PreflightRefused extends Error {}

/**
 * Upload `bytes` as `name`; `onProgress(sent, total)` as the bytes go out,
 * where the host allows it – `measured` says whether it did.
 *
 * @param {object} params
 * @param {string} params.ingestUrl Aleph's IPFS host's `add`
 * @param {string} [params.apiHost] an Aleph API node, for when that host is gone
 * @param {Uint8Array} params.bytes
 * @param {string} params.name
 * @param {(sent: number, total: number) => void} [params.onProgress]
 * @param {(measured: boolean) => void} [params.onMeasured] whether this upload is counted, once known
 * @returns {Promise<{ id: string, size: number, measured: boolean }>} `id`: Aleph's CID for the file
 * @throws {IngestGoneError} the host is gone and the file too big for the API
 */
export async function uploadToAleph({ ingestUrl, apiHost, bytes, name, onProgress, onMeasured }) {
	if (!gone.has(ingestUrl)) {
		try {
			return await viaIngest({ ingestUrl, bytes, name, onProgress, onMeasured });
		} catch (e) {
			if (!(e instanceof Gone)) throw e;
			gone.add(ingestUrl);
		}
	}
	if (!apiHost || bytes.length > API_UPLOAD_LIMIT) throw new IngestGoneError(bytes.length);
	onMeasured?.(Boolean(onProgress));
	const id = await send({
		url: `${apiHost}/api/v0/ipfs/add_file`,
		bytes,
		name,
		onProgress,
		parse: (text) => {
			const hash = /** @type {any} */ (JSON.parse(text))?.hash;
			if (typeof hash !== 'string' || !hash) throw new Error('Aleph returned no hash');
			return hash;
		}
	});
	return { id, size: bytes.length, measured: Boolean(onProgress) };
}

/**
 * The IPFS host's `add`: with progress once, then without (see above).
 *
 * @param {{ ingestUrl: string, bytes: Uint8Array, name: string, onProgress?: (sent: number, total: number) => void, onMeasured?: (measured: boolean) => void }} params
 */
async function viaIngest({ ingestUrl, bytes, name, onProgress, onMeasured }) {
	const parse = (/** @type {string} */ text) => addedHash(text, name);
	if (onProgress && !unmeasured.has(ingestUrl)) {
		try {
			onMeasured?.(true);
			const id = await send({ url: ingestUrl, bytes, name, onProgress, parse });
			return { id, size: bytes.length, measured: true };
		} catch (e) {
			if (!(e instanceof PreflightRefused)) throw e;
			unmeasured.add(ingestUrl);
		}
	}
	onMeasured?.(false);
	const id = await send({ url: ingestUrl, bytes, name, parse });
	return { id, size: bytes.length, measured: false };
}

/**
 * One POST of the file in a form, its answer read by `parse`.
 *
 * @param {{ url: string, bytes: Uint8Array, name: string, onProgress?: (sent: number, total: number) => void, parse: (text: string) => string }} params
 * @returns {Promise<string>} the CID
 */
function send({ url, bytes, name, onProgress, parse }) {
	const form = new FormData();
	form.append(
		'file',
		new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/octet-stream' }),
		name
	);
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.timeout = TIMEOUT_MS + bytes.length / BYTES_PER_MS;
		let sent = 0;
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				sent = e.loaded;
				onProgress(e.loaded, e.lengthComputable ? e.total : 0);
			};
		}
		xhr.onload = () => {
			if (xhr.status === 404 || xhr.status === 405) {
				reject(new Gone(`Aleph answered ${xhr.status}: no upload here`));
				return;
			}
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(`Aleph ingest answered ${xhr.status} ${xhr.statusText}`));
				return;
			}
			try {
				resolve(parse(xhr.responseText));
			} catch (e) {
				reject(e);
			}
		};
		xhr.onerror = () =>
			reject(
				onProgress && sent === 0
					? new PreflightRefused('Aleph ingest refused the preflight')
					: new Error('Aleph ingest is unreachable')
			);
		xhr.ontimeout = () =>
			reject(new UploadTimeoutError(Math.round(xhr.timeout / 60_000), bytes.length));
		xhr.send(form);
	});
}
