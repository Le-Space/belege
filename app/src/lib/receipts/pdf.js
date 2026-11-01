// PDFs in the browser, with pdf.js (through unpdf, which bundles a build that
// needs no worker file). Loaded on first use: it is large, and only the Belege
// page needs it.
//
// A receipt PDF can come from anyone, so pdf.js runs with `isEvalSupported:
// false` (no font programs compiled with eval, CVE-2024-4367) and every call
// gets a copy of the bytes (pdf.js takes ownership of the buffer it is given).

import { Unzlib } from 'fflate';

/** Frees what pdf.js holds; the proxy's own method moved between versions. */
async function close(/** @type {any} */ pdf) {
	try {
		await (pdf.loadingTask?.destroy?.() ?? pdf.destroy?.() ?? pdf.cleanup?.());
	} catch {
		// Nothing to free, or already freed.
	}
}

/** @param {Uint8Array} bytes */
async function open(bytes) {
	const { getDocumentProxy } = await import('unpdf');
	/** @type {any} pdf.js options unpdf's types leave out */
	const options = {
		isEvalSupported: false,
		// Nothing is fetched: no CMaps, fonts or anything else from a URL.
		disableAutoFetch: true,
		disableStream: true
	};
	return /** @type {any} */ (await getDocumentProxy(new Uint8Array(bytes), options));
}

/**
 * The text layer of every page, joined. pdf.js glues table rows together
 * (docs/phase-0.md); that is the LLM's problem, not solved here.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ text: string, pages: number }>}
 */
export async function extractPdfText(bytes) {
	const { extractText } = await import('unpdf');
	const pdf = await open(bytes);
	try {
		const { text, totalPages } = await extractText(pdf, { mergePages: true });
		return { text: String(text), pages: totalPages };
	} finally {
		await close(pdf);
	}
}

/**
 * Page 1 onto a canvas, scaled to its width.
 *
 * @param {Uint8Array} bytes
 * @param {HTMLCanvasElement} canvas
 * @param {number} [width] CSS pixels
 * @param {number} [oversample] pixels per device pixel: more than 1 keeps detail for a
 *   magnifier (ReceiptPreview), the CSS size stays `width`
 * @returns {Promise<number>} the number of pages
 */
export async function renderFirstPage(bytes, canvas, width = 360, oversample = 1) {
	const pdf = await open(bytes);
	try {
		const page = await pdf.getPage(1);
		const unscaled = page.getViewport({ scale: 1 });
		const ratio = (window.devicePixelRatio || 1) * Math.max(1, oversample);
		const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
		canvas.width = Math.floor(viewport.width);
		canvas.height = Math.floor(viewport.height);
		canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
		canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('No 2D canvas.');
		await page.render(/** @type {any} */ ({ canvasContext: context, viewport, canvas })).promise;
		return pdf.numPages;
	} finally {
		await close(pdf);
	}
}

/** An embedded file larger than this is not read (an e-invoice XML is kilobytes). */
export const MAX_ATTACHMENT = 5 * 1024 * 1024;

/**
 * Inflate (zlib), stopping at `max` bytes: null when it would be more, or is broken.
 *
 * @param {Uint8Array} raw
 * @param {number} max
 * @returns {Uint8Array | null}
 */
export function inflateAtMost(raw, max) {
	/** @type {Uint8Array[]} */
	const chunks = [];
	let size = 0;
	let over = false;
	const inflate = new Unzlib((chunk) => {
		size += chunk.length;
		if (size > max) over = true;
		else chunks.push(chunk);
	});
	try {
		// In slices, so a bomb stops after one slice's worth of output past the limit.
		for (let i = 0; i < raw.length && !over; i += 16 * 1024) {
			inflate.push(raw.subarray(i, i + 16 * 1024), i + 16 * 1024 >= raw.length);
		}
	} catch {
		return null;
	}
	if (over) return null;
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

/**
 * The files embedded in a PDF (its attachments: the catalog's
 * `/Names /EmbeddedFiles` tree): a ZUGFeRD / Factur-X invoice carries its
 * XML so (issue #160). Read with pdf-lib, which only parses the structure –
 * nothing is rendered or run.
 *
 * Only the attachments `accept` takes by name are decoded, and each only up to
 * `maxBytes`: a small stream can inflate to gigabytes, so the name is checked
 * first and the inflating stops at the limit (the file is then left out).
 * FlateDecode and unfiltered streams only – what e-invoices use.
 *
 * @param {Uint8Array} bytes
 * @param {{ accept?: (name: string) => boolean, maxBytes?: number }} [options]
 * @returns {Promise<{ name: string, bytes: Uint8Array }[]>}
 */
export async function pdfAttachments(
	bytes,
	{ accept = () => true, maxBytes = MAX_ATTACHMENT } = {}
) {
	const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream } =
		await import('pdf-lib');
	const doc = await PDFDocument.load(new Uint8Array(bytes), {
		ignoreEncryption: true,
		updateMetadata: false,
		throwOnInvalidObject: false
	});
	/** @type {{ name: string, bytes: Uint8Array }[]} */
	const out = [];
	/** @param {any} v */
	const str = (v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');
	/** @param {any} spec a file specification */
	function take(spec) {
		if (!(spec instanceof PDFDict)) return;
		const ef = spec.lookup(PDFName.of('EF'));
		const stream = ef instanceof PDFDict ? ef.lookup(PDFName.of('F')) : null;
		if (!(stream instanceof PDFRawStream)) return;
		const name = str(spec.lookup(PDFName.of('UF'))) || str(spec.lookup(PDFName.of('F')));
		if (!accept(name)) return;
		const filter = stream.dict.lookup(PDFName.of('Filter'));
		const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
		const raw = stream.getContents();
		/** @type {Uint8Array | null} */
		let data = null;
		if (filters.length === 0) data = raw.length <= maxBytes ? raw : null;
		else if (filters.length === 1 && String(filters[0]) === '/FlateDecode')
			data = inflateAtMost(raw, maxBytes);
		if (data) out.push({ name, bytes: data });
	}
	/** @param {any} node a name tree node @param {number} depth */
	function walk(node, depth) {
		if (!(node instanceof PDFDict) || depth > 20) return;
		const names = node.lookup(PDFName.of('Names'));
		if (names instanceof PDFArray) {
			for (let i = 1; i < names.size(); i += 2) take(names.lookup(i));
		}
		const kids = node.lookup(PDFName.of('Kids'));
		if (kids instanceof PDFArray) {
			for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i), depth + 1);
		}
	}
	const tree = doc.catalog.lookup(PDFName.of('Names'));
	if (tree instanceof PDFDict) walk(tree.lookup(PDFName.of('EmbeddedFiles')), 0);
	return out;
}
