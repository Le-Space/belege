<script>
	// Einstellungen (issue #152): what the matching and the export need to know
	// – the company and its own accounts, rules, what was learned, the
	// bookkeeping (DATEV) and the chart of accounts. An overview: each part on
	// a tile that says where it stands and opens the part's own page, as
	// Integrationen does. It was one long page with anchors once; a link to one
	// of those anchors is taken on to the part's page.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { app } from '$lib/session.svelte.js';
	import { consent } from '$lib/consent.js';
	import { t } from '$lib/i18n/index.js';
	import { SETTINGS_SECTIONS, sectionOfAnchor, tileStates } from '$lib/settings/sections.js';

	// Also when the overview is already open and only the anchor changes.
	$effect(() => {
		const old = sectionOfAnchor(page.url.hash);
		if (old) goto(`${resolve(`/einstellungen/${old.id}`)}${old.hash}`, { replaceState: true });
	});

	let states = $derived(
		tileStates({
			accounts: app.accounts,
			partners: app.partners ?? [],
			matchingSettings: app.matchingSettings,
			chart: app.chart
		})
	);
	const tile =
		'flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-sm hover:bg-surface-2';
</script>

<svelte:head><title>{t('settings.title')} · Le Space Belege</title></svelte:head>

<h1 class="text-2xl font-bold text-heading">{t('settings.title')}</h1>
<p class="mt-1 text-sm text-text">{t('settings.intro')}</p>

<ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="settings-overview">
	{#each SETTINGS_SECTIONS as s (s.id)}
		{@const state = states[s.id]}
		<li>
			<a href={resolve(`/einstellungen/${s.id}`)} class={tile} data-testid="settings-tile-{s.id}">
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-heading"
					aria-hidden="true">{s.initials}</span
				>
				<span class="min-w-0 flex-1">
					<span class="block font-semibold text-heading">{t(`settings.nav.${s.key}`)}</span>
					<span
						class="block text-sm {state?.warn
							? 'font-medium text-amber-800 dark:text-amber-300'
							: 'text-text'}"
						data-testid="settings-tile-state"
						data-warn={state?.warn ? 'true' : undefined}
						>{state
							? t(`settings.tile.${state.key}`, state.params ?? {})
							: t(`settings.tile.about.${s.key}`)}</span
					>
				</span>
				<span aria-hidden="true" class="text-lg text-faint">›</span>
			</a>
		</li>
	{/each}
	<li>
		<button
			type="button"
			class={tile}
			onclick={() => consent.reopen()}
			data-testid="settings-tile-privacy"
		>
			<span
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-heading"
				aria-hidden="true">i</span
			>
			<span class="min-w-0 flex-1">
				<span class="block font-semibold text-heading">{t('settings.nav.privacy')}</span>
				<span class="block text-sm text-text">{t('settings.tile.about.privacy')}</span>
			</span>
		</button>
	</li>
</ul>
