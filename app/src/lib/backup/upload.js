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

/** Refused before anything was sent: the preflight. */
class PreflightRefused extends Error {}

/**
 * Upload `bytes` as `name`; `onProgress(sent, total)` as the bytes go out,
 * where the host allows it – `measured` says whether it did.
 *
 * @param {object} params
 * @param {string} params.ingestUrl
 * @param {Uint8Array} params.bytes
 * @param {string} params.name
 * @param {(sent: number, total: number) => void} [params.onProgress]
 * @param {() => void} [params.onUnmeasured] the host does not let it be counted: sent without
 * @returns {Promise<{ id: string, size: number, measured: boolean }>} `id`: Aleph's CID for the file
 */
export async function uploadToAleph({ ingestUrl, bytes, name, onProgress, onUnmeasured }) {
	if (onProgress && !unmeasured.has(ingestUrl)) {
		try {
			return { ...(await send({ ingestUrl, bytes, name, onProgress })), measured: true };
		} catch (e) {
			if (!(e instanceof PreflightRefused)) throw e;
			unmeasured.add(ingestUrl);
		}
	}
	onUnmeasured?.();
	return { ...(await send({ ingestUrl, bytes, name })), measured: false };
}

/**
 * @param {{ ingestUrl: string, bytes: Uint8Array, name: string, onProgress?: (sent: number, total: number) => void }} params
 * @returns {Promise<{ id: string, size: number }>}
 */
function send({ ingestUrl, bytes, name, onProgress }) {
	const form = new FormData();
	form.append(
		'file',
		new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/octet-stream' }),
		name
	);
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', ingestUrl);
		xhr.timeout = TIMEOUT_MS + bytes.length / BYTES_PER_MS;
		let sent = 0;
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				sent = e.loaded;
				onProgress(e.loaded, e.lengthComputable ? e.total : 0);
			};
		}
		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(`Aleph ingest answered ${xhr.status} ${xhr.statusText}`));
				return;
			}
			try {
				resolve({ id: addedHash(xhr.responseText, name), size: bytes.length });
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
