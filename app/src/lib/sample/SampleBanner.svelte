<script>
	// On every page while the books hold sample data (issue #200, step 3): what
	// is shown is made up, and one click takes it out again.
	import { app } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { hasSample } from './sample.js';
	import { clearSampleData } from './actions.js';

	let busy = $state(false);
	let shown = $derived(hasSample(app));

	async function remove() {
		busy = true;
		try {
			await clearSampleData();
		} finally {
			busy = false;
		}
	}
</script>

{#if shown}
	<div
		class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
		role="status"
		data-testid="sample-banner"
	>
		<span><span class="font-semibold">{t('sample.title')}</span> {t('sample.what')}</span>
		<button
			type="button"
			class="min-h-11 rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:hover:bg-amber-900"
			disabled={busy}
			onclick={remove}
			data-testid="sample-remove">{busy ? t('sample.removing') : t('sample.remove')}</button
		>
	</div>
{/if}
