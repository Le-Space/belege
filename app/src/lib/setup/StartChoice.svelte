<script>
	// The first run (issue #200): how to start – look around, a bank statement
	// file (no bridge needed), or the full path with the bridge. Shown on Home
	// in place of the checklist until one is chosen; the checklist then puts
	// the matching step first (steps.js).
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import { STARTS } from './steps.js';
	import { chooseStart } from './setup-state.svelte.js';

	/** @param {import('./steps.js').Start} start */
	async function choose(start) {
		await chooseStart(start);
		// The file import is on the bank's page; the other two go on here.
		if (start === 'file') await goto(resolve('/integrationen/bank'));
	}
</script>

<section
	class="mt-4 rounded-lg border border-cyan-800/40 bg-surface px-4 py-4 sm:px-5 dark:border-cyan/40"
	aria-labelledby="start-h"
	data-testid="setup-start"
>
	<h2 id="start-h" class="text-lg font-semibold text-heading">{t('setup.start.title')}</h2>
	<p class="mt-1 text-sm text-faint">{t('setup.start.intro')}</p>
	<div class="mt-3 grid gap-3 sm:grid-cols-3">
		{#each STARTS as start (start)}
			<button
				type="button"
				class="flex min-h-11 flex-col rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-cyan-800 hover:bg-surface-2 dark:hover:border-cyan"
				onclick={() => choose(start)}
				data-testid="setup-start-{start}"
			>
				<span class="font-medium text-heading">{t(`setup.start.${start}.title`)}</span>
				<span class="mt-1 text-sm text-text">{t(`setup.start.${start}.text`)}</span>
			</button>
		{/each}
	</div>
</section>
