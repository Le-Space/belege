<script>
	// The hover preview of one receipt among a payment's choices (#273): a
	// popover with page 1 and a lens over it (ReceiptPreview `magnifier`).
	// Beside the detail panel where there is room for it, else below the row
	// or above it, whichever has the room (else the larger side, the popover
	// scrolling) – never over the row and its button.
	// When it opens and closes is receipts/peek.js.
	import ReceiptPreview from './ReceiptPreview.svelte';
	import { t } from './i18n/index.js';

	/**
	 * @type {{
	 *   receipt: Record<string, any>,
	 *   anchor: HTMLElement,
	 *   title: string,
	 *   detail: string,
	 *   onenter: () => void,
	 *   onleave: () => void
	 * }}
	 */
	let { receipt, anchor, title, detail, onenter, onleave } = $props();

	const WIDTH = 360;
	const GAP = 12;
	const EDGE = 8;

	/** @type {HTMLElement | undefined} */
	let box = $state();
	let place = $state({ left: 0, top: 0, width: WIDTH, maxHeight: 0, side: 'beside' });

	function position() {
		if (!anchor?.isConnected) return;
		const row = anchor.getBoundingClientRect();
		const panel = anchor.closest('[data-testid="tx-detail"]')?.getBoundingClientRect() ?? row;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		// What it needs, not what it was given last time.
		const height = box?.scrollHeight ?? 0;
		if (panel.left - GAP - EDGE >= WIDTH) {
			const maxHeight = vh - 2 * EDGE;
			const shown = Math.min(height, maxHeight);
			const top = Math.min(Math.max(EDGE, row.top + row.height / 2 - shown / 2), vh - shown - EDGE);
			place = {
				left: panel.left - GAP - WIDTH,
				top: Math.max(EDGE, top),
				width: WIDTH,
				maxHeight,
				side: 'beside'
			};
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
