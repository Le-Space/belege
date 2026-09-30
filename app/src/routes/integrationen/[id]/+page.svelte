<script>
	// One integration on its own page (issue #152), reached from the overview.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import BridgePanel from '$lib/integrations/BridgePanel.svelte';
	import BankPanel from '$lib/integrations/BankPanel.svelte';
	import KiPanel from '$lib/integrations/KiPanel.svelte';
	import KrakenCard from '$lib/exchanges/KrakenCard.svelte';
	import WalletsCard from '$lib/wallets/WalletsCard.svelte';
	import AlephCard from '$lib/aleph/AlephCard.svelte';
	import DevicesCard from '$lib/sync/DevicesCard.svelte';
	import ShareCard from '$lib/share/ShareCard.svelte';
	import InvoiceAppCard from '$lib/ucep/InvoiceAppCard.svelte';
	import PortalsCard from '$lib/portals/PortalsCard.svelte';
	import { bridge, loadBridge } from '$lib/integrations/bridge-state.svelte.js';
	import IntegrationHelp from '$lib/help/IntegrationHelp.svelte';
	import { integrationFacts, loadIntegrationFacts } from '$lib/integrations/facts.svelte.js';
	import { integrationsOverview } from '$lib/integrations/overview.js';

	const KNOWN = [
		'bridge',
		'bank',
		'ki',
		'kraken',
		'wallets',
		'aleph',
		'geraete',
		'portale',
		'rechnungs-app',
		'assistent'
	];
	let id = $derived(page.params.id ?? '');

	onMount(() => {
		if (!bridge.loaded) loadBridge();
		loadIntegrationFacts();
	});
	// The help is unfolded while the integration is not working yet.
	let row = $derived(integrationsOverview(integrationFacts()).rows.find((r) => r.id === id));
	let needsHelp = $derived(!row || row.kind !== 'ok');
</script>

<svelte:head
	><title
		>{KNOWN.includes(id) ? t(`integrationen.overview.name.${id}`) : t('integrationen.title')} · Le Space
		Belege</title
	></svelte:head
>

<nav aria-label={t('integrationen.overview.path')} class="text-sm text-faint">
	<a class="underline" href={resolve('/integrationen')} data-testid="integration-back"
		>← {t('integrationen.overview.back')}</a
	>
</nav>

{#if !KNOWN.includes(id)}
	<h1 class="mt-2 text-2xl font-bold text-heading">{t('integrationen.title')}</h1>
	<p class="mt-2 text-sm text-text">{t('integrationen.overview.unknown')}</p>
{:else}
	<h1 class="mt-2 text-2xl font-bold text-heading" data-testid="integration-title">
		{t(`integrationen.overview.name.${id}`)}
	</h1>
	{#key id}<IntegrationHelp {id} open={needsHelp} />{/key}
	<div class="integration-page" class:hide-card-title={id !== 'bank'}>
		{#if id === 'bridge'}
			<section class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm">
				<BridgePanel />
			</section>
		{:else if id === 'bank'}
			<BankPanel />
		{:else if id === 'ki'}
			<KiPanel />
		{/if}
		{#if id === 'kraken'}
			<KrakenCard url={bridge.url} token={bridge.token} configured={bridge.health.kraken} />
		{:else if id === 'wallets'}
			<WalletsCard url={bridge.url} token={bridge.token} />
		{:else if id === 'aleph'}
			<AlephCard url={bridge.url} token={bridge.token} />
		{:else if id === 'geraete'}
			<DevicesCard />
		{:else if id === 'assistent'}
			<ShareCard url={bridge.url} token={bridge.token} />
		{:else if id === 'rechnungs-app'}
			<InvoiceAppCard />
		{:else if id === 'portale'}
			<PortalsCard url={bridge.url} token={bridge.token} />
		{/if}
	</div>
{/if}
