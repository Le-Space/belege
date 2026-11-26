<script>
	// On a booking that a consumption Eigenbeleg covers (#1034, consumption.js) –
	// an Aleph purchase, a deposit into Filecoin Pay, an Akash wallet's fee –
	// while it has no receipt: the Eigenbeleg is made at the month's close; for
	// whoever wants it now, "create now" makes the same one the export and the
	// card would, and links it.
	import { onMount } from 'svelte';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { consumptionBookings, planConsumption } from './consumption.js';

	/** @type {{ tx: Record<string, any> }} */
	let { tx } = $props();

	/** @type {import('./consumption.js').ConsumptionSource[]} */
	let sources = $state([]);
	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		const { loadConsumptionSources } = await import('./consumption-run.js');
		sources = await loadConsumptionSources(store);
	});

	const today = new Date().toISOString().slice(0, 10);
	let month = $derived(String(tx.bookedOn ?? '').slice(0, 7));
	let source = $derived(
		sources.find(
			(s) =>
				consumptionBookings({
					source: s,
					month,
					transactions: [tx],
					accounts: app.accounts,
					classifications: app.classifications
				}).length
		) ?? null
	);
	let item = $derived(
		source
			? planConsumption({
					month,
					today,
					sources: [source],
					accounts: app.accounts,
					transactions: app.transactions,
					receipts: app.receipts,
					matches: app.matches,
					classifications: app.classifications
				})[0]
			: null
	);

	let busy = $state(false);
	/** @type {string | null} */
	let note = $state(null);

	async function createNow() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !item) return;
		busy = true;
		note = null;
		try {
			const { pairedClient } = await import('$lib/bridge-connection/paired-client.js');
			const client = await pairedClient();
			if (!client) {
				note = t('export.consumption.hint.noBridge');
				return;
			}
			const { makeConsumption } = await import('./consumption-run.js');
			const r = await makeConsumption({
				store,
				blobs,
				client,
				item: $state.snapshot(item),
				month,
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? ''
			});
			note =
				r.made === 'none'
					? t('export.consumption.hint.noUsage')
					: t('export.consumption.hint.made', { number: r.number ?? '' });
			await refreshNow();
		} catch (e) {
			note = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
</script>

{#if item && (item.status === 'create' || item.status === 'open' || item.status === 'gap')}
	<div
		class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
		data-testid="tx-consumption-hint"
		data-status={item.status}
	>
		<p class="font-medium text-heading">{t('export.consumption.hint.needed')}</p>
		<p class="mt-0.5 text-text">
			{t('export.consumption.hint.neededText', {
				chain: t(`export.consumption.chain.${item.source.chain}`)
			})}
		</p>
		{#if item.status === 'open'}
			<p class="mt-0.5 text-faint">{t('export.consumption.hint.open')}</p>
		{:else if item.status === 'gap'}
			<p class="mt-0.5 text-warning">{t('export.consumption.hint.gap')}</p>
		{:else}
			<button
				type="button"
				class="mt-2 {button}"
				onclick={createNow}
				disabled={busy}
				data-testid="tx-consumption-create"
				>{busy
					? t('export.consumption.hint.creating')
					: t('export.consumption.hint.createNow')}</button
			>
		{/if}
		{#if note}
			<p class="mt-1 text-text" role="status" data-testid="tx-consumption-note">{note}</p>
		{/if}
	</div>
{:else if note}
	<p class="mt-2 text-sm text-text" role="status" data-testid="tx-consumption-note">{note}</p>
{/if}
