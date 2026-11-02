<script>
	// Right after new books are made (#406, stage 2): recovery words are offered,
	// and may wait. "Später" closes this for the session; Einstellungen →
	// Schlüssel keeps saying it while there is one passkey and no words.
	import { resolve } from '$app/paths';
	import { app } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';

	const shown = $derived(app.offerWords && !app.vault.words && app.vault.slots.length < 2);
</script>

{#if shown}
	<div
		class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
		role="note"
		data-testid="words-offer"
	>
		<span
			><span class="font-semibold">{t('settings.keys.words.offerTitle')}</span>
			{t('settings.keys.words.offer')}</span
		>
		<span class="flex flex-wrap gap-2">
			<a
				class="inline-flex min-h-11 items-center rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
				href={`${resolve('/einstellungen')}#schluessel`}
				onclick={() => (app.offerWords = false)}
				data-testid="words-offer-go">{t('settings.keys.words.offerGo')}</a
			>
			<button
				type="button"
				class="min-h-11 rounded-md px-3 underline"
				onclick={() => (app.offerWords = false)}
				data-testid="words-offer-later">{t('settings.keys.words.offerLater')}</button
			>
		</span>
	</div>
{/if}
