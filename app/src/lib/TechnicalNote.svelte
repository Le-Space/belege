<script>
	// The technical level next to a plain explanation, shown only while the
	// page's technical view is on. The look is Le-Space/simple-todo apps/escrow01's
	// TechnicalExplanation.svelte (a violet-edged panel with a "Technisch" tag);
	// the content is a plain list of sentences from the catalogue.
	//
	// `folded`: where the note is about a whole page and not about the thing next
	// to it, it starts as one line – the tag and the beginning of the first
	// sentence, cut by the width – and opens to the full list on a click. The
	// sentences are the same either way; nothing is shortened in the catalogue.
	import { t } from './i18n/index.js';
	import { technicalView } from './technical-view.js';

	/** @type {{ lines: string[], title?: string, testid?: string, class?: string, folded?: boolean }} */
	let {
		lines,
		title = '',
		testid = 'technical-note',
		class: className = '',
		folded = false
	} = $props();
	let open = $state(false);

	const panel =
		'rounded-lg border border-l-4 border-border border-l-infra bg-surface-2 px-3 py-2.5 text-left sm:px-4';
	const tag =
		'shrink-0 rounded bg-infra-200 px-1.5 py-0.5 text-xs font-semibold text-infra-800 dark:bg-infra/15 dark:text-infra';
</script>

{#snippet list()}
	<ul
		class="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-text"
		data-testid="technical-note-lines"
	>
		{#each lines as line (line)}
			<li>{line}</li>
		{/each}
	</ul>
{/snippet}

{#if $technicalView && lines.length > 0}
	{#if folded}
		<details class="{panel} {className}" data-testid={testid} bind:open>
			<summary class="flex cursor-pointer items-center gap-2">
				<span class={tag}>{t('technical.tag')}</span>
				{#if title}<span class="shrink-0 text-sm font-semibold text-heading">{title}</span>{/if}
				{#if !open}
					<span class="min-w-0 flex-1 truncate text-sm text-text">{lines[0]}</span>
				{/if}
				<span class="ml-auto shrink-0 text-xs text-faint" aria-hidden="true"
					>{open ? '▴' : '▾'}</span
				>
			</summary>
			{@render list()}
		</details>
	{:else}
		<div class="{panel} {className}" data-testid={testid}>
			<p class="flex items-center gap-2">
				<span class={tag}>{t('technical.tag')}</span>
				{#if title}<span class="text-sm font-semibold text-heading">{title}</span>{/if}
			</p>
			{@render list()}
		</div>
	{/if}
{/if}
