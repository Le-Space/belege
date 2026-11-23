<script module>
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	// A day's rate does not change once it was read: kept for the session, for
	// every wallet and every visit of the page. Rates are public figures; the
	// key names an asset and a day, nothing of the books.
	/** @type {Map<string, string>} `<asset key>@<day>` → EUR per unit */
	const rateCache = new SvelteMap();
</script>

<script>
	// Integrationen → Eigene Wallets: the wallets' balances as their value in
	// euros, per day over the last two months (#908). One line per chain, or
	// per account where a chain is opened; a checkbox hides a chain or an
	// account, and a colour stays with its line. The figures are worked out in
	// value-chart.js and @le-space/charts; this draws them, asks the bridge
	// for the rates that are missing, and shows every figure in a table too.
	import { untrack } from 'svelte';
	import { clip, lineChart, valueSeries } from '@le-space/charts';
	import ChartColors from '$lib/charts/ChartColors.svelte';
	import ChartScene from '$lib/charts/ChartScene.svelte';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { formatQuantity, toUnits } from '$lib/assets/quantity.js';
	import { app } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { walletChain } from './chains.js';
	import {
		bookRates,
		chartModel,
		chartPeriod,
		loadRates,
		neededRates,
		rateSource,
		walletHoldings
	} from './value-chart.js';

	/** @type {{ wallets: import('./wallet-sync.js').Wallet[], client: Pick<ReturnType<typeof import('$lib/bridge/client.js').createBridgeClient>, 'rate' | 'rateRange'>, busy?: boolean, onsummary?: (summary: Map<string, { color: string, value: string | null }>) => void }} `busy`: a sync is running; rates are asked for after it. `onsummary`: per chain its colour and last value, for the list's groups (#1019) */
	let { wallets, client, busy = false, onsummary } = $props();

	// What is hidden and opened is a convenience of this device, not of the
	// books: in localStorage, and as hashes, so no address is written there.
	const STORAGE_KEY = 'belege.walletChart';
	/** @param {string} text */
	const tag = (text) => {
		let h = 0x811c9dc5;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
		return (h >>> 0).toString(16);
	};
	function remembered() {
		try {
			const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
			return {
				hidden: new Set(Array.isArray(kept.hidden) ? kept.hidden.map(String) : []),
				open: new Set(Array.isArray(kept.open) ? kept.open.map(String) : []),
				total: kept.total === true
			};
		} catch {
			return { hidden: new Set(), open: new Set(), total: false };
		}
	}
	const kept = remembered();
	/** Hashes of the keys whose checkbox is off. */
	const hiddenTags = new SvelteSet(kept.hidden);
	/** Hashes of the chains shown account by account. */
	const openTags = new SvelteSet(kept.open);
	let showTotal = $state(kept.total);
	let showTable = $state(false);
	function remember() {
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ hidden: [...hiddenTags], open: [...openTags], total: showTotal })
			);
		} catch {
			// No storage: the choice holds until the page is left.
		}
	}
	/** @param {Set<string>} set @param {string} key @param {boolean} on */
	function mark(set, key, on) {
		if (on) set.add(tag(key));
		else set.delete(tag(key));
		remember();
	}

	const today = new Date().toISOString().slice(0, 10);
	const { from, to } = chartPeriod(today);

	const holdings = $derived(
		walletHoldings({ wallets, accounts: app.accounts, transactions: app.transactions, from })
	);
	const books = $derived(bookRates(holdings, app.transactions));

	/** @type {{ done: number, count: number } | null} */
	let loading = $state(null);
	let retries = $state(0);
	let run = 0;
	$effect(() => {
		void retries;
		// What arrives does not start the asking again.
		const needs = untrack(() => neededRates({ holdings, books, fetched: rateCache, from, to }));
		void holdings;
		void books;
		if (busy || !needs.length) {
			loading = null;
			return;
		}
		const mine = ++run;
		loading = { done: 0, count: needs.length };
		void loadRates({
			needs,
			getRate: (n) =>
				client.rate(n.symbol, n.day, n.contract ? { contract: n.contract, chain: n.chain } : {}),
			// One call per asset for all its days; an older bridge is asked day by day (loadRates).
			getRange: (span) => client.rateRange(span.symbol, span.from, span.to),
			onRate: (key, day, rate) => {
				rateCache.set(`${key}@${day}`, rate);
			},
			onProgress: (done, count) => {
				if (mine === run) loading = { done, count };
			},
			stopped: () => mine !== run
		}).then(() => {
			if (mine === run) loading = null;
		});
		return () => {
			run++;
		};
	});

	const valued = $derived.by(() => {
		const source = rateSource({ books, fetched: rateCache });
		const series = valueSeries({ holdings, rate: source.rate, from, to });
		return { series, carried: [...source.carried] };
	});
	const symbolOf = $derived(new Map(holdings.map((h) => [h.asset, h.symbol])));
	const allKeys = $derived([
		...valued.series.groups.map((g) => `chain:${g.key}`),
		...valued.series.accounts.map((a) => `account:${a.key}`)
	]);
	const model = $derived(
		chartModel({
			series: valued.series,
			holdings,
			hidden: new Set(allKeys.filter((k) => hiddenTags.has(tag(k)))),
			open: new Set(
				valued.series.groups.map((g) => g.key).filter((chain) => openTags.has(tag(chain)))
			)
		})
	);

	$effect(() => {
		onsummary?.(new Map(model.chains.map((c) => [c.chain, { color: c.color, value: c.value }])));
	});

	/** @param {string} chain */
	const chainName = (chain) => walletChain(chain)?.name ?? chain;
	/** @param {string} walletId */
	function walletName(walletId) {
		const w = wallets.find((x) => x.id === walletId);
		if (!w) return walletId;
		if (w.name) return w.name;
		return w.address.length > 14 ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : w.address;
	}
	/** @param {import('./value-chart.js').ChartLine} line */
	const lineName = (line) =>
		line.kind === 'chain' ? chainName(line.chain) : walletName(line.key.slice('account:'.length));

	/** What is drawn: the visible lines with a colour of their own, the rest as one, the total. */
	const drawn = $derived.by(() => {
		/** @type {{ key: string, label: string, color: import('@le-space/charts').Role, values: (string | null)[] }[]} */
		const out = model.lines
			.filter((l) => l.visible && l.color !== 'other')
			.map((l) => ({ key: l.key, label: lineName(l), color: l.color, values: l.values }));
		if (model.rest)
			out.push({
				key: 'rest',
				label: t('integrationen.wallets.chart.rest'),
				color: 'other',
				values: model.rest
			});
		if (showTotal)
			out.push({
				key: 'total',
				label: t('integrationen.wallets.chart.totalShort'),
				color: 'text',
				values: model.total
			});
		return out;
	});

	// The chart is built for the width it has: its texts keep their size.
	const SCALE = 1.7;
	let boxWidth = $state(0);
	const number = $derived(new Intl.NumberFormat(intlLocale()));
	const dayMonth = $derived(
		new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
	);
	const scene = $derived(
		lineChart({
			title: '',
			buckets: model.buckets,
			legend: false,
			// On a narrow screen the plot keeps the width: the checkboxes name the lines.
			ends: (boxWidth || 720) >= 480,
			width: Math.max(220, Math.round((boxWidth || 720) / SCALE)),
			height: 124,
			format: (v) => number.format(Number(v)),
			bucketLabel: (day) => dayMonth.format(new Date(`${day}T00:00:00Z`)),
			series: drawn.map((l) => ({
				label: clip(l.label, 18),
				color: l.color,
				values: l.values.map((v) => (v === null ? null : Number(v)))
			}))
		})
	);

	// The day the figures under the chart are for: the one pointed at, else the last.
	/** @type {number | null} */
	let picked = $state(null);
	const days = $derived(model.buckets.length);
	const day = $derived(Math.min(picked ?? days - 1, days - 1));
	/** @param {number} i the end of day i, from the left */
	const xOfDay = (i) =>
		scene.plot.left + ((i + 1) / Math.max(1, days)) * (scene.plot.right - scene.plot.left);
	/** @param {number} v */
	const yOf = (v) =>
		scene.plot.bottom -
		((v - scene.plot.lo) / (scene.plot.hi - scene.plot.lo)) * (scene.plot.bottom - scene.plot.top);
	/** @param {PointerEvent} event */
	function point(event) {
		const box = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect();
		if (!box.width || !days) return;
		const x = ((event.clientX - box.left) / box.width) * scene.width;
		const at = ((x - scene.plot.left) / (scene.plot.right - scene.plot.left)) * days;
		picked = Math.min(days - 1, Math.max(0, Math.round(at) - 1));
	}
	/** @param {KeyboardEvent} event */
	function step(event) {
		const move = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
		if (move) picked = Math.min(days - 1, Math.max(0, day + move));
		else if (event.key === 'Home') picked = 0;
		else if (event.key === 'End') picked = days - 1;
		else return;
		event.preventDefault();
	}

	/** @param {string | null} value a decimal in euros */
	const money = (value) =>
		value === null
			? t('integrationen.wallets.chart.noRate')
			: formatMoney(Math.round(Number(value) * 100));
	/** @param {string} symbol @param {string} quantity a decimal */
	function quantityText(symbol, quantity) {
		const decimals = Math.min(8, (quantity.split('.')[1] ?? '').length);
		try {
			return formatQuantity(toUnits(quantity, decimals), decimals, symbol);
		} catch {
			return `${quantity} ${symbol}`;
		}
	}
	/** @param {number} i */
	const holdingsOf = (i) =>
		model.quantities
			.filter((q) => !/^0(\.0+)?$/.test(q.quantities[i]))
			.map((q) => quantityText(q.symbol, q.quantities[i]))
			.join(' · ');
	/** @param {string[]} keys asset keys */
	const symbols = (keys) => [...new Set(keys.map((k) => symbolOf.get(k) ?? k))].join(', ');

	const missing = $derived(
		valued.series.missing.map((m) => ({
			asset: symbolOf.get(m.asset) ?? m.asset,
			days: m.buckets.length
		}))
	);
	const tableLines = $derived(model.lines.filter((l) => l.visible));
	const tableDays = $derived(model.buckets.map((_, i) => i).reverse());
</script>

{#if holdings.length}
	<ChartColors class="mt-4 border-b border-border pb-4">
		<div data-testid="wallet-chart">
			<h3 class="font-medium text-heading">{t('integrationen.wallets.chart.title')}</h3>
			<p class="mt-1 text-sm text-text">
				{t('integrationen.wallets.chart.intro', { from: formatDate(from), to: formatDate(to) })}
			</p>

			<fieldset class="mt-3 text-sm" data-testid="wallet-chart-lines">
				<legend class="sr-only">{t('integrationen.wallets.chart.lines')}</legend>
				<ul class="flex flex-wrap gap-x-6 gap-y-2">
					{#each model.chains as c (c.chain)}
						{@const line = model.lines.find((l) => l.key === `chain:${c.chain}`)}
						<li data-testid="wallet-chart-chain" data-chain={c.chain}>
							<label class="flex min-h-8 cursor-pointer items-center gap-2 text-heading">
								<input
									type="checkbox"
									checked={c.visible}
									onchange={(e) => {
										mark(hiddenTags, `chain:${c.chain}`, !e.currentTarget.checked);
									}}
									data-testid="wallet-chart-chain-toggle"
								/>
								{#if line}
									<span
										class="inline-block h-3 w-3 rounded-sm"
										style="background: var(--chart-{line.color})"
										data-testid="wallet-chart-swatch"
										data-color={line.color}
										aria-hidden="true"
									></span>
								{/if}
								{chainName(c.chain)}
							</label>
							{#if c.accounts.length > 1}
								<ul class="ml-6 flex flex-col">
									{#each c.accounts as a (a.key)}
										{@const own = model.lines.find((l) => l.key === a.key)}
										<li>
											<label
												class="flex min-h-8 cursor-pointer items-center gap-2 {c.visible
													? 'text-text'
													: 'text-faint'}"
											>
												<input
													type="checkbox"
													checked={!hiddenTags.has(tag(a.key))}
													disabled={!c.visible}
													onchange={(e) => {
														mark(hiddenTags, a.key, !e.currentTarget.checked);
													}}
													data-testid="wallet-chart-account-toggle"
												/>
												{#if own}
													<span
														class="inline-block h-3 w-3 rounded-sm"
														style="background: var(--chart-{own.color})"
														data-testid="wallet-chart-swatch"
														data-color={own.color}
														aria-hidden="true"
													></span>
												{/if}
												{walletName(a.wallet)}
											</label>
										</li>
									{/each}
									<li>
										<button
											type="button"
											class="min-h-8 text-sm text-text underline hover:text-heading"
											aria-pressed={c.open}
											onclick={() => {
												mark(openTags, c.chain, !c.open);
											}}
											data-testid="wallet-chart-open"
											>{c.open
												? t('integrationen.wallets.chart.closeChain')
												: t('integrationen.wallets.chart.openChain')}</button
										>
									</li>
								</ul>
							{/if}
						</li>
					{/each}
					{#if model.lines.length > 1}
						<li>
							<label class="flex min-h-8 cursor-pointer items-center gap-2 text-heading">
								<input
									type="checkbox"
									bind:checked={showTotal}
									onchange={remember}
									data-testid="wallet-chart-total-toggle"
								/>
								<span
									class="inline-block h-3 w-3 rounded-sm"
									style="background: var(--chart-text)"
									aria-hidden="true"
								></span>
								{t('integrationen.wallets.chart.total')}
							</label>
						</li>
					{/if}
				</ul>
				<p class="mt-1 text-xs text-faint">{t('integrationen.wallets.chart.linesHint')}</p>
			</fieldset>

			<div
				class="mt-2 cursor-crosshair touch-pan-y rounded-md focus-visible:outline-2 focus-visible:outline-cyan-500"
				bind:clientWidth={boxWidth}
				role="slider"
				tabindex="0"
				aria-label={t('integrationen.wallets.chart.daySlider')}
				aria-valuemin="0"
				aria-valuemax={Math.max(0, days - 1)}
				aria-valuenow={day}
				aria-valuetext={formatDate(model.buckets[day] ?? to)}
				onpointermove={point}
				onpointerdown={point}
				onpointerleave={() => (picked = null)}
				onkeydown={step}
				data-testid="wallet-chart-plot"
			>
				<ChartScene
					{scene}
					label={t('integrationen.wallets.chart.aria', {
						from: formatDate(from),
						to: formatDate(to)
					})}
					testid="wallet-chart-svg"
				>
					{#if days}
						<line
							x1={xOfDay(day)}
							x2={xOfDay(day)}
							y1={scene.plot.top}
							y2={scene.plot.bottom}
							stroke="var(--chart-axis)"
							stroke-width="0.5"
							stroke-dasharray="2 2"
						/>
						{#each drawn as l (l.key)}
							{@const v = l.values[day]}
							{#if v !== null && v !== undefined}
								<circle
									cx={xOfDay(day)}
									cy={yOf(Number(v))}
									r="2.2"
									fill="var(--chart-{l.color})"
									stroke="var(--chart-surface)"
									stroke-width="0.8"
								/>
							{/if}
						{/each}
					{/if}
				</ChartScene>
			</div>

			<!-- The day pointed at, each visible line's value: what a tooltip would say, where it can be read and copied. -->
			<p
				class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text tabular-nums"
				data-testid="wallet-chart-day"
			>
				<span class="font-medium text-heading">{formatDate(model.buckets[day] ?? to)}</span>
				{#each drawn as l (l.key)}
					<span class="inline-flex items-center gap-1.5" data-testid="wallet-chart-day-value">
						<span
							class="inline-block h-2.5 w-2.5 rounded-sm"
							style="background: var(--chart-{l.color})"
							aria-hidden="true"
						></span>
						{l.label}: {money(l.values[day] ?? null)}
					</span>
				{/each}
				{#if model.missing[day]?.length}
					<span class="text-warning"
						>{t('integrationen.wallets.chart.missingDay', {
							assets: symbols(model.missing[day])
						})}</span
					>
				{/if}
			</p>

			{#if loading}
				<p class="mt-2 text-xs text-faint" role="status" data-testid="wallet-chart-loading">
					{t('integrationen.wallets.chart.loading', loading)}
				</p>
			{:else if missing.length}
				<p class="mt-2 text-sm text-warning" role="status" data-testid="wallet-chart-missing">
					{t('integrationen.wallets.chart.missing', {
						list: missing.map((m) => t('integrationen.wallets.chart.missingItem', m)).join(', ')
					})}
					<button
						type="button"
						class="ml-1 text-text underline hover:text-heading"
						onclick={() => retries++}
						data-testid="wallet-chart-retry">{t('integrationen.wallets.chart.retry')}</button
					>
				</p>
			{/if}
			{#if valued.carried.length}
				<p class="mt-2 text-xs text-faint" data-testid="wallet-chart-carried">
					{t('integrationen.wallets.chart.carried', { assets: symbols(valued.carried) })}
				</p>
			{/if}

			<button
				type="button"
				class="mt-2 min-h-8 text-sm text-text underline hover:text-heading"
				aria-expanded={showTable}
				onclick={() => (showTable = !showTable)}
				data-testid="wallet-chart-table-toggle"
				>{showTable
					? t('integrationen.wallets.chart.table.hide')
					: t('integrationen.wallets.chart.table.show')}</button
			>
			{#if showTable}
				<div class="mt-2 max-h-96 overflow-auto rounded-md border border-border">
					<table class="w-full text-left text-sm tabular-nums" data-testid="wallet-chart-table">
						<caption class="sr-only">{t('integrationen.wallets.chart.table.caption')}</caption>
						<thead class="sticky top-0 bg-surface-2 text-heading">
							<tr>
								<th scope="col" class="px-3 py-1.5 font-medium"
									>{t('integrationen.wallets.chart.day')}</th
								>
								{#each tableLines as l (l.key)}
									<th scope="col" class="px-3 py-1.5 text-right font-medium">{lineName(l)}</th>
								{/each}
								{#if model.rest}
									<th scope="col" class="px-3 py-1.5 text-right font-medium"
										>{t('integrationen.wallets.chart.rest')}</th
									>
								{/if}
								<th scope="col" class="px-3 py-1.5 text-right font-medium"
									>{t('integrationen.wallets.chart.total')}</th
								>
								<th scope="col" class="px-3 py-1.5 font-medium"
									>{t('integrationen.wallets.chart.table.holdings')}</th
								>
								<th scope="col" class="px-3 py-1.5 font-medium"
									>{t('integrationen.wallets.chart.table.notes')}</th
								>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each tableDays as i (i)}
								<tr data-testid="wallet-chart-row" data-day={model.buckets[i]}>
									<th scope="row" class="px-3 py-1 font-normal whitespace-nowrap text-heading"
										>{formatDate(model.buckets[i])}</th
									>
									{#each tableLines as l (l.key)}
										<td class="px-3 py-1 text-right whitespace-nowrap">{money(l.values[i])}</td>
									{/each}
									{#if model.rest}
										<td class="px-3 py-1 text-right whitespace-nowrap">{money(model.rest[i])}</td>
									{/if}
									<td class="px-3 py-1 text-right whitespace-nowrap text-heading"
										>{money(model.total[i])}</td
									>
									<td class="px-3 py-1 text-xs">{holdingsOf(i)}</td>
									<td class="px-3 py-1 text-xs text-warning"
										>{model.missing[i].length
											? t('integrationen.wallets.chart.missingDay', {
													assets: symbols(model.missing[i])
												})
											: ''}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</ChartColors>
{/if}
