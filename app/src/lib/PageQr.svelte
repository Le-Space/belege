<script>
	// Ported from Le-Space/simple-todo packages/ui (src/PageQr.svelte) at f0d3df4.
	// Changed: no list link and no invite to strip (this app keeps nothing in
	// the fragment), runes-only, the catalogue.
	//
	// This page as a QR code, one click from the header: the Le-Space page-QR
	// convention (le-space/landing, AGENTS.md "Page-QR convention"). The code is
	// whatever the address bar says when it is opened. Drawn here with `uqr`,
	// bundled: no request leaves the page to render it. It sits on a white
	// plaque in both themes, because a camera reads it, not the theme.
	import { renderSVG } from 'uqr';
	import { t } from './i18n/index.js';

	let open = $state(false);
	let url = $state('');
	let svg = $state('');
	/** @type {HTMLElement | undefined} */
	let root = $state();

	function toggle() {
		open = !open;
		if (!open) return;
		url = location.href;
		svg = renderSVG(url, { border: 2 });
	}

	/** @param {MouseEvent} event */
	function closeOutside(event) {
		if (open && root && !root.contains(/** @type {Node} */ (event.target))) open = false;
	}
</script>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && (open = false)}
	onclick={closeOutside}
/>

<div class="relative" bind:this={root}>
	<button
		type="button"
		onclick={toggle}
		aria-expanded={open}
		aria-label={t('pageQr.open')}
		title={t('pageQr.open')}
		class="rounded-full p-2 text-text transition hover:bg-surface hover:text-heading focus:ring-2 focus:ring-cyan focus:outline-none"
		data-testid="page-qr-button"
	>
		<!-- a QR glyph: three finder squares and some modules -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path
				d="M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zM18 13h3v3h-3zM13 18h3v3h-3zM18 18h3v3h-3z"
			/>
		</svg>
	</button>

	{#if open}
		<div
			role="dialog"
			aria-label={t('pageQr.dialog')}
			class="fixed inset-x-4 top-20 z-50 mx-auto max-w-64 rounded-xl border border-border bg-surface p-3.5 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-64"
			data-testid="page-qr-dialog"
		>
			<div class="rounded-lg bg-white p-2 leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of our own URL -->
				{@html svg}
			</div>
			<p
				class="mt-2.5 font-mono text-[0.66rem] leading-normal break-all text-faint"
				data-testid="page-qr-url"
			>
				{url}
			</p>
			<p class="mt-1.5 text-xs text-faint">{t('pageQr.hint')}</p>
		</div>
	{/if}
</div>
