<script>
	// "Braucht dich" (issue #152): what an integration needs from the person,
	// with the next step in plain words. On the Integrationen overview, and on
	// Home when there is something, so it is seen where the day starts.
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';

	/** @type {{ needs: import('./overview.js').Need[], title: string, testid?: string, more?: boolean }} */
	let { needs, title, testid = 'integrations-needs', more = false } = $props();

	const CHIP = {
		err: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
		warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
	};
	/** @param {string} id */
	const nameOf = (id) => t(`integrationen.overview.name.${id || 'mail'}`);
</script>

<section
	class="mt-4 rounded-lg border border-amber-300 bg-surface px-4 py-3 sm:px-5 dark:border-amber-700"
	aria-labelledby="{testid}-h"
	data-testid={testid}
>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 id="{testid}-h" class="text-base font-semibold text-heading">{title}</h2>
		{#if more}
			<a class="text-sm text-text underline" href={resolve('/integrationen')}
				>{t('integrationen.overview.back')}</a
			>
		{/if}
	</div>
	<ul class="mt-1 divide-y divide-border">
		{#each needs as n (n.id + n.text)}
			<li>
				<a
					href={resolve(/** @type {any} */ (`/integrationen/${n.id}`))}
					class="flex min-h-14 items-center gap-3 py-2 text-heading"
					data-testid="integrations-need"
				>
					<span class="rounded-full px-2 py-0.5 text-xs font-semibold {CHIP[n.kind]}"
						>{t(`integrationen.overview.needKind.${n.kind}`)}</span
					>
					<span class="min-w-0 flex-1 text-sm"
						><span class="font-medium">{nameOf(n.id)}</span> –
						{t(`integrationen.overview.need.${n.text}`, n.params ?? {})}</span
					>
					<span aria-hidden="true" class="text-faint">›</span>
				</a>
			</li>
		{/each}
	</ul>
</section>
