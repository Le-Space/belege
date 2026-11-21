<script>
	// A scene of @le-space/charts as SVG elements. Built from the shapes, not
	// from the package's SVG text: a label may come from a synced record (a
	// wallet's name), and markup from a string does not go into the page.
	// Colours are the roles of the scene, as variables (`--chart-s1` …): the
	// chart stands inside a ChartColors, which sets them for light and dark.

	/** @type {{ scene: import('@le-space/charts').Scene, label: string, testid?: string, children?: import('svelte').Snippet }} */
	let { scene, label, testid = 'chart', children } = $props();
</script>

<svg
	class="block h-auto w-full"
	viewBox="0 0 {scene.width} {scene.height}"
	role="img"
	aria-label={label}
	data-testid={testid}
>
	{#each scene.shapes as s, i (i)}
		{#if s.type === 'rect'}
			<rect x={s.x} y={s.y} width={s.w} height={s.h} fill="var(--chart-{s.fill})"
				>{#if s.title}<title>{s.title}</title>{/if}</rect
			>
		{:else if s.type === 'line'}
			<line
				x1={s.x1}
				y1={s.y1}
				x2={s.x2}
				y2={s.y2}
				stroke="var(--chart-{s.stroke})"
				stroke-width={s.width}
			/>
		{:else if s.type === 'path'}
			<polyline
				points={s.points.map((p) => p.join(',')).join(' ')}
				fill="none"
				stroke="var(--chart-{s.stroke})"
				stroke-width={s.width}
				stroke-linejoin="round"
				stroke-linecap="round"
				data-series={s.stroke}
			/>
		{:else}
			<text
				x={s.x}
				y={s.y}
				font-size={s.size}
				text-anchor={s.anchor}
				font-weight={s.bold ? 'bold' : 'normal'}
				fill="var(--chart-{s.fill})">{s.text}</text
			>
		{/if}
	{/each}
	{@render children?.()}
</svg>
