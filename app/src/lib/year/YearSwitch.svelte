<script>
	// The year all pages show (issue #100): at the top of the content, right
	// aligned. The matching stays across years; this only filters the view.
	import { t } from '../i18n/index.js';
	import { chooseYear, shownYear, startMonth, yearChoices } from './year.svelte.js';
	import { yearLabel } from './year.js';

	let year = $derived(shownYear());
	let choices = $derived(yearChoices());
</script>

<div class="mb-4 flex justify-end">
	<label class="flex items-center gap-2 text-sm text-faint"
		>{t('year.label')}
		<select
			class="rounded-md border border-border bg-surface px-2 py-1 text-sm font-medium text-heading tabular-nums"
			value={year}
			onchange={(e) => chooseYear(Number(e.currentTarget.value))}
			data-testid="year-switch"
		>
			{#each choices as y (y)}
				<option value={y}>{yearLabel(y, startMonth())}</option>
			{/each}
		</select></label
	>
</div>
