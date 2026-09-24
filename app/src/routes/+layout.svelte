<script>
	// The shell, after Le-Space/simple-todo apps/escrow01 (src/routes/+page.svelte)
	// at f0d3df4: a header with the mark, the app's name and the switches, the
	// tabs under it (at the foot on a phone), the page, the footer. The consent
	// screen comes first on a first visit; the passkey after it.
	import '../app.css';
	import AppFooter from '$lib/AppFooter.svelte';
	import ConsentModal from '$lib/ConsentModal.svelte';
	import BelegeMark from '$lib/BelegeMark.svelte';
	import LocalOnlyBadge from '$lib/LocalOnlyBadge.svelte';
	import PageQr from '$lib/PageQr.svelte';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import SectionTabs from '$lib/SectionTabs.svelte';
	import TechnicalToggle from '$lib/TechnicalToggle.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import { t } from '$lib/i18n/index.js';
	import { app } from '$lib/session.svelte.js';

	let { children } = $props();

	/** @param {string} did */
	const shortDid = (did) => (did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did);

	let ready = $derived(app.status === 'ready');
</script>

<ConsentModal />

<div
	class="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6 sm:pb-6"
	class:pb-28={ready}
	class:pb-6={!ready}
>
	<!--
		A grid, as in escrow01: on a phone the name and the switches share the
		first row and the state takes the second; from `sm` on, one row.
	-->
	<header
		class="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:mb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
	>
		<div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
			<a
				href="https://local-first.le-space.de"
				target="_blank"
				rel="noopener noreferrer"
				class="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-cyan focus-visible:outline-none"
				aria-label={t('header.localFirst')}
				title={t('header.localFirst')}
				data-testid="local-first-link"
			>
				<BelegeMark size={44} />
			</a>
			<div class="min-w-0">
				<p class="font-bold text-heading sm:truncate sm:text-3xl" data-testid="app-name">
					<span
						class="block text-xs font-semibold tracking-wide text-faint sm:inline sm:text-3xl sm:font-bold sm:tracking-normal sm:text-heading"
						>{t('app.maker')}</span
					>
					<span class="block text-xl leading-tight sm:inline sm:text-3xl">{t('app.product')}</span>
				</p>
				<p class="mt-0.5 hidden text-sm text-faint sm:block">{t('app.tagline')}</p>
			</div>
		</div>
		<div
			class="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
		>
			<LocalOnlyBadge />
			{#if ready && app.did}
				<span
					class="max-w-full truncate rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-xs text-text"
					title={`${t('header.did')}: ${app.did}`}
					data-testid="own-did"
					data-did={app.did}>{shortDid(app.did)}</span
				>
			{/if}
		</div>
		<div class="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3 sm:gap-2">
			<PageQr />
			<ThemeToggle />
			<TechnicalToggle />
		</div>
	</header>

	{#if !ready}
		<main>
			<PasskeyOnboarding />
		</main>
	{:else}
		<SectionTabs />
		<main>
			{@render children()}
		</main>
	{/if}

	<AppFooter />
</div>
