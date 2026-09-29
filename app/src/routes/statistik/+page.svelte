<script>
	// Statistik: what the books take in this browser, and what the AI used
	// and cost (stats/usage.js). Nothing here leaves the browser.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { getSetting, setSetting } from '$lib/store/settings.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import {
		DEFAULT_PRICES,
		aiUsage,
		booksStats,
		cleanPrices,
		periods,
		tokensPerReceipt
	} from '$lib/stats/usage.js';
	import { DEFAULT_WORKERS, MAX_WORKERS, MIN_WORKERS } from '$lib/jobs/queue.js';
	import { loadWorkers, saveWorkers } from '$lib/jobs/workers.js';

	/** @type {{ usage: number, quota: number } | null} */
	let storage = $state(null);
	/** @type {boolean | null} */
	let persisted = $state(null);
	/** @type {import('$lib/stats/usage.js').PriceTable} */
	let prices = $state(DEFAULT_PRICES);
	/** @type {Record<string, { input: string, cached: string, output: string }>} */
	let editing = $state({});
	let pricesOpen = $state(false);
	/** @type {string | null} */
	let note = $state(null);
	let workers = $state(DEFAULT_WORKERS);
	const WORKER_CHOICES = Array.from(
		{ length: MAX_WORKERS - MIN_WORKERS + 1 },
		(_, i) => MIN_WORKERS + i
	);

	async function measure() {
		try {
			const e = await navigator.storage.estimate();
			storage = { usage: e.usage ?? 0, quota: e.quota ?? 0 };
			persisted = await navigator.storage.persisted();
		} catch {
			storage = null;
		}
	}

	onMount(async () => {
		await measure();
		const store = currentStore();
		if (store) {
			prices = cleanPrices(await getSetting(store.settings, 'aiPrices'));
			workers = await loadWorkers(store.settings);
		}
	});

	/** How many AI requests a run sends at once; the next run takes it. */
	async function changeWorkers() {
		const store = currentStore();
		if (store) await saveWorkers(store.settings, workers);
	}

	async function persist() {
		persisted = await navigator.storage.persist().catch(() => false);
		note = persisted ? t('statistik.persistYes') : t('statistik.persistNo');
	}

	let books = $derived(
		booksStats({
			transactions: app.transactions,
			receipts: app.receipts,
			matches: app.matches,
			questions: app.questions,
			events: app.events,
			partners: app.partners,
			accounts: app.accounts
		})
	);
	let when = $derived(periods(new Date()));
	let usage = $derived({
		today: aiUsage(app.events, when.today, prices),
		week: aiUsage(app.events, when.week, prices),
		month: aiUsage(app.events, when.month, prices)
	});
	let perReceipt = $derived(tokensPerReceipt(app.events, when.month));
	let estimated = $derived(usage.month.estimated || usage.week.estimated);
	let unpriced = $derived([...new Set([...usage.month.unpriced, ...usage.week.unpriced])]);

	/** @param {number} bytes */
	const mb = (bytes) =>
		`${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: bytes < 1e7 ? 1 : 0 }).format(bytes / 1e6)} MB`;
	/** @param {number} n */
	const int = (n) => new Intl.NumberFormat(intlLocale()).format(n);
	/** @param {number} cost */
	const money = (cost) =>
		new Intl.NumberFormat(intlLocale(), {
			style: 'currency',
			currency: prices.currency,
			maximumFractionDigits: cost < 1 ? 4 : 2
		}).format(cost);

	function openPrices() {
		editing = Object.fromEntries(
			Object.entries(prices.models).map(([m, p]) => [
				m,
				{ input: String(p.input), cached: String(p.cached), output: String(p.output) }
			])
		);
		pricesOpen = true;
	}

	/** @param {import('$lib/stats/usage.js').PriceTable | null} table */
	async function savePrices(table) {
		const store = currentStore();
		if (!store) return;
		const value = table ?? {
			...prices,
			checkedOn: new Date().toISOString().slice(0, 10),
			models: Object.fromEntries(
				Object.entries(editing).map(([m, p]) => [
					m,
					{
						input: Number(String(p.input).replace(',', '.')),
						cached: Number(String(p.cached).replace(',', '.')),
						output: Number(String(p.output).replace(',', '.'))
					}
				])
			)
		};
		await setSetting(store.settings, 'aiPrices', value);
		prices = cleanPrices(value);
		pricesOpen = false;
		await refreshNow();
	}

	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading';
	const COLLECTIONS = /** @type {const} */ ([
		'transactions',
		'receipts',
		'matches',
		'questions',
		'events',
		'partners',
		'accounts'
	]);
	const KINDS = /** @type {const} */ ([
		'extract',
		'match-assist',
		'transfer-assist',
		'vendor-assist',
		'mail-assist'
	]);
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<h1 class="text-2xl font-bold text-heading">{t('statistik.title')}</h1>
	<a class="text-sm text-text underline" href={resolve('/')}>{t('statistik.back')}</a>
</div>
<p class="mt-1 text-sm text-faint">{t('statistik.intro')}</p>

<section class="mt-4 {card}" data-testid="stats-storage">
	<h2 class="text-sm font-semibold text-heading">{t('statistik.storage')}</h2>
	{#if storage}
		<p
			class="mt-2 text-2xl font-semibold text-heading tabular-nums"
			data-testid="stats-storage-used"
		>
			{mb(storage.usage)}
			<span class="text-sm font-normal text-faint"
				>{t('statistik.ofQuota', { quota: mb(storage.quota) })}</span
			>
		</p>
		<dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
			<dt class="text-faint">{t('statistik.files')}</dt>
			<dd class="text-heading tabular-nums" data-testid="stats-files">
				{mb(books.fileBytes)} · {t('statistik.fileCount', { count: books.files })}
			</dd>
			<dt class="text-faint">{t('statistik.database')}</dt>
			<dd class="text-heading tabular-nums" data-testid="stats-database">
				{mb(Math.max(0, storage.usage - books.fileBytes))}
			</dd>
		</dl>
	{:else}
		<p class="mt-2 text-sm text-faint">{t('statistik.storageUnknown')}</p>
	{/if}
	<p class="mt-3 text-sm text-text" data-testid="stats-persisted">
		{persisted ? t('statistik.persisted') : t('statistik.notPersisted')}
		{#if persisted === false}
			<button type="button" class="ml-2 {button}" onclick={persist} data-testid="stats-persist"
				>{t('statistik.persist')}</button
			>
		{/if}
	</p>
	{#if note}<p class="mt-1 text-xs text-faint">{note}</p>{/if}
	<h3 class="mt-4 text-xs font-semibold tracking-wide text-faint uppercase">
		{t('statistik.records')}
	</h3>
	<ul
		class="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4"
		data-testid="stats-counts"
	>
		{#each COLLECTIONS as c (c)}
			<li class="flex justify-between gap-2">
				<span class="text-faint">{t(`statistik.collection.${c}`)}</span>
				<span class="text-heading tabular-nums">{int(books.counts[c])}</span>
			</li>
		{/each}
	</ul>
</section>

<section class="mt-4 {card}" data-testid="stats-ai">
	<h2 class="text-sm font-semibold text-heading">{t('statistik.ai')}</h2>
	<div class="mt-2 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-xs text-faint">
					<th class="py-1 pr-3 font-medium"></th>
					<th class="py-1 pr-3 text-right font-medium">{t('statistik.today')}</th>
					<th class="py-1 pr-3 text-right font-medium">{t('statistik.week')}</th>
					<th class="py-1 text-right font-medium">{t('statistik.month')}</th>
				</tr>
			</thead>
			<tbody class="tabular-nums">
				<tr class="border-t border-border">
					<th class="py-1.5 pr-3 text-left font-medium text-heading">{t('statistik.cost')}</th>
					<td class="py-1.5 pr-3 text-right" data-testid="stats-cost-today"
						>{money(usage.today.cost)}</td
					>
					<td class="py-1.5 pr-3 text-right" data-testid="stats-cost-week"
						>{money(usage.week.cost)}</td
					>
					<td class="py-1.5 text-right" data-testid="stats-cost-month">{money(usage.month.cost)}</td
					>
				</tr>
				<tr class="border-t border-border">
					<th class="py-1.5 pr-3 text-left font-medium text-heading">{t('statistik.tokens')}</th>
					<td class="py-1.5 pr-3 text-right">{int(usage.today.tokens)}</td>
					<td class="py-1.5 pr-3 text-right" data-testid="stats-tokens-week"
						>{int(usage.week.tokens)}</td
					>
					<td class="py-1.5 text-right">{int(usage.month.tokens)}</td>
				</tr>
				{#each KINDS as k (k)}
					<tr class="border-t border-border text-text">
						<th class="py-1.5 pr-3 pl-3 text-left font-normal">{t(`statistik.kind.${k}`)}</th>
						<td class="py-1.5 pr-3 text-right">{int(usage.today.byKind[k]?.calls ?? 0)}×</td>
						<td class="py-1.5 pr-3 text-right">{int(usage.week.byKind[k]?.calls ?? 0)}×</td>
						<td class="py-1.5 text-right">{int(usage.month.byKind[k]?.calls ?? 0)}×</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="mt-3 text-sm text-text" data-testid="stats-per-receipt">
		{perReceipt === null
			? t('statistik.perReceiptNone')
			: t('statistik.perReceipt', { tokens: int(perReceipt) })}
	</p>
	<p class="mt-2 text-xs text-faint">
		{t('statistik.pricesFrom', {
			date: prices.checkedOn || '—',
			currency: prices.currency
		})}
		{#if estimated}{t('statistik.estimated')}{/if}
		{#if unpriced.length}{t('statistik.unpriced', { models: unpriced.join(', ') })}{/if}
		{t('statistik.holidays')}
	</p>
	<div class="mt-3 text-sm text-text">
		<label class="flex flex-wrap items-center gap-2"
			>{t('statistik.workers')}
			<select
				class="rounded border border-border bg-surface px-2 py-1 text-sm text-heading"
				bind:value={workers}
				onchange={changeWorkers}
				data-testid="stats-workers"
			>
				{#each WORKER_CHOICES as n (n)}
					<option value={n}>{n}</option>
				{/each}
			</select></label
		>
		<p class="mt-1 text-xs text-faint">{t('statistik.workersHint')}</p>
	</div>
	<div class="mt-2 flex flex-wrap gap-3 text-sm">
		<button type="button" class={button} onclick={openPrices} data-testid="stats-prices-open"
			>{t('statistik.editPrices')}</button
		>
		<a class="underline" href={resolve('/verlauf')}>{t('statistik.toVerlauf')}</a>
	</div>
	{#if pricesOpen}
		<form
			class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
			onsubmit={(e) => {
				e.preventDefault();
				savePrices(null);
			}}
			data-testid="stats-prices"
		>
			<p class="text-xs text-faint">{t('statistik.pricesHint', { currency: prices.currency })}</p>
			{#each Object.keys(editing) as m (m)}
				<fieldset class="mt-2 flex flex-wrap items-end gap-2">
					<legend class="font-mono text-xs text-heading">{m}</legend>
					<label class="flex flex-col text-xs text-faint"
						>{t('statistik.priceInput')}<input
							class="w-24 rounded border border-border bg-surface px-2 py-1 text-sm"
							bind:value={editing[m].input}
						/></label
					>
					<label class="flex flex-col text-xs text-faint"
						>{t('statistik.priceCached')}<input
							class="w-24 rounded border border-border bg-surface px-2 py-1 text-sm"
							bind:value={editing[m].cached}
						/></label
					>
					<label class="flex flex-col text-xs text-faint"
						>{t('statistik.priceOutput')}<input
							class="w-24 rounded border border-border bg-surface px-2 py-1 text-sm"
							bind:value={editing[m].output}
						/></label
					>
				</fieldset>
			{/each}
			<div class="mt-3 flex flex-wrap gap-3">
				<button type="submit" class={button} data-testid="stats-prices-save"
					>{t('statistik.savePrices')}</button
				>
				<button type="button" class={button} onclick={() => savePrices(DEFAULT_PRICES)}
					>{t('statistik.resetPrices')}</button
				>
			</div>
		</form>
	{/if}
</section>
