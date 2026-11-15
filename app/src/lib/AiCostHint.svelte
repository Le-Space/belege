<script module>
	// Shared by every hint: DeepSeek's table as kept in the settings (Statistik),
	// read once when a hint is first opened.
	import { DEFAULT_PRICES, cleanPrices } from './stats/usage.js';

	const shared = $state({ deepseek: DEFAULT_PRICES, loaded: false });
	let hintIds = 0;
</script>

<script>
	// A tiny info icon beside an AI button (✦): on hover, focus or tap it says
	// what one press will roughly take – tokens in and out, and the cost at the
	// bridge's provider (stats/ai-estimate.js). An estimate, said as one; it
	// never feeds billing (#566).
	import { app, currentStore, refreshLlmRedaction } from './session.svelte.js';
	import { getSetting } from './store/settings.js';
	import { estimateCall } from './stats/ai-estimate.js';
	import { hosted, booksBridgeHosted, loadAleph } from './integrations/hosted-status.svelte.js';
	import { intlLocale, t } from './i18n/index.js';

	/**
	 * @type {{ kind: string, per?: 'receipt' | 'booking' | null, testid?: string }}
	 */
	let { kind, per = null, testid = 'ai-cost' } = $props();

	const id = `ai-cost-${++hintIds}`;
	let open = $state(false);
	/** Opened by a tap or click: stays until closed, not only while hovered. */
	let pinned = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	// A hosted bridge on Aleph paid from the books' Le Space plan.
	let included = $derived.by(() => {
		const vm = hosted.aleph.vm;
		return booksBridgeHosted() === 'aleph' && vm?.paidBy === 'lespace' && !vm?.stoppedAt;
	});

	let estimate = $derived(
		open
			? estimateCall({
					kind,
					events: app.events,
					llm: app.llmModel,
					included,
					deepseek: shared.deepseek
				})
			: null
	);

	const tokens = (/** @type {number} */ n) => n.toLocaleString(intlLocale());
	/** @param {number} cost @param {string} currency */
	const money = (cost, currency) =>
		new Intl.NumberFormat(intlLocale(), {
			style: 'currency',
			currency,
			maximumSignificantDigits: 2
		}).format(cost);

	let loading = false;
	async function load() {
		if (loading) return;
		loading = true;
		try {
			const store = currentStore();
			const work = [loadAleph().catch(() => {})];
			if (!shared.loaded && store) {
				work.push(
					getSetting(store.settings, 'aiPrices')
						.then((v) => {
							shared.deepseek = cleanPrices(v);
							shared.loaded = true;
						})
						.catch(() => {})
				);
			}
			if (!app.llmModel) work.push(refreshLlmRedaction());
			await Promise.all(work);
		} finally {
			loading = false;
		}
	}

	function show() {
		open = true;
		load();
	}
	function hide() {
		if (!pinned) open = false;
	}
	function close() {
		open = false;
		pinned = false;
	}

	/** @param {MouseEvent} e */
	function outside(e) {
		if (open && root && !e.composedPath().includes(root)) close();
	}
	/**
	 * Escape closes an open hint, and only the hint: taken before the panel
	 * around it (a payment's detail closes on Escape too) sees it.
	 *
	 * @param {KeyboardEvent} e
	 */
	function escape(e) {
		if (!open || e.key !== 'Escape') return;
		e.stopPropagation();
		close();
	}
</script>

<svelte:window onclick={outside} onkeydowncapture={escape} />

<span
	class="relative inline-flex align-middle"
	bind:this={root}
	onmouseenter={show}
	onmouseleave={hide}
	role="presentation"
>
	<button
		type="button"
		class="inline-flex h-5 w-5 items-center justify-center rounded-full text-faint outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
		aria-label={t('ai.cost.label')}
		aria-describedby={id}
		aria-expanded={open}
		data-testid={testid}
		onfocus={show}
		onblur={hide}
		onclick={(e) => {
			e.stopPropagation();
			if (pinned) close();
			else {
				pinned = true;
				show();
			}
		}}
	>
		<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3" />
			<path d="M8 7v4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			<circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
		</svg>
	</button>
	<span
		{id}
		role="tooltip"
		hidden={!open}
		class="absolute top-full left-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-2.5 text-left text-xs font-normal whitespace-normal text-text shadow-lg"
		data-testid="{testid}-tip"
		data-mode={estimate?.mode ?? ''}
	>
		<span class="block font-semibold text-heading">
			{t(per ? `ai.cost.title.${per}` : 'ai.cost.title.call')}
		</span>
		{#if estimate}
			<span class="mt-1 block" data-testid="{testid}-tokens">
				{t('ai.cost.tokens', {
					prompt: tokens(estimate.prompt),
					completion: tokens(estimate.completion)
				})}
			</span>
			<span class="mt-0.5 block" data-testid="{testid}-cost">
				{#if estimate.mode === 'priced' && estimate.cost !== null}
					{t('ai.cost.priced', {
						cost: money(estimate.cost, estimate.currency),
						model: estimate.model
					})}
				{:else if estimate.mode === 'included'}
					{t('ai.cost.included')}
				{:else if estimate.mode === 'local'}
					{t('ai.cost.local')}
				{:else}
					{t('ai.cost.unknown')}
				{/if}
			</span>
			<span class="mt-1 block text-faint" data-testid="{testid}-basis">
				{estimate.samples === 0
					? t('ai.cost.fallback')
					: estimate.samples === 1
						? t('ai.cost.measuredOne')
						: t('ai.cost.measured', { count: estimate.samples })}
				{t('ai.cost.note')}
			</span>
		{/if}
	</span>
</span>
