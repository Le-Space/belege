<script>
	// "Aus Paperless holen" on the Belege page (issue #318): what Paperless-ngx
	// added since the last fetch, through the bridge (paperless/import.js). Once
	// when the page opens, and on a click. While Paperless is on, Belege does not
	// read the mailbox itself – Paperless' mail rules do – unless the person
	// says so; then documents with the tags named here are left out, so that each
	// mail is read once.
	import { onMount } from 'svelte';
	import { currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { fetchPaperless, parseTags, savePaperlessSettings } from './import.js';

	/**
	 * @type {{
	 *   client: { paperlessDocuments: (since: string | null) => Promise<any[]>, paperlessDocument: (id: number) => Promise<Uint8Array> },
	 *   settings: import('./import.js').PaperlessSettings,
	 *   onNew: (ids: string[]) => Promise<void> | void
	 * }}
	 */
	let { client, settings = $bindable(), onNew } = $props();

	let busy = $state(false);
	/** @type {{ done: number, total: number } | null} where the fetch is */
	let progress = $state(null);
	/** @type {string | null} */
	let result = $state(null);
	/** @type {string | null} */
	let error = $state(null);
	let tagsText = $state(settings.skipTags.join(', '));

	async function fetchNow() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || busy) return;
		busy = true;
		error = null;
		result = null;
		/** @type {string[]} */
		let created = [];
		try {
			const { documents, counts, createdIds } = await fetchPaperless({
				store,
				blobs,
				client,
				onProgress: (p) => (progress = p)
			});
			result = [
				t('belege.paperless.result', { documents, ...counts }),
				counts.failed ? t('belege.paperless.failed', { count: counts.failed }) : ''
			]
				.filter(Boolean)
				.join(' ');
			created = createdIds;
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			progress = null;
		}
		if (created.length) await onNew(created);
	}

	/** @param {Partial<import('./import.js').PaperlessSettings>} change */
	async function save(change) {
		const store = currentStore();
		if (store) settings = await savePaperlessSettings(store.settings, change);
	}

	onMount(() => {
		fetchNow();
	});
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="paperless-h"
	data-testid="paperless-card"
>
	<h2 id="paperless-h" class="text-lg font-semibold">{t('belege.paperless.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('belege.paperless.intro')}</p>
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<button
			type="button"
			class={btn.primary}
			onclick={fetchNow}
			disabled={busy}
			data-testid="paperless-fetch"
			>{busy ? t('belege.paperless.fetching') : t('belege.paperless.fetch')}</button
		>
		{#if busy && progress?.total}
			<span class="text-sm text-faint" role="status" data-testid="paperless-progress"
				>{t('belege.paperless.progress', { done: progress.done, total: progress.total })}</span
			>
		{/if}
	</div>
	{#if result}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="paperless-result">{result}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="paperless-error">{error}</p>
		<WayOut message={error} />
	{/if}
	<label class="mt-3 flex items-center gap-2 text-sm text-text">
		<input
			type="checkbox"
			class="size-5"
			checked={settings.mailToo}
			onchange={(e) => save({ mailToo: e.currentTarget.checked })}
			data-testid="paperless-mail-too"
		/>
		{t('belege.paperless.mailToo')}
	</label>
	{#if settings.mailToo}
		<label class="mt-2 flex flex-col text-sm text-text"
			>{t('belege.paperless.skipTags')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
				placeholder="aus-Mail"
				bind:value={tagsText}
				onchange={() => save({ skipTags: parseTags(tagsText) })}
				data-testid="paperless-skip-tags"
			/>
		</label>
		<p class="mt-1 text-xs text-faint">{t('belege.paperless.skipTagsHint')}</p>
	{/if}
</section>
