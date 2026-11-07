// A receipt's file saved to the computer (#709): from the hover preview, one
// click. The file is decrypted from the blob store here, in the browser, and
// handed to the browser's download through an object URL – nothing goes over
// the network. The name is the file's own, made safe for a file system, or
// one made of the day and the vendor.

import { needsConfirmation } from './import.js';
import { receiptDate } from './view.js';

const EXTENSION = /** @type {Record<string, string>} */ ({
	'application/pdf': 'pdf',
	'application/xml': 'xml',
	'text/xml': 'xml',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/heic': 'heic',
	'image/tiff': 'tif'
});

/** The name of a file with none of its own, as the PDFs Belege makes are named in German. */
// eslint-disable-next-line belege/no-german -- a file name, not a text in the UI
const FALLBACK = 'Beleg';

/** Longest name kept, without its extension: file systems stop at 255 bytes. */
const MAX = 120;

/**
 * Whether a receipt has a file that may be saved: kept, and not from a sender
 * still to be confirmed (the same as its preview).
 *
 * @param {Record<string, any>} receipt
 */
export const canDownload = (receipt) => Boolean(receipt?.fileCid) && !needsConfirmation(receipt);

/**
 * Text for a file name: its last path segment only, no control characters or
 * characters a file system refuses, no leading dots, spaces collapsed.
 *
 * @param {unknown} text
 */
function clean(text) {
	return (
		(
			String(text ?? '')
				.split(/[/\\]/)
				.pop() ?? ''
		)
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/^\.+/, '')
			.trim()
	);
}

/**
 * The name a receipt's file is saved as: its own name when it has one, else
 * the day and the vendor; the extension from its type when the name lacks it.
 *
 * @param {Record<string, any>} receipt
 */
export function downloadName(receipt) {
	const ext = EXTENSION[String(receipt?.mime ?? '').toLowerCase()] ?? '';
	let base = clean(receipt?.fileName);
	if (ext && base.toLowerCase().endsWith(`.${ext}`)) base = base.slice(0, -ext.length - 1).trim();
	else if (/\.[a-z0-9]{2,4}$/i.test(base) && !ext) {
		const dot = base.lastIndexOf('.');
		return `${base.slice(0, dot).slice(0, MAX).trim() || FALLBACK}${base.slice(dot)}`;
	}
	if (!base) {
		base = [receiptDate(/** @type {any} */ (receipt)), clean(receipt?.vendor)]
			.filter(Boolean)
			.join(' ');
	}
	base = base.slice(0, MAX).trim() || FALLBACK;
	return ext ? `${base}.${ext}` : base;
}

/**
 * Saves a receipt's file: decrypted from `blobs`, offered by the browser as a
 * download.
 *
 * @param {Record<string, any>} receipt
 * @param {{ get: (cid: string) => Promise<Uint8Array> }} blobs
 */
export async function downloadReceipt(receipt, blobs) {
	if (!canDownload(receipt)) return;
	const bytes = await blobs.get(receipt.fileCid);
	const url = URL.createObjectURL(
		new Blob([/** @type {BlobPart} */ (bytes)], {
			type: receipt.mime || 'application/octet-stream'
		})
	);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = downloadName(receipt);
		a.rel = 'noopener';
		document.body.append(a);
		a.click();
		a.remove();
	} finally {
		// Revoked after the browser has taken it.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
