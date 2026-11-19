<script>
	// One part of Einstellungen on its own page, reached from the overview
	// (einstellungen/+page.svelte) or by its address.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import MatchingSettings from '$lib/MatchingSettings.svelte';
	import SetupChecklist from '$lib/setup/SetupChecklist.svelte';
	import StorageCard from '$lib/storage/StorageCard.svelte';
	import KeysCard from '$lib/keys/KeysCard.svelte';
	import TravellersCard from '$lib/travel/TravellersCard.svelte';
	import { t } from '$lib/i18n/index.js';
	import { SETTINGS_SECTIONS, isSettingsSection } from '$lib/settings/sections.js';

	let id = $derived(page.params.id ?? '');
	let section = $derived(SETTINGS_SECTIONS.find((s) => s.id === id));
	const FORM = /** @type {const} */ ([
		'firma',
		'abgleich',
		'gelerntes',
		'buchhaltung',
		'kontenplan'
	]);
	let part = $derived(FORM.find((f) => f === id));
</script>

<svelte:head
	><title
		>{section ? t(`settings.nav.${section.key}`) : t('settings.title')} · Le Space Belege</title
	></svelte:head
>

<nav aria-label={t('settings.title')} class="text-sm text-faint">
	<a class="underline" href={resolve('/einstellungen')} data-testid="settings-back"
		>← {t('settings.back')}</a
	>
</nav>

{#if !section || !isSettingsSection(id)}
	<h1 class="mt-2 text-2xl font-bold text-heading">{t('settings.title')}</h1>
	<p class="mt-2 text-sm text-text" data-testid="settings-unknown">{t('settings.unknown')}</p>
{:else}
	<h1 class="mt-2 text-2xl font-bold text-heading" data-testid="settings-section-title">
		{t(`settings.nav.${section.key}`)}
	</h1>
	<div class="mt-3 [&>section]:mt-0" data-testid="settings-section" data-section={id}>
		{#if id === 'einrichtung'}
			<SetupChecklist place="settings" />
		{:else if part}
			{#key part}<MatchingSettings section={part} />{/key}
		{:else if id === 'reisende'}
			<TravellersCard />
		{:else if id === 'schluessel'}
			<KeysCard />
		{:else if id === 'speicher'}
			<StorageCard />
		{/if}
	</div>
{/if}
