<script>
	// At the top of Home while the books have neither a backup nor a second own
	// device (#1053): Belege is not a cloud app, and Le Space cannot restore
	// anything. "Verstanden" is kept in the sealed settings (acknowledgments.js)
	// and makes it small; it goes only once there is a backup or a device.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { app } from '$lib/session.svelte.js';
	import { integrationFacts } from '$lib/integrations/facts.svelte.js';
	import {
		acknowledge,
		acknowledged,
		acks,
		loadAcknowledgments
	} from '$lib/acknowledgments.svelte.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { noCopy } from './safety.js';

	onMount(() => {
		loadAcknowledgments();
	});

	let shown = $derived(
		acks.loaded &&
			noCopy({
				lastBackup: integrationFacts().lastBackup ?? null,
				devices: (app.sync.state?.devices ?? []).length,
				empty: !app.transactions.length && !app.receipts.length
			})
	);
	let small = $derived(acknowledged('no-backup'));
	let busy = $state(false);

	async function understood() {
		busy = true;
		try {
			await acknowledge('no-backup');
		} finally {
			busy = false;
		}
	}
</script>

{#if shown}
	{#if small}
		<p
			class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-l-4 border-border border-l-warning bg-surface px-3 py-2 text-sm text-heading"
			role="note"
			data-testid="cloud-banner"
			data-size="small"
		>
			<span class="min-w-0 flex-1">{t('home.safety.cloud.short')}</span>
			<a class="text-link underline" href={resolve('/integrationen/backup')}
				>{t('home.safety.cloud.setup')}</a
			>
		</p>
	{:else}
		<section
			class="mb-4 rounded-lg border border-l-4 border-border border-l-warning bg-surface px-5 py-4 shadow-sm"
			aria-labelledby="cloud-banner-h"
			data-testid="cloud-banner"
			data-size="full"
		>
			<h2 id="cloud-banner-h" class="text-lg font-semibold text-heading">
				{t('home.safety.cloud.title')}
			</h2>
			<p class="mt-1 text-sm text-text">{t('home.safety.cloud.text')}</p>
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<a class="inline-flex items-center {btn.primary}" href={resolve('/integrationen/backup')}
					>{t('home.safety.cloud.setup')}</a
				>
				<button
					type="button"
					class={btn.secondary}
					disabled={busy}
					onclick={understood}
					data-testid="cloud-banner-ok">{t('home.safety.cloud.ok')}</button
				>
			</div>
		</section>
	{/if}
{/if}
