<script>
	// A receipt that is the mail itself, as text (#288): the whole text of the
	// mail as received where Belege kept it (`emlCid`), else the excerpt of the
	// fetch. Always text in a <pre>: no HTML rendered, nothing remote loaded.
	//
	// With a bridge `client`, a receipt imported before the original was kept
	// offers "Original holen" while its mail is still in the mailbox, and says
	// so when it is not.
	import { currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { emlText } from './eml.js';
	import { fetchMailOriginal } from './import.js';

	/** @type {{ receipt: Record<string, any>, client?: any, class?: string, testid?: string }} */
	let { receipt, client = null, class: cls = '', testid = 'preview-text' } = $props();

	/** @type {string | null} the original's text, once read */
	let full = $state(null);
	let busy = $state(false);
	/** @type {'unavailable' | null} */
	let problem = $state(null);

	$effect(() => {
		const cid = receipt.emlCid;
		full = null;
		if (!cid) return;
		let stale = false;
		currentBlobs()
			?.get(String(cid))
			.then((bytes) => {
				if (!stale) full = emlText(bytes) || null;
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	});

	async function fetchOriginal() {
		const store = /** @type {any} */ (currentStore());
		const blobs = currentBlobs();
		if (!store || !blobs || !client) return;
		busy = true;
		problem = null;
		try {
			const outcome = await fetchMailOriginal({
				receipts: store.receipts,
				blobs,
				client,
				receipt: $state.snapshot(receipt)
			});
			if (outcome === 'unavailable') problem = 'unavailable';
			await refreshNow();
		} finally {
			busy = false;
		}
	}
</script>

<pre
	class="overflow-auto rounded border border-border bg-surface-2 p-2 font-sans text-xs whitespace-pre-wrap text-text {cls}"
	data-testid={testid}
	data-rendered="true"
	data-original={full ? 'true' : 'false'}>{full ?? receipt.excerpt}</pre>
{#if client && receipt.source === 'mail' && !receipt.fileCid}
	{#if receipt.emlCid}
		<p class="mt-1 text-xs text-faint" data-testid="mail-original-kept">
			{t('belege.mailOriginal.kept')}
		</p>
	{:else if receipt.emlGone}
		<p class="mt-1 text-xs text-warning" data-testid="mail-original-gone">
			{t('belege.mailOriginal.gone')}
		</p>
	{:else if receipt.mailId}
		<p class="mt-1 text-xs text-faint">
			{t('belege.mailOriginal.missing')}
			<button
				type="button"
				class="underline"
				disabled={busy}
				onclick={fetchOriginal}
				data-testid="mail-original-fetch">{t('belege.mailOriginal.fetch')}</button
			>
		</p>
		{#if problem}
			<p class="mt-1 text-xs text-danger" role="status" data-testid="mail-original-problem">
				{t('belege.mailOriginal.unavailable')}
			</p>
		{/if}
	{/if}
{/if}
