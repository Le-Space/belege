<script>
	// Einstellungen (issue #152): what the matching and the export need to know
	// – the company and its own accounts, rules, what was learned, the
	// bookkeeping (DATEV) and the chart of accounts. Moved here from
	// Integrationen, which is for what Belege is connected to.
	import MatchingSettings from '$lib/MatchingSettings.svelte';
	import { consent } from '$lib/consent.js';
	import { t } from '$lib/i18n/index.js';

	const sections = /** @type {const} */ ([
		['firma', 'settings.nav.company'],
		['abgleich', 'settings.nav.matching'],
		['gelerntes', 'settings.nav.learned'],
		['buchhaltung', 'settings.nav.books'],
		['kontenplan', 'settings.nav.chart']
	]);
	const link =
		'flex min-h-11 items-center rounded-md px-3 text-sm text-text hover:bg-surface hover:text-heading';
</script>

<svelte:head><title>{t('settings.title')} · Le Space Belege</title></svelte:head>

<h1 class="text-2xl font-bold text-heading">{t('settings.title')}</h1>
<p class="mt-1 text-sm text-text">{t('settings.intro')}</p>

<div class="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
	<nav
		aria-label={t('settings.title')}
		class="flex flex-wrap gap-1 md:sticky md:top-4 md:w-56 md:shrink-0 md:flex-col"
		data-testid="settings-nav"
	>
		{#each sections as [id, key] (id)}
			<a class={link} href="#{id}">{t(key)}</a>
		{/each}
		<button type="button" class="{link} text-left" onclick={() => consent.reopen()}
			>{t('settings.nav.privacy')}</button
		>
	</nav>
	<div class="min-w-0 flex-1 [&>section]:mt-0">
		<MatchingSettings />
	</div>
</div>
