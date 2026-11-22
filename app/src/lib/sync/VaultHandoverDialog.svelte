<script>
	// A new device with its own passkey asks for the vault (#962,
	// session/devices.js `handOverIfAsked`): "Zulassen" gives it the books;
	// "Ablehnen" or Escape gives it nothing.
	import { app } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog = $state();
	let asking = $derived(app.sync.handover);

	$effect(() => {
		if (!dialog) return;
		if (asking && !dialog.open) dialog.showModal();
		else if (!asking && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	oncancel={(e) => {
		e.preventDefault();
		asking?.answer(false);
	}}
	aria-labelledby="handover-h"
	class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-[14px] border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
	data-testid="handover-dialog"
>
	{#if asking}
		<h2 id="handover-h" class="text-lg font-semibold text-heading">
			{t('devices.handover.title')}
		</h2>
		<p class="mt-2 text-sm leading-relaxed">{t('devices.handover.what')}</p>
		<p class="mt-2 text-sm leading-relaxed" data-testid="handover-compare">
			{t('devices.handover.compare', { peer: asking.peer, self: asking.self })}
		</p>
		<p class="mt-2 text-sm leading-relaxed text-faint">{t('devices.handover.only')}</p>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading"
				onclick={() => asking?.answer(false)}
				autofocus
				data-testid="handover-deny">{t('devices.handover.deny')}</button
			>
			<button
				type="button"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800"
				onclick={() => asking?.answer(true)}
				data-testid="handover-allow">{t('devices.handover.allow')}</button
			>
		</div>
	{/if}
</dialog>
