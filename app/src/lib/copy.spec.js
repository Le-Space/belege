import { describe, expect, it, vi } from 'vitest';
import { copyText, selectText } from './copy.js';

// Made up, not anyone's address.
const ADDRESS = '0x1111222233334444555566667777888899990000';

/** A stand-in for an element and the window's selection, enough for selectText. */
function fakeDom() {
	const range = { selectNodeContents: vi.fn() };
	const element = /** @type {any} */ ({ ownerDocument: { createRange: () => range } });
	const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
	return { range, element, selection };
}

describe('copyText', () => {
	it('puts the text on the clipboard', async () => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		const { element, selection } = fakeDom();
		expect(await copyText(ADDRESS, { clipboard, element, selection })).toBe('copied');
		expect(clipboard.writeText).toHaveBeenCalledWith(ADDRESS);
		expect(selection.addRange).not.toHaveBeenCalled();
	});

	it('selects the text when the clipboard is refused', async () => {
		const clipboard = {
			writeText: vi.fn(async () => {
				throw new DOMException('Write permission denied.', 'NotAllowedError');
			})
		};
		const { range, element, selection } = fakeDom();
		expect(await copyText(ADDRESS, { clipboard, element, selection })).toBe('selected');
		expect(range.selectNodeContents).toHaveBeenCalledWith(element);
		expect(selection.removeAllRanges).toHaveBeenCalled();
		expect(selection.addRange).toHaveBeenCalledWith(range);
	});

	it('selects the text when there is no clipboard at all', async () => {
		const { element, selection } = fakeDom();
		expect(await copyText(ADDRESS, { clipboard: null, element, selection })).toBe('selected');
	});

	it('says so when it can neither copy nor select', async () => {
		const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
		expect(await copyText(ADDRESS, { clipboard, element: null, selection: null })).toBe('failed');
	});

	it('does not put an empty text on the clipboard', async () => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		expect(await copyText('', { clipboard, element: null, selection: null })).toBe('failed');
		expect(clipboard.writeText).not.toHaveBeenCalled();
	});
});

describe('selectText', () => {
	it('selects nothing without an element or a selection', () => {
		const { element, selection } = fakeDom();
		expect(selectText(null, selection)).toBe(false);
		expect(selectText(element, null)).toBe(false);
	});
});
