// Copy to the clipboard, for addresses, hashes and IBANs (issue #114): a
// person copies them into a block explorer, a wallet or a bank form, and
// selecting a 42-character address by hand goes wrong easily.
//
// The clipboard can be refused (no permission, an insecure origin, a
// browser that asks and gets a "no"). Then the text is at least selected,
// so Cmd/Ctrl+C copies it; the caller says which of the two happened.

/**
 * @typedef {'copied' | 'selected' | 'failed'} CopyResult
 * @typedef {{ writeText: (text: string) => Promise<void> }} ClipboardLike
 * @typedef {{ removeAllRanges: () => void, addRange: (range: any) => void }} SelectionLike
 */

/**
 * Select all text of an element, the way a triple click would.
 *
 * @param {Element | null | undefined} element
 * @param {SelectionLike | null} [selection] the window's selection (injected in tests)
 * @returns {boolean} whether something was selected
 */
export function selectText(element, selection = globalThis.getSelection?.() ?? null) {
	const doc = element?.ownerDocument;
	if (!element || !doc || !selection) return false;
	const range = doc.createRange();
	range.selectNodeContents(element);
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}

/**
 * Put a text on the clipboard; if that is refused, select it in `element`.
 *
 * @param {string} text
 * @param {{ element?: Element | null, clipboard?: ClipboardLike | null, selection?: SelectionLike | null }} [options]
 *   `clipboard` and `selection` default to the browser's (injected in tests)
 * @returns {Promise<CopyResult>}
 */
export async function copyText(text, options = {}) {
	const clipboard =
		options.clipboard === undefined ? (globalThis.navigator?.clipboard ?? null) : options.clipboard;
	if (text && clipboard?.writeText) {
		try {
			await clipboard.writeText(text);
			return 'copied';
		} catch {
			// Refused: fall through to selecting it.
		}
	}
	const selected =
		options.selection === undefined
			? selectText(options.element)
			: selectText(options.element, options.selection);
	return selected ? 'selected' : 'failed';
}
