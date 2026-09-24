<script>
	// A small preview of one receipt for the Zahlungen detail: page 1 of a PDF
	// on a canvas, an image as it is, a mail's text. A receipt whose sender is
	// not confirmed is not opened (receipts/import.js `needsConfirmation`).
	import { currentBlobs } from './session.svelte.js';
	import { needsConfirmation } from './receipts/import.js';
	import { t } from './i18n/index.js';

	/** @type {{ receipt: Record<string, any>, width?: number }} */
	let { receipt, width = 260 } = $props();

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
					await renderFirstPage(bytes, target, width);
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

{#if key && receipt.mime === 'application/pdf'}
	<div class="overflow-hidden rounded border border-border bg-white">
		<canvas
			bind:this={canvas}
			class="block max-w-full"
			aria-label={t('belege.preview')}
			data-testid="tx-receipt-preview"
			data-rendered={rendered ? 'true' : 'false'}
		></canvas>
	</div>
{:else if key && imageUrl}
	<img
		src={imageUrl}
		alt={t('belege.preview')}
		class="max-h-72 max-w-full rounded border border-border"
		data-testid="tx-receipt-preview"
		data-rendered="true"
	/>
{:else if !receipt.fileCid && receipt.excerpt}
	<pre
		class="max-h-40 overflow-auto rounded border border-border bg-surface-2 p-2 font-sans text-xs whitespace-pre-wrap text-text"
		data-testid="tx-receipt-preview"
		data-rendered="true">{receipt.excerpt}</pre>
{/if}
{#if failed}
	<p class="mt-1 text-xs text-danger">{t('belege.previewFailed')}</p>
{/if}
