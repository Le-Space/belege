<script>
	// The colours of a chart, for everything inside: the chart itself
	// (ChartScene.svelte) and what names its lines beside it (a checkbox's
	// swatch). Text, grid and axis follow the app's theme; the series take the
	// palette of @le-space/charts, its light values or its dark ones.
	import { PALETTE } from '@le-space/charts';

	/** @type {{ children: import('svelte').Snippet, class?: string }} */
	let { children, class: className = '' } = $props();

	const SERIES = /** @type {const} */ (['s1', 's2', 's3', 's4', 'other']);
	const palette = SERIES.map(
		(r) => `--chart-light-${r}:${PALETTE.light[r]};--chart-dark-${r}:${PALETTE.dark[r]}`
	).join(';');
</script>

<div class="chart-colors {className}" style={palette}>
	{@render children()}
</div>

<style>
	.chart-colors {
		--chart-text: var(--heading);
		--chart-muted: var(--text);
		--chart-grid: var(--border);
		--chart-axis: var(--faint);
		--chart-surface: var(--surface);
		--chart-s1: var(--chart-light-s1);
		--chart-s2: var(--chart-light-s2);
		--chart-s3: var(--chart-light-s3);
		--chart-s4: var(--chart-light-s4);
		--chart-other: var(--chart-light-other);
	}
	:global(.dark) .chart-colors {
		--chart-s1: var(--chart-dark-s1);
		--chart-s2: var(--chart-dark-s2);
		--chart-s3: var(--chart-dark-s3);
		--chart-s4: var(--chart-dark-s4);
		--chart-other: var(--chart-dark-other);
	}
</style>
