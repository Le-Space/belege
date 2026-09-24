// PDFs in the browser, with pdf.js (through unpdf, which bundles a build that
// needs no worker file). Loaded on first use: it is large, and only the Belege
// page needs it.
//
// A receipt PDF can come from anyone, so pdf.js runs with `isEvalSupported:
// false` (no font programs compiled with eval, CVE-2024-4367) and every call
// gets a copy of the bytes (pdf.js takes ownership of the buffer it is given).

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
 * @returns {Promise<number>} the number of pages
 */
export async function renderFirstPage(bytes, canvas, width = 360) {
	const pdf = await open(bytes);
	try {
		const page = await pdf.getPage(1);
		const unscaled = page.getViewport({ scale: 1 });
		const ratio = window.devicePixelRatio || 1;
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
