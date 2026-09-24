<script>
	// One icon per tab. Drawn here rather than taken from a library, in the
	// style of Le-Space/simple-todo apps/escrow01 (src/lib/SectionIcon.svelte):
	// 24-unit grid, 1.8 stroke, round caps and joins, no fill. Five shapes do
	// not justify a dependency.

	/** @type {{ name: 'home' | 'zahlungen' | 'belege' | 'export' | 'integrationen' }} */
	let { name } = $props();
</script>

<svg
	class="h-5 w-5 shrink-0"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	data-icon={name}
>
	{#if name === 'home'}
		<!-- A house with a door. -->
		<path d="M3.5 11 12 4l8.5 7" />
		<path d="M6 9.5v10h12v-10" />
		<path d="M10 19.5v-5h4v5" />
	{:else if name === 'zahlungen'}
		<!-- Money going out and coming in. -->
		<path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5" />
		<path d="M20 16H7M10.5 12.5 7 16l3.5 3.5" />
	{:else if name === 'belege'}
		<!-- A till receipt: lines of text, a torn edge. -->
		<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
		<path d="M9 8h6M9 11.5h6M9 15h3.5" />
	{:else if name === 'export'}
		<!-- Out of the tray: the month's package leaving. -->
		<path d="M12 14.5V4M8 7.5l4-4 4 4" />
		<path d="M4.5 13v5.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
	{:else}
		<!-- A plug: the bank, through the bridge. -->
		<path d="M9 3.5v4M15 3.5v4" />
		<path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z" />
		<path d="M12 16v4.5" />
	{/if}
</svg>
