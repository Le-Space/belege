<script>
	// Uploading receipts from every page (issue #308, upload.svelte.js): a
	// button in the header (a "+" above the tab bar on a phone) opens a panel
	// with a drop zone; files dropped anywhere on a page are uploaded too –
	// unless a drop zone of the page took them (a payment's own, which links
	// its receipt). Shown only while the books are open.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n/index.js';
	import AiMark from '$lib/AiMark.svelte';
	import {
		ACCEPT,
		fromFiles,
		loadUpload,
		setReadAfter,
		upload,
		uploadFiles
	} from './upload.svelte.js';

	let open = $state(false);
	let over = $state(false);
	/** Drag enters and leaves fire for every child: counted, so the overlay does not flicker. */
	let depth = 0;
	/** @type {HTMLInputElement | undefined} */
	let input = $state();
	/** @type {HTMLButtonElement | undefined} */
	let zone = $state();

	// The switch and the bridge's model, for a drop before the panel was ever opened.
	onMount(() => {
		void loadUpload();
	});

	async function show() {
		open = true;
		await loadUpload();
		zone?.focus();
	}

	/** @param {File[]} files */
	async function send(files) {
		if (!files.length) return;
		open = true;
		await uploadFiles(fromFiles(files));
	}

	/** @param {DragEvent} e */
	const hasFiles = (e) => Boolean(e.dataTransfer?.types?.includes('Files'));

	async function toReceipts() {
		const first = upload.created[0];
		open = false;
		await goto(`${resolve('/belege')}${first ? `?receipt=${encodeURIComponent(first)}` : ''}`);
	}
</script>

<svelte:window
	ondragenter={(e) => {
		if (!hasFiles(e)) return;
		depth++;
		over = true;
	}}
	ondragleave={(e) => {
		if (!hasFiles(e)) return;
		depth = Math.max(0, depth - 1);
		if (depth === 0) over = false;
	}}
	ondragover={(e) => {
		// A drop zone of the page took it: its own overlay shows.
		if (!hasFiles(e) || e.defaultPrevented) {
			if (e.defaultPrevented) over = false;
			return;
		}
		e.preventDefault();
		over = true;
	}}
	ondrop={(e) => {
		depth = 0;
		over = false;
		if (!hasFiles(e) || e.defaultPrevented) return;
		e.preventDefault();
		void send([...(e.dataTransfer?.files ?? [])]);
	}}
	onkeydown={(e) => {
		if (open && e.key === 'Escape') open = false;
	}}
/>

<button
	type="button"
	class="hidden min-h-9 items-center gap-1.5 rounded-md bg-coral-700 px-3 text-sm font-medium text-white hover:bg-coral-800 md:inline-flex"
	onclick={show}
	data-testid="upload-open"
	><span aria-hidden="true" class="text-base leading-none">+</span>{t('uploadPanel.open')}</button
>
<!-- On a phone (and where the tab row has no room): above the tab bar, bottom right. -->
<button
	type="button"
	class="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-coral-700 text-3xl leading-none text-white shadow-lg hover:bg-coral-800 md:hidden"
	onclick={show}
	aria-label={t('uploadPanel.open')}
	title={t('uploadPanel.open')}
	data-testid="upload-open-fab">+</button
>

{#if over}
	<div
		class="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-surface/85 p-6"
		data-testid="upload-drop-overlay"
	>
		<div
			class="rounded-xl border-2 border-dashed border-coral-700 px-10 py-12 text-xl font-semibold text-heading dark:border-coral"
		>
			{t('uploadPanel.drop')}
		</div>
	</div>
{/if}

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
	>
		<div
			class="w-full max-w-lg rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5"
			role="dialog"
			aria-modal="true"
			aria-labelledby="upload-title"
			data-testid="upload-panel"
		>
			<div class="flex items-center justify-between gap-3">
				<h2 id="upload-title" class="text-lg font-semibold text-heading">
					{t('uploadPanel.title')}
				</h2>
				<button
					type="button"
					class="rounded-md px-2 py-1 text-sm text-faint underline hover:text-heading"
					onclick={() => (open = false)}
					data-testid="upload-close">{t('uploadPanel.close')}</button
				>
			</div>
			<button
				type="button"
				bind:this={zone}
				class="mt-4 flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-coral-700 bg-surface-2 px-4 py-10 text-center hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-60 dark:border-coral"
				onclick={() => input?.click()}
				disabled={upload.busy}
				data-testid="upload-zone"
			>
				<span class="text-xl font-semibold text-heading"
					><span aria-hidden="true" class="mr-1.5">⊕</span>{upload.busy
						? t('uploadPanel.busy')
						: t('uploadPanel.zone')}</span
				>
				<span class="text-sm text-text italic">{t('uploadPanel.zoneHint')}</span>
				<span class="mt-1 text-xs text-faint">{t('uploadPanel.types')}</span>
			</button>
			<input
				bind:this={input}
				type="file"
				class="sr-only"
				multiple
				accept={ACCEPT}
				tabindex="-1"
				onchange={(e) => {
					const el = /** @type {HTMLInputElement} */ (e.currentTarget);
					void send([...(el.files ?? [])]);
					el.value = '';
				}}
				data-testid="receipt-upload"
			/>
			{#if upload.llm}
				<label class="mt-3 flex items-center gap-2 text-sm text-text">
					<input
						type="checkbox"
						checked={upload.readAfter}
						onchange={(e) => setReadAfter(e.currentTarget.checked)}
						data-testid="upload-read-after"
					/>
					<span class="inline-flex items-center gap-1"><AiMark />{t('belege.uploadReadAfter')}</span
					>
				</label>
			{/if}
			{#if upload.result}
				<p class="mt-3 text-sm text-heading" role="status">
					<span data-testid="import-result">{upload.result}</span>
					{#if upload.created.length}
						<button
							type="button"
							class="ml-1 underline"
							onclick={toReceipts}
							data-testid="upload-goto">{t('uploadPanel.goto')}</button
						>
					{/if}
				</p>
			{/if}
			{#if upload.error}
				<p class="mt-3 text-sm text-danger" role="alert" data-testid="import-error">
					{upload.error}
				</p>
			{/if}
		</div>
	</div>
{/if}
