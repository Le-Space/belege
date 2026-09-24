// What a portal download must be before it leaves the bridge: a PDF by its
// bytes (whatever the portal called it), at most 15 MB.

export const MAX_INVOICE_BYTES = 15 * 1024 * 1024;

/**
 * `%PDF-` within the first KB, as readers accept it (and as the app's sniffer does).
 *
 * @param {Uint8Array} bytes
 */
export function isPdf(bytes) {
	if (!bytes || bytes.length < 8) return false;
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 1024));
	return head.includes('%PDF-', 0, 'latin1');
}
