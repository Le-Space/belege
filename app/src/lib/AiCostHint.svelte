<script module>
	// Shared by every hint: DeepSeek's table as kept in the settings (Statistik),
	// read once when a hint is first opened.
	import { DEFAULT_PRICES, cleanPrices } from './stats/usage.js';

	const shared = $state({ deepseek: DEFAULT_PRICES, loaded: false });
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
	import InfoHint from './InfoHint.svelte';

	/**
	 * @type {{ kind: string, per?: 'receipt' | 'booking' | null, testid?: string }}
	 */
	let { kind, per = null, testid = 'ai-cost' } = $props();

	/** Set once the hint is first opened: the estimate is worked out from then on. */
	let open = $state(false);

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

	function opened() {
		open = true;
		load();
	}
</script>

<InfoHint
	label={t('ai.cost.label')}
	{testid}
	idPrefix="ai-cost"
	mode={estimate?.mode ?? ''}
	onopen={opened}
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
</InfoHint>
