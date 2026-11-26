<script>
	// The export page's list of the consumption Eigenbelege of the month
	// (#1034, consumption.js): what will be created, what is reused, what
	// must wait and why. "Verbrauch lesen" asks the bridge for each account's
	// month, as the cards do; nothing is made until the person confirms.
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { accountLabel, formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { planConsumption } from './consumption.js';

	/** @type {{ month: string, onpending?: (count: number) => void }} */
	let { month, onpending = () => {} } = $props();

	/** @type {import('./consumption.js').ConsumptionSource[]} */
	let sources = $state([]);
	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		const { loadConsumptionSources } = await import('./consumption-run.js');
		sources = await loadConsumptionSources(store);
	});

	const today = new Date().toISOString().slice(0, 10);
	let items = $derived(
		planConsumption({
			month,
			today,
			sources,
			accounts: app.accounts,
			transactions: app.transactions,
			receipts: app.receipts,
			matches: app.matches,
			classifications: app.classifications
		})
	);

	/** @param {import('./consumption.js').ConsumptionSource} s */
	const keyOf = (s) => `${s.chain}:${s.address}:${month}`;
	/** @type {Record<string, import('./consumption-run.js').ConsumptionRead | { error: string }>} */
	let reads = $state({});
	let busy = $state(false);
	/** @type {string | null} */
	let done = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	$effect(() => {
		void month;
		done = null;
		error = null;
	});

	let toCreate = $derived(items.filter((i) => i.status === 'create'));
	let unread = $derived(toCreate.filter((i) => !reads[keyOf(i.source)]));
	/** @param {import('./consumption.js').ConsumptionItem} i */
	const readOf = (i) => {
		const r = reads[keyOf(i.source)];
		return r && !('error' in r) ? r : null;
	};
	/** @param {import('./consumption.js').ConsumptionItem} i */
	const errorOf = (i) => {
		const r = reads[keyOf(i.source)];
		return r && 'error' in r ? r.error : '';
	};
	let due = $derived(toCreate.filter((i) => readOf(i)?.due && readOf(i)?.complete));
	let reuse = $derived(items.filter((i) => i.status === 'reuse'));
	let linkable = $derived(reuse.filter((i) => i.toLink.length));
	let waiting = $derived(items.filter((i) => i.status === 'gap'));
	let changed = $derived(items.filter((i) => i.status === 'changed'));
	let open = $derived(items.length > 0 && items.every((i) => i.status === 'open'));

	$effect(() => onpending(unread.length + due.length));

	/** @param {import('./consumption.js').ConsumptionSource} s */
	const label = (s) =>
		`${t(`export.consumption.chain.${s.chain}`)} · ${s.name ? `${s.name} ` : ''}${s.address.length > 16 ? `${s.address.slice(0, 6)}…${s.address.slice(-4)}` : s.address}`;
	/** @param {number} n */
	const covers = (n) =>
		n === 1 ? t('export.consumption.coversOne') : t('export.consumption.covers', { count: n });

	async function client() {
		const { pairedClient } = await import('$lib/bridge-connection/paired-client.js');
		return pairedClient();
	}

	async function read() {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			const c = await client();
			if (!c) {
				error = t('export.consumption.noBridge');
				return;
			}
			const { readConsumption } = await import('./consumption-run.js');
			for (const item of unread) {
				try {
					reads[keyOf(item.source)] = await readConsumption({
						store,
						client: c,
						source: $state.snapshot(item.source),
						month
					});
				} catch (e) {
					reads[keyOf(item.source)] = { error: e instanceof Error ? e.message : String(e) };
				}
			}
		} finally {
			busy = false;
		}
	}

	async function create() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs) return;
		busy = true;
		error = null;
		done = null;
		try {
			const c = await client();
			if (!c && due.length) {
				error = t('export.consumption.noBridge');
				return;
			}
			const { makeConsumption } = await import('./consumption-run.js');
			let created = 0;
			let reused = 0;
			let linked = 0;
			for (const item of [...due, ...linkable]) {
				const r = await makeConsumption({
					store,
					blobs,
					client: c,
					item: $state.snapshot(item),
					month,
					read: item.existing ? null : $state.snapshot(readOf(item)),
					issuer: app.matchingSettings?.companyNames?.[0] ?? '',
					createdBy: app.did ?? ''
				});
				if (r.made === 'created') created++;
				if (r.made === 'reused') reused++;
				linked += r.linked;
			}
			done = t('export.consumption.done', { created, reused, linked });
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
</script>

{#if items.length}
	<section
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		data-testid="export-consumption"
	>
		<h2 class="text-lg font-semibold text-heading">{t('export.consumption.title')}</h2>
		<p class="mt-1 text-sm text-text">{t('export.consumption.intro')}</p>

		{#if open}
			<p class="mt-3 text-sm text-text" data-testid="export-consumption-open">
				{t('export.consumption.open')}
			</p>
		{:else}
			{#if unread.length}
				<p class="mt-3 text-sm text-heading">
					{t('export.consumption.toRead', { count: unread.length })}
				</p>
				<ul class="mt-1 ml-5 flex flex-col gap-0.5 text-sm text-text">
					{#each unread as i (keyOf(i.source))}
						<li data-testid="export-consumption-unread">{label(i.source)}</li>
					{/each}
				</ul>
				<div class="mt-2">
					<button
						type="button"
						class={button}
						onclick={read}
						disabled={busy}
						data-testid="export-consumption-read"
						>{busy ? t('export.consumption.reading') : t('export.consumption.read')}</button
					>
					<p class="mt-1 text-xs text-faint">{t('export.consumption.readHint')}</p>
				</div>
			{/if}

			{#if due.length}
				<p class="mt-3 text-sm font-medium text-heading" data-testid="export-consumption-count">
					{due.length === 1
						? t('export.consumption.willCreateOne')
						: t('export.consumption.willCreate', { count: due.length })}
				</p>
				<ul class="mt-1 ml-5 flex flex-col gap-1 text-sm text-text">
					{#each due as i (keyOf(i.source))}
						{@const r = readOf(i)}
						<li data-testid="export-consumption-item" data-chain={i.source.chain}>
							{label(i.source)}
							<span class="block text-xs text-faint">
								{r?.eurCents == null
									? t('export.consumption.usageUnpriced')
									: t('export.consumption.usage', { amount: formatMoney(r.eurCents, 'EUR') })}
								{#if i.bookings.length}· {covers(i.bookings.length)}{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#each toCreate.filter((i) => readOf(i) && !(readOf(i)?.due && readOf(i)?.complete)) as i (keyOf(i.source))}
				<p class="mt-2 text-sm text-faint" data-testid="export-consumption-none">
					{label(i.source)} – {readOf(i)?.due
						? t('export.consumption.incomplete')
						: t('export.consumption.noUsage')}
				</p>
			{/each}
			{#each toCreate.filter((i) => {
				const r = reads[keyOf(i.source)];
				return r && 'error' in r;
			}) as i (keyOf(i.source))}
				<p class="mt-2 text-sm text-warning" data-testid="export-consumption-failed">
					{label(i.source)} – {t('export.consumption.failed', {
						error: errorOf(i)
					})}
				</p>
			{/each}

			{#if waiting.length}
				<p class="mt-3 text-sm text-heading">{t('export.consumption.notAuto')}</p>
				<ul class="mt-1 ml-5 flex flex-col gap-0.5 text-sm text-text">
					{#each waiting as i (keyOf(i.source))}
						<li class="text-warning" data-testid="export-consumption-gap">
							⚠ {label(i.source)} – {t('export.consumption.gap', {
								accounts: i.gaps.map((a) => accountLabel(a)).join(', ')
							})}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if reuse.length || changed.length}
			<p class="mt-3 text-sm text-heading">{t('export.consumption.reused')}</p>
			<ul class="mt-1 ml-5 flex flex-col gap-0.5 text-sm text-text">
				{#each reuse as i (keyOf(i.source))}
					<li class="text-success" data-testid="export-consumption-reused">
						✓ {i.existing?.selfNumber} · {label(i.source)}
						{#if i.toLink.length}
							<span class="text-faint"
								>· {t('export.consumption.toLink', { count: i.toLink.length })}</span
							>
						{/if}
					</li>
				{/each}
				{#each changed as i (keyOf(i.source))}
					<li class="text-warning" data-testid="export-consumption-changed">
						⚠ {label(i.source)} – {t('export.consumption.changed', {
							number: i.existing?.selfNumber ?? ''
						})}
					</li>
				{/each}
			</ul>
		{/if}

		<p class="mt-3 text-xs text-faint">
			{t('export.consumption.statementCovers')} ·
			<a class="underline" href={resolve('/integrationen/[id]', { id: 'wallets' })}
				>{t('export.consumption.cardsLink')}</a
			>
		</p>

		{#if due.length || linkable.length}
			<div class="mt-3">
				<button
					type="button"
					class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
					onclick={create}
					disabled={busy}
					data-testid="export-consumption-create"
					>{busy
						? t('export.consumption.creating')
						: due.length === 1
							? t('export.consumption.createOne')
							: due.length
								? t('export.consumption.create', { count: due.length })
								: t('export.consumption.link')}</button
				>
			</div>
		{/if}
		{#if done}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="export-consumption-done">
				{done}
			</p>
		{/if}
		{#if error}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="export-consumption-error">
				{error}
			</p>
		{/if}
	</section>
{/if}
