// The hover preview's timing (#273): it waits before opening, so a pass over a
// long list renders nothing; it gives the pointer time to reach it; focus and
// the touch button open it at once; a receipt from an unconfirmed sender, or
// one without a file or text, never opens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_DELAY, OPEN_DELAY, canPeek, createPeek } from './peek.js';

const A = { id: 'a', fileCid: 'bafy-a' };
const B = { id: 'b', fileCid: 'bafy-b' };

describe('the receipt preview', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const make = () => {
		/** @type {any[]} */
		const seen = [];
		const peek = createPeek({ onchange: (v) => seen.push(v?.receipt.id ?? null) });
		return { peek, seen };
	};

	it('opens after a rest, not on a pass over the list', () => {
		const { peek, seen } = make();
		peek.hover(A, 'row-a');
		vi.advanceTimersByTime(OPEN_DELAY - 1);
		peek.leave();
		peek.hover(B, 'row-b');
		vi.advanceTimersByTime(OPEN_DELAY);
		expect(seen).toEqual(['b']);
		expect(peek.open?.anchor).toBe('row-b');
		// Once open, the next row's opens at once.
		peek.leave();
		peek.hover(A, 'row-a');
		expect(seen).toEqual(['b', 'a']);
	});

	it('stays while the pointer moves from the row into it, closes when it leaves', () => {
		const { peek, seen } = make();
		peek.show(A, 'row-a');
		peek.leave();
		vi.advanceTimersByTime(CLOSE_DELAY - 1);
		peek.stay();
		vi.advanceTimersByTime(CLOSE_DELAY * 4);
		expect(peek.open?.receipt.id).toBe('a');
		peek.leave();
		vi.advanceTimersByTime(CLOSE_DELAY);
		expect(peek.open).toBeNull();
		expect(seen).toEqual(['a', null]);
	});

	it('a scroll closes an open preview, but not one about to open', () => {
		const { peek, seen } = make();
		peek.show(A, 'row-a');
		peek.scrolled();
		expect(peek.open).toBeNull();
		// The pointer rests on a row while the list still scrolls: it opens all the same.
		peek.hover(B, 'row-b');
		peek.scrolled();
		vi.advanceTimersByTime(OPEN_DELAY);
		expect(seen).toEqual(['a', null, 'b']);
	});

	it('focus and the touch button open at once; the button again, or Esc, closes', () => {
		const { peek } = make();
		peek.toggle(A, 'row-a');
		expect(peek.open?.receipt.id).toBe('a');
		peek.toggle(A, 'row-a');
		expect(peek.open).toBeNull();
		peek.show(B, 'row-b');
		peek.close();
		expect(peek.open).toBeNull();
	});

	it('never for an unconfirmed sender, nor without a file or text', () => {
		const mail = { id: 'm', fileCid: 'bafy-m', source: 'mail', authVerdict: 'fail' };
		expect(canPeek(mail)).toBe(false);
		expect(canPeek({ ...mail, confirmedByUser: true })).toBe(true);
		expect(canPeek({ id: 'x' })).toBe(false);
		expect(canPeek({ id: 'y', excerpt: 'Rechnung' })).toBe(true);
		const { peek, seen } = make();
		peek.hover(mail, 'row-m');
		peek.show(mail, 'row-m');
		vi.advanceTimersByTime(OPEN_DELAY * 2);
		expect(seen).toEqual([]);
	});
});
