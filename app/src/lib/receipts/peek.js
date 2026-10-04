// The hover preview of a receipt among the choices of a payment (#273): when
// it opens, when it closes, and for which receipt. Plain timing, no DOM – the
// popover is ReceiptPeek.svelte, the rows are in TransactionDetail.svelte.
//
//   hover   the pointer rests on a row: open after OPEN_DELAY, so moving down
//           a long list does not decrypt and render every file on the way;
//           once one is open, the next row's opens at once
//   leave   the pointer leaves the row or the popover: close after
//           CLOSE_DELAY, time enough to move from the row into the popover
//           (for the lens) without it closing
//   stay    the pointer arrived in the popover: it stays
//   show    focus on a row (Tab), or the "Vorschau" button on a touch screen:
//           open now
//   scrolled  the list moved: an open preview no longer sits by its row and
//           closes; one about to open still does – a pointer resting on a row
//           after scrolling (or a row scrolled into view under it) gets it
//   close   Esc, a click on the row's button: gone now

import { needsConfirmation } from './import.js';

export const OPEN_DELAY = 300;
export const CLOSE_DELAY = 150;

/**
 * Whether a receipt has something to preview, and may be opened: a file or a
 * mail's text, and not from a sender still to be confirmed.
 *
 * @param {Record<string, any>} receipt
 */
export const canPeek = (receipt) =>
	Boolean(receipt) && !needsConfirmation(receipt) && Boolean(receipt.fileCid || receipt.excerpt);

/**
 * @template A the anchor: the row the popover is placed by
 * @param {object} options
 * @param {(open: { receipt: Record<string, any>, anchor: A } | null) => void} options.onchange
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 */
export function createPeek({ onchange, setTimer = setTimeout, clearTimer = clearTimeout }) {
	/** @type {{ receipt: Record<string, any>, anchor: A } | null} */
	let open = null;
	/** @type {unknown} */
	let opening = null;
	/** @type {unknown} */
	let closing = null;

	const cancel = () => {
		if (opening !== null) clearTimer(opening);
		if (closing !== null) clearTimer(closing);
		opening = null;
		closing = null;
	};
	/** @param {{ receipt: Record<string, any>, anchor: A } | null} next */
	const set = (next) => {
		open = next;
		onchange(next);
	};

	return {
		get open() {
			return open;
		},
		/** @param {Record<string, any>} receipt @param {A} anchor */
		hover(receipt, anchor) {
			if (!canPeek(receipt)) return;
			cancel();
			if (open?.receipt.id === receipt.id) return;
			if (open) set({ receipt, anchor });
			else
				opening = setTimer(() => {
					opening = null;
					set({ receipt, anchor });
				}, OPEN_DELAY);
		},
		/** @param {Record<string, any>} receipt @param {A} anchor */
		show(receipt, anchor) {
			if (!canPeek(receipt)) return;
			cancel();
			if (open?.receipt.id !== receipt.id) set({ receipt, anchor });
		},
		/** @param {Record<string, any>} receipt @param {A} anchor */
		toggle(receipt, anchor) {
			if (open?.receipt.id === receipt.id) this.close();
			else this.show(receipt, anchor);
		},
		leave() {
			if (opening !== null) clearTimer(opening);
			opening = null;
			if (!open || closing !== null) return;
			closing = setTimer(() => {
				closing = null;
				set(null);
			}, CLOSE_DELAY);
		},
		stay() {
			if (closing !== null) clearTimer(closing);
			closing = null;
		},
		scrolled() {
			if (!open) return;
			if (closing !== null) clearTimer(closing);
			closing = null;
			set(null);
		},
		close() {
			cancel();
			if (open) set(null);
		}
	};
}

/**
 * The events of a row that previews `receipt`, to spread onto it: the pointer
 * resting on it, focus (Tab; at once in a short list of choices, after the
 * delay in a long list, so tabbing through it renders nothing), leaving it,
 * and a press, which opens the row's own view instead.
 *
 * @param {ReturnType<typeof createPeek<HTMLElement>>} peek
 * @param {Record<string, any>} receipt
 * @param {{ focusAtOnce?: boolean }} [options]
 */
export function peekHandlers(peek, receipt, { focusAtOnce = false } = {}) {
	return {
		/** @param {PointerEvent} e */
		onpointerenter: (e) => {
			if (e.pointerType !== 'touch')
				peek.hover(receipt, /** @type {HTMLElement} */ (e.currentTarget));
		},
		/** @param {PointerEvent} e */
		onpointerleave: (e) => {
			if (e.pointerType !== 'touch') peek.leave();
		},
		onpointerdown: () => peek.close(),
		/** @param {FocusEvent} e */
		onfocusin: (e) => {
			const row = /** @type {HTMLElement} */ (e.currentTarget);
			if (focusAtOnce) peek.show(receipt, row);
			else peek.hover(receipt, row);
		},
		/** @param {FocusEvent} e */
		onfocusout: (e) => {
			const next = /** @type {Node | null} */ (e.relatedTarget);
			if (!next || !(/** @type {HTMLElement} */ (e.currentTarget).contains(next))) peek.leave();
		}
	};
}
