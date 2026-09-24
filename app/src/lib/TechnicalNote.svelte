<script>
	// The technical level next to a plain explanation, shown only while the
	// page's technical view is on. The look is Le-Space/simple-todo apps/escrow01's
	// TechnicalExplanation.svelte (a violet-edged panel with a "Technisch" tag);
	// the content is a plain list of sentences from the catalogue.
	import { t } from './i18n/index.js';
	import { technicalView } from './technical-view.js';

	/** @type {{ lines: string[], title?: string, testid?: string, class?: string }} */
	let { lines, title = '', testid = 'technical-note', class: className = '' } = $props();
</script>

{#if $technicalView && lines.length > 0}
	<div
		class="rounded-lg border border-l-4 border-border border-l-infra bg-surface-2 px-3 py-2.5 text-left sm:px-4 {className}"
		data-testid={testid}
	>
		<p class="flex items-center gap-2">
			<span
				class="shrink-0 rounded bg-infra-200 px-1.5 py-0.5 text-xs font-semibold text-infra-800 dark:bg-infra/15 dark:text-infra"
				>{t('technical.tag')}</span
			>
			{#if title}<span class="text-sm font-semibold text-heading">{title}</span>{/if}
		</p>
		<ul class="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-text">
			{#each lines as line (line)}
				<li>{line}</li>
			{/each}
		</ul>
	</div>
{/if}
