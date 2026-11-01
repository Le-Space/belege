<script>
	// The hover preview of one receipt (#273): a popover with page 1 and a lens
	// over it (ReceiptPreview `magnifier`) – among a payment's choices, in the
	// Belege list, on a payment with its receipt. Left of `avoid` (the detail
	// panel, or the row itself) where there is room, else right of it, else
	// below the row or above it, whichever has the room (else the larger side,
	// the popover scrolling) – never over the row. A scroll anywhere, or Esc,
	// is passed on (`onscrolled`, `onclose`). When it opens and closes is
	// receipts/peek.js.
	import ReceiptPreview from './ReceiptPreview.svelte';
	import { t } from './i18n/index.js';

	/**
	 * @type {{
	 *   receipt: Record<string, any>,
	 *   anchor: HTMLElement,
	 *   title: string,
	 *   detail: string,
	 *   avoid?: HTMLElement | null,
	 *   onenter: () => void,
	 *   onleave: () => void,
	 *   onscrolled?: () => void,
	 *   onclose?: () => void
	 * }}
	 */
	let {
		receipt,
		anchor,
		title,
		detail,
		avoid = null,
		onenter,
		onleave,
		onscrolled,
		onclose
	} = $props();

	const WIDTH = 360;
	const GAP = 12;
	const EDGE = 8;

	/** @type {HTMLElement | undefined} */
	let box = $state();
	let place = $state({ left: 0, top: 0, width: WIDTH, maxHeight: 0, side: 'left' });

	function position() {
		if (!anchor?.isConnected) return;
		const row = anchor.getBoundingClientRect();
		const region = (avoid?.isConnected ? avoid : anchor).getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		// What it needs, not what it was given last time.
		const height = box?.scrollHeight ?? 0;
		const roomLeft = region.left - GAP - EDGE;
		const roomRight = vw - region.right - GAP - EDGE;
		if (roomLeft >= WIDTH || roomRight >= WIDTH) {
			const side = roomLeft >= WIDTH ? 'left' : 'right';
			const maxHeight = vh - 2 * EDGE;
			const shown = Math.min(height, maxHeight);
			const top = Math.min(Math.max(EDGE, row.top + row.height / 2 - shown / 2), vh - shown - EDGE);
			const left = side === 'left' ? region.left - GAP - WIDTH : region.right + GAP;
			place = { left, top: Math.max(EDGE, top), width: WIDTH, maxHeight, side };
			return;
		}
		// Narrow: below the row, or above it – whichever has the room, else the
		// larger, its height cut to it (it scrolls). Never over the row.
		const width = Math.min(WIDTH, vw - 2 * EDGE);
		const left = Math.min(Math.max(EDGE, row.left), vw - width - EDGE);
		const below = vh - EDGE - (row.bottom + 4);
		const above = row.top - 4 - EDGE;
		const side = height <= below || below >= above ? 'below' : 'above';
		const maxHeight = Math.max(120, side === 'below' ? below : above);
		const shown = Math.min(height, maxHeight);
		const top = side === 'below' ? row.bottom + 4 : row.top - 4 - shown;
		place = { left, top, width, maxHeight, side };
	}

	// A scroll anywhere moves the row away from the popover; Esc closes it.
	$effect(() => {
		const scrolled = () => onscrolled?.();
		/** @param {KeyboardEvent} e */
		const key = (e) => {
			if (e.key === 'Escape') onclose?.();
		};
		window.addEventListener('scroll', scrolled, { capture: true, passive: true });
		window.addEventListener('keydown', key);
		return () => {
			window.removeEventListener('scroll', scrolled, { capture: true });
			window.removeEventListener('keydown', key);
		};
	});

	$effect(() => {
		void anchor;
		position();
		if (!box) return;
		// Placed again once the page is rendered and the popover has its height.
		const observer = new ResizeObserver(() => position());
		observer.observe(box);
		window.addEventListener('resize', position);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', position);
		};
	});
</script>

<div
	bind:this={box}
	class="fixed z-20 overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-xl"
	style:left="{place.left}px"
	style:top="{place.top}px"
	style:width="{place.width}px"
	style:max-height={place.maxHeight ? `${place.maxHeight}px` : undefined}
	role="dialog"
	aria-label={t('zahlungen.detail.peek.label', { name: title })}
	onpointerenter={onenter}
	onpointerleave={onleave}
	data-testid="receipt-peek"
	data-side={place.side}
	data-receipt={receipt.id}
>
	<p class="truncate text-sm font-medium text-heading">{title}</p>
	{#if detail}
		<p class="truncate text-xs text-faint">{detail}</p>
	{/if}
	<div class="mt-2">
		<ReceiptPreview {receipt} width={place.width - 26} magnifier />
	</div>
	<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.peek.hint')}</p>
</div>
