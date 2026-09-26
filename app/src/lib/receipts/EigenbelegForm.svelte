<script>
	// "Eigenbeleg erstellen" in the detail of a booking without a receipt
	// (eigenbeleg.js).
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { createEigenbeleg, eigenbelegDraft } from './eigenbeleg.js';

	/** @type {{ tx: Record<string, any>, account: Record<string, any> | null }} */
	let { tx, account } = $props();

	let open = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);
	let counterparty = $state('');
	let description = $state('');
	let reason = $state('');

	function start() {
		const draft = eigenbelegDraft(tx);
		counterparty = draft.counterparty;
		description = draft.description;
		reason = draft.reason;
		error = null;
		done = null;
		open = true;
	}

	/** @param {SubmitEvent} event */
	async function submit(event) {
		event.preventDefault();
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs) return;
		busy = true;
		error = null;
		try {
			const { number } = await createEigenbeleg({
				store,
				blobs,
				tx,
				account,
				input: { counterparty, description, reason },
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? ''
			});
			done = t('zahlungen.detail.eigenbeleg.done', { number });
			open = false;
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const field =
		'mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';
</script>

<div class="mt-3 border-t border-border pt-3" data-testid="tx-eigenbeleg">
	{#if !open}
		<button type="button" class={button} onclick={start} data-testid="tx-eigenbeleg-open"
			>{t('zahlungen.detail.eigenbeleg.open')}</button
		>
		<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.eigenbeleg.hint')}</p>
	{:else}
		<form onsubmit={submit} class="space-y-2" data-testid="tx-eigenbeleg-form">
			<label class="block text-sm text-text">
				{t('zahlungen.detail.eigenbeleg.counterparty')}
				<input class={field} bind:value={counterparty} data-testid="tx-eigenbeleg-counterparty" />
			</label>
			<label class="block text-sm text-text">
				{t('zahlungen.detail.eigenbeleg.description')}
				<input
					class={field}
					required
					bind:value={description}
					data-testid="tx-eigenbeleg-description"
				/>
			</label>
			<label class="block text-sm text-text">
				{t('zahlungen.detail.eigenbeleg.reason')}
				<textarea
					class={field}
					rows="2"
					required
					bind:value={reason}
					data-testid="tx-eigenbeleg-reason"
				></textarea>
			</label>
			<div class="flex gap-2">
				<button
					type="submit"
					class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={busy}
					data-testid="tx-eigenbeleg-create"
					>{busy
						? t('zahlungen.detail.eigenbeleg.creating')
						: t('zahlungen.detail.eigenbeleg.create')}</button
				>
				<button type="button" class={button} onclick={() => (open = false)} disabled={busy}
					>{t('zahlungen.detail.eigenbeleg.cancel')}</button
				>
			</div>
		</form>
	{/if}
	{#if done}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-eigenbeleg-done">{done}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="tx-eigenbeleg-error">{error}</p>
	{/if}
</div>
