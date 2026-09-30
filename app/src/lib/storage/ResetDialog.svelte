<script>
	// "Alles in diesem Browser löschen" (issue #212): what goes, what stays,
	// what to do first, and a word to type – a click alone must not delete a
	// company's books. No passkey prompt: the reset is also for when the passkey
	// or the store is what is broken, and it is offered on the unlock screen.
	import { resolve } from '$app/paths';
	import { list, t } from '$lib/i18n/index.js';
	import { confirmsReset, requestReset } from './reset.js';

	/**
	 * @type {{
	 *   open: boolean,
	 *   before?: ('export' | 'bridge' | 'invoiceApp' | 'devices')[],
	 *   onclose: () => void
	 * }}
	 */
	let { open = $bindable(false), before = [], onclose } = $props();

	const HREF = {
		export: '/export',
		bridge: '/integrationen/bridge',
		invoiceApp: '/integrationen/rechnungs-app',
		devices: '/integrationen/geraete'
	};

	/** @type {HTMLDialogElement | undefined} */
	let dialog = $state();
	let typed = $state('');
	let word = $derived(t('storage.reset.word'));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			typed = '';
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	{onclose}
	aria-labelledby="reset-h"
	class="m-auto w-[calc(100vw-2rem)] max-w-xl rounded-[14px] border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
	data-testid="reset-dialog"
>
	<h2 id="reset-h" class="text-lg font-semibold text-heading">{t('storage.reset.title')}</h2>
	<p class="mt-2 text-sm">{t('storage.reset.what')}</p>

	<p class="mt-3 text-sm font-medium text-heading">{t('storage.reset.staysTitle')}</p>
	<ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
		{#each list('storage.reset.stays') as line (line)}
			<li>{line}</li>
		{/each}
	</ul>

	<p
		class="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
	>
		{t('storage.reset.lost')}
	</p>

	{#if before.length}
		<p class="mt-3 text-sm font-medium text-heading">{t('storage.reset.beforeTitle')}</p>
		<ul class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="reset-before">
			{#each before as what (what)}
				<li>
					<a
						class="underline hover:text-heading"
						href={resolve(/** @type {any} */ (HREF[what]))}
						onclick={() => (open = false)}>{t(`storage.reset.before.${what}`)}</a
					>
				</li>
			{/each}
		</ul>
	{/if}

	<form
		class="mt-4"
		onsubmit={(e) => {
			e.preventDefault();
			if (confirmsReset(typed, word)) requestReset();
		}}
	>
		<label class="flex flex-col text-sm">
			<span>{t('storage.reset.typeLabel', { word })}</span>
			<input
				class="mt-1 min-h-11 w-48 rounded-md border px-2 font-mono text-sm uppercase"
				bind:value={typed}
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				data-testid="reset-word"
			/>
		</label>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading"
				onclick={() => (open = false)}
				data-testid="reset-cancel">{t('storage.reset.cancel')}</button
			>
			<button
				type="submit"
				class="min-h-11 rounded-md bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!confirmsReset(typed, word)}
				data-testid="reset-confirm">{t('storage.reset.confirm')}</button
			>
		</div>
	</form>
</dialog>
