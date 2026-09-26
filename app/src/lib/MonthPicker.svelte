<script>
	// A month as `YYYY-MM`: a month and a year to pick, each from a list.
	// Instead of the browser's own month field, whose year is hard to change
	// (a segment to click and arrow through, tiny arrows in the calendar).
	import { t } from './i18n/index.js';

	/** @type {{ value: string, label: string, testid: string, years?: number }} */
	let { value = $bindable(''), label, testid, years = 10 } = $props();

	const MONTH_NAME = new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' });
	const MONTHS = Array.from({ length: 12 }, (_, i) => ({
		value: String(i + 1).padStart(2, '0'),
		name: MONTH_NAME.format(new Date(Date.UTC(2020, i, 1)))
	}));

	let year = $derived(/^\d{4}-\d{2}$/.test(value) ? value.slice(0, 4) : '');
	let month = $derived(/^\d{4}-\d{2}$/.test(value) ? value.slice(5, 7) : '');
	// This year and the ones before; a value further back stays choosable.
	let yearList = $derived.by(() => {
		const now = new Date().getFullYear();
		const list = Array.from({ length: years }, (_, i) => String(now - i));
		if (year && !list.includes(year)) list.push(year);
		return list.sort().reverse();
	});

	/** @param {string} y @param {string} m */
	function set(y, m) {
		value = `${y || String(new Date().getFullYear())}-${m || '01'}`;
	}
</script>

<fieldset class="flex flex-col text-sm" data-testid={testid}>
	<legend class="text-faint">{label}</legend>
	<div class="mt-1 flex gap-1">
		<select
			class="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-heading"
			aria-label={t('monthPicker.month', { label })}
			value={month}
			onchange={(e) => set(year, e.currentTarget.value)}
			data-testid={`${testid}-month`}
		>
			{#each MONTHS as m (m.value)}
				<option value={m.value}>{m.name}</option>
			{/each}
		</select>
		<select
			class="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-heading tabular-nums"
			aria-label={t('monthPicker.year', { label })}
			value={year}
			onchange={(e) => set(e.currentTarget.value, month)}
			data-testid={`${testid}-year`}
		>
			{#each yearList as y (y)}
				<option value={y}>{y}</option>
			{/each}
		</select>
	</div>
</fieldset>
