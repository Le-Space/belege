<script>
	// Ported from Le-Space/simple-todo apps/escrow01 (src/lib/ThemeToggle.svelte) at f0d3df4.
	// Changed: the storage key (`belege.theme`, read by the no-flash script in
	// app.html) and the strings' catalogue.
	//
	// Light/dark: flips a `.dark` class on <html>, remembers the choice, and
	// keeps <meta name="theme-color"> in step.
	import { onMount } from 'svelte';
	import { t } from './i18n/index.js';

	const THEME_STORAGE_KEY = 'belege.theme';

	let dark = $state(false);

	onMount(() => {
		dark = document.documentElement.classList.contains('dark');
	});

	/** @param {boolean} next */
	function apply(next) {
		dark = next;
		document.documentElement.classList.toggle('dark', next);
		try {
			localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
		} catch {
			/* storage unavailable: this page load only */
		}
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', next ? '#0B0E15' : '#EDF1F8');
	}
</script>

<button
	type="button"
	onclick={() => apply(!dark)}
	class="rounded-full p-2 text-text transition hover:bg-surface hover:text-heading focus:ring-2 focus:ring-cyan focus:outline-none"
	aria-label={dark ? t('theme.toLight') : t('theme.toDark')}
	title={dark ? t('theme.light') : t('theme.dark')}
	data-testid="theme-toggle"
	data-theme={dark ? 'dark' : 'light'}
>
	{#if dark}
		<!-- sun -->
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="4" />
			<path
				d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
			/>
		</svg>
	{:else}
		<!-- moon -->
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{/if}
</button>
