<script>
	// A small preview of one receipt for the Zahlungen detail: page 1 of a PDF
	// on a canvas, an image as it is, a mail's text. A receipt whose sender is
	// not confirmed is not opened (receipts/import.js `needsConfirmation`).
	//
	// With `magnifier` (the hover preview of the choices, #273) the page is
	// rendered with more pixels than shown (`oversample`), and a round lens
	// follows the pointer over it, drawn from those pixels – the date or an
	// amount read without opening the file. Nothing is rendered again.
	import { currentBlobs } from './session.svelte.js';
	import { needsConfirmation } from './receipts/import.js';
	import { t } from './i18n/index.js';
	import MailText from './receipts/MailText.svelte';

	/** @type {{ receipt: Record<string, any>, width?: number, magnifier?: boolean }} */
	let { receipt, width = 260, magnifier = false } = $props();

	/** How much the lens enlarges what it covers, and its size in CSS pixels. */
	const ZOOM = 2.5;
	const LENS = 150;
	/** Pixels rendered per device pixel when there is a lens to feed. */
	let oversample = $derived(magnifier ? 3 : 1);

	/** @type {HTMLImageElement | undefined} */
	let image = $state();
	/** @type {HTMLCanvasElement | undefined} */
	let lensCanvas = $state();
	/** @type {{ x: number, y: number, w: number, h: number } | null} the pointer over the page and the page's size, CSS pixels */
	let lens = $state(null);

	// Drawn once the lens is there, and again as the pointer moves.
	$effect(() => {
		if (lens && lensCanvas) drawLens(lens, lensCanvas);
	});

	/** @param {PointerEvent} e */
	function moveLens(e) {
		if (!magnifier || !rendered || e.pointerType === 'touch') return;
		const box = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
		lens = { x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, h: box.height };
	}

	/**
	 * The part of the page under the pointer, enlarged into the lens.
	 *
	 * @param {{ x: number, y: number, w: number, h: number }} at
	 * @param {HTMLCanvasElement} target
	 */
	function drawLens(at, target) {
		const source = canvas ?? image;
		const { w, h } = at;
		if (!source || !w || !h) return;
		const srcW = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
		const srcH = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
		const dpr = window.devicePixelRatio || 1;
		target.width = Math.round(LENS * dpr);
		target.height = Math.round(LENS * dpr);
		const span = LENS / ZOOM;
		const sx = ((at.x - span / 2) * srcW) / w;
		const sy = ((at.y - span / 2) * srcH) / h;
		const ctx = target.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, target.width, target.height);
		ctx.drawImage(
			source,
			sx,
			sy,
			(span * srcW) / w,
			(span * srcH) / h,
			0,
			0,
			target.width,
			target.height
		);
	}

	/** @type {HTMLCanvasElement | undefined} */
	let canvas = $state();
	/** @type {string | null} */
	let imageUrl = $state(null);
	let rendered = $state(false);
	let failed = $state(false);

	let key = $derived(
		receipt.fileCid && !needsConfirmation(receipt)
			? `${receipt.id}|${receipt.fileCid}|${receipt.mime}`
			: null
	);

	$effect(() => {
		const k = key;
		const target = canvas;
		rendered = false;
		failed = false;
		if (!k) return;
		const [, fileCid, mime] = k.split('|');
		const blobs = currentBlobs();
		if (!blobs) return;
		let cancelled = false;
		/** @type {string | null} */
		let url = null;
		(async () => {
			try {
				const bytes = await blobs.get(fileCid);
				if (cancelled) return;
				if (mime === 'application/pdf' && target) {
					const { renderFirstPage } = await import('./receipts/pdf.js');
					if (cancelled) return;
					await renderFirstPage(bytes, target, width, oversample);
					if (!cancelled) rendered = true;
				} else if (mime.startsWith('image/')) {
					url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: mime }));
					imageUrl = url;
					rendered = true;
				}
			} catch (error) {
				console.error('preview failed:', error);
				if (!cancelled) failed = true;
			}
		})();
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
			imageUrl = null;
		};
	});
</script>

{#snippet lensOver()}
	{#if magnifier && lens}
		<canvas
			bind:this={lensCanvas}
			class="pointer-events-none absolute rounded-full border-2 border-cyan-800 shadow-lg dark:border-cyan"
			style:width="{LENS}px"
			style:height="{LENS}px"
			style:left="{lens.x - LENS / 2}px"
			style:top="{lens.y - LENS / 2}px"
			aria-hidden="true"
			data-testid="receipt-lens"
			data-zoom={ZOOM}
		></canvas>
	{/if}
{/snippet}

{#if key && receipt.mime === 'application/pdf'}
	<div
		class="relative rounded border border-border bg-white {magnifier
			? 'cursor-zoom-in'
			: 'overflow-hidden'}"
		onpointermove={moveLens}
		onpointerleave={() => (lens = null)}
		role="presentation"
	>
		<canvas
			bind:this={canvas}
			class="block max-w-full"
			aria-label={t('belege.preview')}
			data-testid="tx-receipt-preview"
			data-rendered={rendered ? 'true' : 'false'}
		></canvas>
		{@render lensOver()}
	</div>
{:else if key && imageUrl}
	<div
		class="relative inline-block {magnifier ? 'cursor-zoom-in' : ''}"
		onpointermove={moveLens}
		onpointerleave={() => (lens = null)}
		role="presentation"
	>
		<img
			bind:this={image}
			src={imageUrl}
			alt={t('belege.preview')}
			class="block max-h-72 max-w-full rounded border border-border"
			data-testid="tx-receipt-preview"
			data-rendered="true"
		/>
		{@render lensOver()}
	</div>
{:else if !receipt.fileCid && receipt.excerpt}
	<MailText {receipt} class="max-h-40" testid="tx-receipt-preview" />
{/if}
{#if failed}
	<p class="mt-1 text-xs text-danger">{t('belege.previewFailed')}</p>
{/if}
