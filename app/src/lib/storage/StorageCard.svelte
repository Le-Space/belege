<script>
	// "Speicher & Zurücksetzen" under Einstellungen (issue #212): what each
	// database and the receipt files take, what the browser reports, where it
	// all is – and the factory reset of this browser.
	import { onMount } from 'svelte';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { COLLECTIONS } from '$lib/store/repository.js';
	import { booksStats } from '$lib/stats/usage.js';
	import { bridge } from '$lib/integrations/bridge-state.svelte.js';
	import { integrationFacts } from '$lib/integrations/facts.svelte.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import ResetDialog from './ResetDialog.svelte';
	import { storageSummary } from './summary.js';

	/** @type {ReturnType<typeof storageSummary> | null} */
	let summary = $state(null);
	/** @type {boolean | null} */
	let persisted = $state(null);
	/** @type {{ databases: string[], caches: string[], local: string[] }} */
	let stores = $state({ databases: [], caches: [], local: [] });
	let resetOpen = $state(false);

	async function measure() {
		const store = currentStore();
		if (!store) return;
		/** @type {Record<string, { entries: number, bytes: number }>} */
		const logs = {};
		/** @type {Record<string, number>} */
		const records = {};
		/** @type {Record<string, any>[]} */
		let receipts = [];
		for (const name of COLLECTIONS) {
			logs[name] = await store[name].stats();
			const all = await store[name].list({ includeDeleted: true });
			records[name] = all.length;
			if (name === 'receipts') receipts = all;
		}
		let estimate = null;
		try {
			const e = await navigator.storage.estimate();
			estimate = { usage: e.usage ?? 0, quota: e.quota ?? 0 };
			persisted = await navigator.storage.persisted();
		} catch {
			// The browser gives no estimate.
		}
		const files = booksStats({
			transactions: [],
			receipts,
			matches: [],
			questions: [],
			events: []
		});
		summary = storageSummary({ logs, records, files, estimate });
		stores = {
			databases: await indexedDB
				.databases?.()
				.then((list) => list.map((d) => String(d.name ?? '')).filter(Boolean))
				.catch(() => []),
			caches: await caches.keys().catch(() => []),
			local: Object.keys(localStorage).sort()
		};
	}

	onMount(measure);

	async function persist() {
		persisted = await navigator.storage.persist().catch(() => false);
	}

	/** @param {number} bytes */
	const size = (bytes) =>
		bytes < 1e6
			? `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(bytes / 1e3)} kB`
			: `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: bytes < 1e7 ? 1 : 0 }).format(bytes / 1e6)} MB`;
	/** @param {string[]} names */
	const names = (names) => (names.length ? names.join(', ') : t('storage.technical.none'));

	// What to offer before the reset: only what there is.
	let before = $derived.by(() => {
		const facts = integrationFacts();
		/** @type {('export' | 'bridge' | 'invoiceApp' | 'devices')[]} */
		const out = [];
		if (app.transactions.length) out.push('export');
		if (bridge.token) out.push('bridge');
		if (facts.invoiceApp) out.push('invoiceApp');
		if ((app.sync.state?.devices ?? []).length) out.push('devices');
		return out;
	});

	const cell = 'px-2 py-1.5 text-right font-mono text-xs whitespace-nowrap tabular-nums sm:text-sm';
	const head = 'px-2 py-1 text-right font-medium';
</script>

<section
	class="rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="storage-h"
	data-testid="storage-card"
>
	<h2 id="storage-h" class="text-lg font-semibold">{t('storage.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('storage.intro')}</p>
	<p class="mt-2 text-sm text-text">{t('storage.where')}</p>

	{#if !summary}
		<p class="mt-3 text-sm text-faint" role="status">{t('storage.measuring')}</p>
	{:else}
		<div class="mt-3 overflow-x-auto">
			<table class="w-full text-sm" data-testid="storage-table">
				<thead>
					<tr class="text-xs text-faint">
						<th scope="col" class="px-2 py-1 text-left font-medium">{t('storage.database')}</th>
						<th scope="col" class={head}>{t('storage.records')}</th>
						<th scope="col" class={head}>{t('storage.entries')}</th>
						<th scope="col" class={head}>{t('storage.size')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each summary.databases as d (d.name)}
						<tr data-testid="storage-database" data-name={d.name}>
							<th scope="row" class="px-2 py-1.5 text-left font-medium text-text"
								>{t(`storage.databases.${d.name}`)}</th
							>
							<td class={cell}>{d.records}</td>
							<td class={cell}>{d.entries}</td>
							<td class={cell}>{size(d.bytes)}</td>
						</tr>
					{/each}
					<tr class="font-semibold text-heading">
						<th scope="row" class="px-2 py-1.5 text-left">{t('storage.allDatabases')}</th>
						<td class={cell}></td>
						<td class={cell}></td>
						<td class={cell} data-testid="storage-databases-size">{size(summary.databaseBytes)}</td>
					</tr>
					<tr>
						<th scope="row" class="px-2 py-1.5 text-left font-medium text-text"
							>{t('storage.files', { count: summary.files })}</th
						>
						<td class={cell}></td>
						<td class={cell}></td>
						<td class={cell} data-testid="storage-files-size">{size(summary.fileBytes)}</td>
					</tr>
					{#if summary.otherBytes !== null}
						<tr>
							<th scope="row" class="px-2 py-1.5 text-left font-medium text-text"
								>{t('storage.other')}</th
							>
							<td class={cell}></td>
							<td class={cell}></td>
							<td class={cell}>{size(summary.otherBytes)}</td>
						</tr>
					{/if}
					{#if summary.usage !== null}
						<tr class="font-semibold text-heading">
							<th scope="row" class="px-2 py-1.5 text-left"
								>{t('storage.total')}
								<span class="font-normal text-faint"
									>{t('storage.quota', { quota: size(summary.quota ?? 0) })}</span
								></th
							>
							<td class={cell}></td>
							<td class={cell}></td>
							<td class={cell} data-testid="storage-total">{size(summary.usage)}</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
		<p class="mt-2 text-xs text-faint">{t('storage.entriesHint')}</p>
		{#if persisted !== null}
			<p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-text">
				{persisted ? t('storage.persisted') : t('storage.notPersisted')}
				{#if !persisted}
					<button
						type="button"
						class="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface-2 hover:text-heading"
						onclick={persist}
						data-testid="storage-persist">{t('storage.persist')}</button
					>
				{/if}
			</p>
		{/if}
	{/if}
	<p class="mt-2 text-sm text-text">{t('storage.elsewhere')}</p>
	<TechnicalNote
		class="mt-3"
		testid="storage-technical"
		lines={[
			t('storage.technical.databases', { names: names(stores.databases) }),
			t('storage.technical.caches', { names: names(stores.caches) }),
			t('storage.technical.local', { count: stores.local.length, names: names(stores.local) })
		]}
	/>

	<div class="mt-4 border-t border-border pt-4">
		<button
			type="button"
			class="min-h-11 rounded-md border border-red-400 px-3 text-sm font-medium text-red-800 hover:bg-red-50 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-950"
			onclick={() => (resetOpen = true)}
			data-testid="reset-open">{t('storage.reset.button')}</button
		>
	</div>
</section>

<ResetDialog bind:open={resetOpen} {before} onclose={() => (resetOpen = false)} />
