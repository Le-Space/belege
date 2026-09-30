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
	import LanguageSwitch from '$lib/LanguageSwitch.svelte';
	import SampleBanner from '$lib/sample/SampleBanner.svelte';
	import SettingsLink from '$lib/SettingsLink.svelte';
	import { page } from '$app/state';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import PwaBar from '$lib/pwa/PwaBar.svelte';
	import SectionTabs from '$lib/SectionTabs.svelte';
	import YearSwitch from '$lib/year/YearSwitch.svelte';
	import TechnicalToggle from '$lib/TechnicalToggle.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import { startLocale, t } from '$lib/i18n/index.js';
	import { app } from '$lib/session.svelte.js';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { resetPending, wipeBrowser } from '$lib/storage/reset.js';

	// The language before the first word is drawn (i18n/, #192).
	startLocale();

	let { children } = $props();

	/** @param {string} did */
	const shortDid = (did) => (did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did);

	let ready = $derived(app.status === 'ready');

	// A factory reset asked for before the reload (storage/reset.js): nothing of
	// the app is drawn or opened until this page has wiped the browser.
	const resetting = resetPending();
	let resetBlocked = $state(false);
	onMount(async () => {
		if (!resetting) return;
		const report = await wipeBrowser();
		if (report.done) location.replace(resolve('/'));
		else resetBlocked = true;
	});
</script>

{#if resetting}
	<main class="mx-auto max-w-xl px-4 py-16 text-center" data-testid="reset-running">
		<p class="text-lg font-semibold text-heading" role="status">{t('storage.reset.running')}</p>
		{#if resetBlocked}
			<p class="mt-3 text-sm text-danger" role="alert" data-testid="reset-blocked">
				{t('storage.reset.blocked')}
			</p>
			<button
				type="button"
				class="mt-4 min-h-11 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
				onclick={() => location.reload()}>{t('storage.reset.retry')}</button
			>
		{/if}
	</main>
{:else}
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
			class="mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:mb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
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
						<span class="block text-xl leading-tight sm:inline sm:text-3xl">{t('app.product')}</span
						>
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
			<div
				class="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-1 sm:col-start-3 sm:flex-nowrap sm:gap-2"
			>
				{#if ready}<SettingsLink />{/if}
				<PageQr />
				<LanguageSwitch />
				<ThemeToggle />
				<TechnicalToggle />
			</div>
		</header>

		<PwaBar />

		{#if !ready}
			<main>
				<PasskeyOnboarding />
			</main>
		{:else}
			<SampleBanner />
			<SectionTabs />
			<main>
				{#if !['/integrationen', '/einstellungen'].some((p) => page.url.pathname.startsWith(p))}
					<YearSwitch />
				{/if}
				{@render children()}
			</main>
		{/if}

		<AppFooter />
	</div>
{/if}
