<script>
	import { resolve } from '$app/paths';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { intlLocale, list, t } from '$lib/i18n/index.js';
	import {
		app,
		currentStore,
		dropPendingJob,
		resumeJob,
		runMatchingNow
	} from '$lib/session.svelte.js';
	import { loadPending } from '$lib/jobs/pending.js';
	import { extractable } from '$lib/receipts/extract.js';
	import { extractRun } from '$lib/receipts/extract-queue.svelte.js';
	import { aiEligible, aiRun } from '$lib/matching/ai-suggest.svelte.js';
	import { onMount } from 'svelte';
	import { getSetting } from '$lib/store/settings.js';
	import { DEFAULT_PRICES, aiUsage, cleanPrices, periods } from '$lib/stats/usage.js';
	import { isTxCovered, questionProgress, transfersWithReceipt } from '$lib/matching/view.js';
	import { cleanMatchingSettings } from '$lib/matching/classify.js';
	import {
		addOwnIban,
		keepTransferReceipt,
		rejectOwnIban,
		unlinkMatch
	} from '$lib/matching/actions.js';
	import { groupIban, ownIbanSuggestions } from '$lib/matching/own-iban.js';
	import { formatDate, formatMoney, formatTxAmount } from '$lib/bank/format.js';
	import { addressBook, payeeName } from '$lib/bank/payee.js';
	import { receiptVendor } from '$lib/receipts/view.js';
	import { booksByYear, shownYear, startMonth } from '$lib/year/year.svelte.js';
	import { yearLabel } from '$lib/year/year.js';
	import InputVatCard from '$lib/vat/InputVatCard.svelte';
	import { openPrivatePayments } from '$lib/matching/private.js';
	import { cleanDatevSettings, privateAccounts } from '$lib/booking/settings.js';
	import NeedsCard from '$lib/integrations/NeedsCard.svelte';
	import SetupChecklist from '$lib/setup/SetupChecklist.svelte';
	import TotalsCard from '$lib/dashboard/TotalsCard.svelte';
	import { integrationFacts, loadIntegrationFacts } from '$lib/integrations/facts.svelte.js';
	import { integrationsOverview } from '$lib/integrations/overview.js';

	const hour = new Date().getHours();
	const greeting = t(hour < 11 ? 'home.morning' : hour < 18 ? 'home.day' : 'home.evening');

	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';

	// Speicher und KI (stats/usage.js): two numbers here, the rest on /statistik.
	/** @type {number | null} */
	let storageUsed = $state(null);
	/** @type {import('$lib/stats/usage.js').PriceTable} */
	let homePrices = $state(DEFAULT_PRICES);
	onMount(async () => {
		try {
			storageUsed = (await navigator.storage.estimate()).usage ?? null;
		} catch {
			storageUsed = null;
		}
		const store = currentStore();
		if (store) homePrices = cleanPrices(await getSetting(store.settings, 'aiPrices'));
	});

	// Private payments from the business account not paid back yet (#172): a UG/GmbH's
	// claim on its shareholder, open until the repayment is linked.
	let privateOpen = $derived(
		privateAccounts(cleanDatevSettings(app.datevSettings)).settle
			? openPrivatePayments(app.transactions)
			: []
	);

	// What an integration needs from the person (#152), here too: the day starts on Home.
	onMount(() => loadIntegrationFacts());
	let integrationNeeds = $derived(integrationsOverview(integrationFacts()).needs);

	// An AI run the page left behind (a reload, the books locked): ask, do not start.
	/** @type {{ extract: string[], suggest: string[] }} */
	let pending = $state({ extract: [], suggest: [] });
	/** @type {string | null} */
	let resumeNote = $state(null);
	async function readPending() {
		const store = currentStore();
		if (store) pending = await loadPending(store.settings);
	}
	$effect(() => {
		// Again whenever no run goes: one that ended has cleared its ids.
		if (!extractRun.progress && !aiRun.progress) readPending();
	});
	let leftToRead = $derived.by(() => {
		const waiting = new Set(extractable(app.receipts).map((r) => r.id));
		return extractRun.progress ? [] : pending.extract.filter((id) => waiting.has(id));
	});
	let leftToSuggest = $derived.by(() => {
		const open = new Set(aiEligible(app.questions).map((q) => q.id));
		return aiRun.progress ? [] : pending.suggest.filter((id) => open.has(id));
	});
	/**
	 * @param {'extract' | 'suggest'} kind
	 * @param {string[]} ids
	 */
	async function resume(kind, ids) {
		resumeNote = null;
		if (!(await resumeJob(kind, ids))) resumeNote = t('home.resume.noBridge');
	}
	const RESUME_KINDS = /** @type {const} */ (['extract', 'suggest']);
	/** @param {'extract' | 'suggest'} kind */
	async function drop(kind) {
		await dropPendingJob(kind);
		await readPending();
	}

	// The numbers of the year shown (year/year.js).
	let shown = $derived.by(() => {
		const index = booksByYear();
		const year = shownYear();
		return {
			transactions: app.transactions.filter((tx) => index.txYear(tx) === year),
			receipts: app.receipts.filter((r) => index.receiptYears(r).has(year)),
			questions: app.questions.filter((q) => index.questionYears(q).has(year))
		};
	});
	let yearName = $derived(yearLabel(shownYear(), startMonth()));
	let vatSettings = $derived(cleanDatevSettings(app.datevSettings));
	let progress = $derived(questionProgress(shown.questions));
	let covered = $derived(shown.transactions.filter((tx) => isTxCovered(tx, app.classifications)));
	let percent = $derived(
		shown.transactions.length ? Math.round((covered.length / shown.transactions.length) * 100) : 0
	);

	/** @type {string | null} */
	let result = $state(null);

	async function run() {
		result = null;
		const r = await runMatchingNow('manual');
		result = r
			? t('home.matchResult', {
					sure: r.sure,
					questions:
						r.open === 1
							? t('home.matchQuestionsOne')
							: t('home.matchQuestionsMany', { count: r.open }),
					classified: r.classified
				}) + (r.waiting ? t('home.matchWaiting', { count: r.waiting }) : '')
			: t('home.matchFailed');
	}

	/** @param {import('$lib/matching/engine.js').MatchingProgress | null} p */
	function stepText(p) {
		if (!p) return t('home.matchStep.read');
		return t(`home.matchStep.${p.step}`, {
			receipts: p.receipts ?? 0,
			transactions: p.transactions ?? 0
		});
	}

	// "Umbuchung mit Beleg": own transfers that still have a receipt from before
	// (matching/view.js transfersWithReceipt). Shown, never undone by itself.
	let book = $derived(addressBook(app));
	let transferReceipts = $derived.by(() => {
		const index = booksByYear();
		const year = shownYear();
		return transfersWithReceipt({
			transactions: app.transactions,
			receipts: app.receipts,
			matches: app.matches,
			classifications: app.classifications,
			kept: cleanMatchingSettings(app.matchingSettings).keptTransferReceipts
		}).filter((x) => index.txYear(x.tx) === year);
	});
	// "Ist das ein eigenes Konto?" (#256): an IBAN that sends under the company's name.
	let ownIbanOffers = $derived.by(() => {
		const settings = cleanMatchingSettings(app.matchingSettings);
		return ownIbanSuggestions({
			transactions: app.transactions,
			classifications: app.classifications,
			ownIbans: settings.ownIbans,
			notOwnIbans: settings.notOwnIbans
		});
	});
	let checkBusy = $state(false);
	/** @param {() => Promise<unknown>} fn */
	async function check(fn) {
		const store = currentStore();
		if (!store || checkBusy) return;
		checkBusy = true;
		try {
			await fn();
			await runMatchingNow();
		} finally {
			checkBusy = false;
		}
	}
</script>

<h1 class="text-2xl font-bold text-heading">{greeting}!</h1>
<p class="mt-1 text-sm text-faint">{t('home.intro')}</p>

<SetupChecklist />

{#each RESUME_KINDS as kind (kind)}
	{@const ids = kind === 'extract' ? leftToRead : leftToSuggest}
	{#if ids.length}
		<section
			class="mt-4 flex flex-wrap items-center justify-between gap-3 {card}"
			role="status"
			data-testid={`resume-${kind}`}
		>
			<p class="min-w-0 flex-1 text-sm text-heading">
				{t(`home.resume.${kind}`, { count: ids.length })}
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					class="rounded-md bg-cyan-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-900 dark:bg-cyan dark:text-bg"
					onclick={() => resume(kind, ids)}
					data-testid={`resume-${kind}-go`}>{t('home.resume.go')}</button
				>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading"
					onclick={() => drop(kind)}
					data-testid={`resume-${kind}-drop`}>{t('home.resume.drop')}</button
				>
			</div>
		</section>
	{/if}
{/each}
{#if resumeNote}
	<p class="mt-2 text-sm text-danger" role="alert">{resumeNote}</p>
{/if}

{#if privateOpen.length}
	<section class="mt-4 {card}" aria-labelledby="private-open-h" data-testid="home-private-open">
		<h2 id="private-open-h" class="text-sm font-semibold text-heading">
			{t('home.privateOpen.title', {
				count: privateOpen.length,
				amount: formatMoney(
					privateOpen.reduce((n, p) => n + p.openCents, 0),
					'EUR'
				)
			})}
		</h2>
		<p class="mt-1 text-sm text-text">{t('home.privateOpen.what')}</p>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each privateOpen.slice(0, 5) as p (p.tx.id)}
				<li>
					<a
						class="flex min-h-11 items-center justify-between gap-2 py-1 text-heading hover:underline"
						href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(p.tx.id)}`}
						data-testid="home-private-open-item"
						><span class="min-w-0 truncate"
							>{formatDate(p.tx.bookedOn)} · {p.tx.counterparty || '—'}</span
						><span class="font-mono tabular-nums">{formatMoney(p.openCents, 'EUR')}</span></a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if integrationNeeds.length}
	<NeedsCard
		needs={integrationNeeds}
		title={t('home.integrationNeeds')}
		testid="home-integration-needs"
		more
	/>
{/if}

{#if ownIbanOffers.length}
	<section class="mt-4 {card}" aria-labelledby="own-iban-h" data-testid="own-iban-offers">
		<h2 id="own-iban-h" class="text-sm font-semibold text-heading">{t('home.ownIban.title')}</h2>
		<p class="mt-1 text-sm text-text">{t('home.ownIban.what')}</p>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each ownIbanOffers as offer (offer.iban)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-2"
					data-testid="own-iban-offer"
				>
					<span class="min-w-0">
						<span class="font-mono text-heading" data-testid="own-iban-offer-iban"
							>{groupIban(offer.iban)}</span
						>
						<span class="block text-faint"
							>{t('home.ownIban.sends', {
								name: offer.sender,
								count: offer.incoming.length
							})}</span
						>
						<span class="block text-heading" data-testid="own-iban-offer-explains"
							>{offer.outgoing.length === 1
								? t('home.ownIban.explainsOne')
								: offer.outgoing.length
									? t('home.ownIban.explains', { count: offer.outgoing.length })
									: t('home.ownIban.explainsNone')}</span
						>
					</span>
					<span class="flex flex-wrap gap-2">
						{#if offer.outgoing.length}
							<a
								class="rounded-md border border-border px-3 py-1 text-sm text-text no-underline hover:bg-surface-2"
								href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(String(offer.outgoing[0].id))}`}
								data-testid="own-iban-offer-open">{t('home.ownIban.open')}</a
							>
						{/if}
						<button
							type="button"
							class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2"
							disabled={checkBusy}
							onclick={() =>
								check(() => addOwnIban(/** @type {any} */ (currentStore()), offer.iban))}
							data-testid="own-iban-offer-yes">{t('home.ownIban.yes')}</button
						>
						<button
							type="button"
							class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2"
							disabled={checkBusy}
							onclick={() =>
								check(() => rejectOwnIban(/** @type {any} */ (currentStore()), offer.iban))}
							data-testid="own-iban-offer-no">{t('home.ownIban.no')}</button
						>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if transferReceipts.length}
	<section
		class="mt-4 {card}"
		aria-labelledby="transfer-receipts-h"
		data-testid="transfer-receipts"
	>
		<h2 id="transfer-receipts-h" class="text-sm font-semibold text-heading">
			{t('home.transferReceipts.title', { count: transferReceipts.length })}
		</h2>
		<p class="mt-1 text-sm text-text">{t('home.transferReceipts.what')}</p>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each transferReceipts as item (`${item.tx.id}|${item.receipt.id}`)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-2"
					data-testid="transfer-receipt"
				>
					<span class="min-w-0">
						<span class="font-medium text-heading">{payeeName(item.tx, book).name}</span>
						<span class="text-faint">
							· {formatDate(item.tx.bookedOn)} · {formatTxAmount(item.tx)}</span
						>
						<span class="block text-faint"
							>{t('home.transferReceipts.receipt', {
								vendor: receiptVendor(/** @type {any} */ (item.receipt))
							})}</span
						>
					</span>
					<span class="flex flex-wrap gap-2">
						<a
							class="rounded-md border border-border px-3 py-1 text-sm text-text no-underline hover:bg-surface-2"
							href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(item.tx.id)}`}
							data-testid="transfer-receipt-open">{t('home.transferReceipts.open')}</a
						>
						{#if item.matchId}
							<button
								type="button"
								class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2"
								disabled={checkBusy}
								onclick={() =>
									check(() =>
										unlinkMatch(
											/** @type {any} */ (currentStore()),
											/** @type {string} */ (item.matchId)
										)
									)}
								data-testid="transfer-receipt-unlink">{t('home.transferReceipts.unlink')}</button
							>
						{/if}
						<button
							type="button"
							class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2"
							disabled={checkBusy}
							onclick={() =>
								check(() =>
									keepTransferReceipt(
										/** @type {any} */ (currentStore()),
										String(item.tx.id),
										String(item.receipt.id)
									)
								)}
							data-testid="transfer-receipt-keep">{t('home.transferReceipts.keep')}</button
						>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section
	class="mt-6 overflow-hidden rounded-lg border border-cyan-800/40 bg-surface shadow-sm dark:border-cyan/40"
	aria-labelledby="agent-h"
	data-testid="agent-card"
>
	<div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
		<div class="min-w-0">
			<p class="text-xs font-semibold tracking-wide text-cyan-800 uppercase dark:text-cyan">
				{t('home.agentKind')}
			</p>
			<h2 id="agent-h" class="text-lg font-semibold text-heading">{t('home.agentTitle')}</h2>
			<p class="mt-1 text-sm text-text" data-testid="agent-open">
				{progress.open === 0
					? t('home.agentNone')
					: progress.open === 1
						? t('home.agentOpenOne')
						: t('home.agentOpenMany', { count: progress.open })}
			</p>
		</div>
		{#if progress.open > 0}
			<a
				href={resolve('/rueckfragen')}
				class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white no-underline hover:bg-coral-800"
				data-testid="agent-answer">{t('home.agentAnswer')}</a
			>
		{/if}
	</div>
	{#if progress.total > 0}
		<div class="border-t border-border px-5 py-3">
			<p class="text-xs text-faint" data-testid="agent-progress">
				{t('home.agentProgress', { done: progress.done, total: progress.total })}
			</p>
			<span
				class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border"
				role="progressbar"
				aria-label={t('home.agentProgress', { done: progress.done, total: progress.total })}
				aria-valuemin="0"
				aria-valuemax={progress.total}
				aria-valuenow={progress.done}
			>
				<span
					class="block h-full bg-identity"
					style="width: {Math.round((progress.done / progress.total) * 100)}%"
				></span>
			</span>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
		<button
			type="button"
			class="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50"
			onclick={run}
			disabled={app.matching}
			data-testid="match-run">{app.matching ? t('home.matchRunning') : t('home.matchRun')}</button
		>
		{#if app.matching}
			<p class="text-sm text-faint" role="status" data-testid="match-progress">
				{stepText(app.matchingProgress)}
			</p>
		{:else if result}
			<p class="text-sm text-heading" role="status" data-testid="match-result">{result}</p>
		{/if}
		<a
			href={resolve('/verlauf')}
			class="ml-auto text-sm text-text underline hover:text-heading"
			data-testid="home-verlauf">{t('home.verlaufLink')}</a
		>
	</div>
	<p class="border-t border-border px-5 py-2 text-xs text-faint" data-testid="match-how">
		{t('home.matchHow')}
	</p>
</section>

<dl class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.transactions')}</dt>
		<dd
			class="mt-1 text-3xl font-semibold text-heading tabular-nums"
			data-testid="count-transactions"
		>
			{shown.transactions.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.coverage')}</dt>
		<dd
			class="mt-1 text-3xl font-semibold text-heading tabular-nums"
			data-testid="coverage-percent"
		>
			{percent} %
		</dd>
		<dd class="text-xs text-faint">
			{t('home.coverageText', {
				covered: covered.length,
				count: shown.transactions.length,
				percent
			})}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.receipts')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-receipts">
			{shown.receipts.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.partners')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-partners">
			{app.partners.length}
		</dd>
	</div>
</dl>

<a
	href={resolve('/statistik')}
	class="mt-4 flex flex-wrap items-center justify-between gap-2 {card} no-underline hover:border-cyan-800"
	data-testid="home-stats"
>
	<span class="text-sm font-medium text-faint">{t('statistik.home')}</span>
	<span class="text-sm text-heading tabular-nums" data-testid="home-stats-line"
		>{t('statistik.homeLine', {
			storage:
				storageUsed === null
					? '—'
					: `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(storageUsed / 1e6)} MB`,
			cost: new Intl.NumberFormat(intlLocale(), {
				style: 'currency',
				currency: homePrices.currency,
				maximumFractionDigits: 2
			}).format(aiUsage(app.events, periods(new Date()).month, homePrices).cost)
		})}</span
	>
</a>

{#if shown.transactions.length}
	<TotalsCard
		transactions={shown.transactions}
		classifications={app.classifications}
		year={yearName}
	/>
{/if}

<InputVatCard
	receipts={app.receipts}
	matches={app.matches}
	year={shownYear()}
	{yearName}
	startMonth={startMonth()}
	period={vatSettings.vatPeriod}
	smallBusiness={vatSettings.smallBusiness}
/>

{#if app.did}
	<section class="mt-6 {card}" data-testid="home-identity">
		<h2 class="text-sm font-medium text-faint">{t('home.identity')}</h2>
		<p class="mt-2 font-mono text-xs break-all text-heading">{app.did}</p>
		<p class="mt-2 text-xs text-faint">{t('home.identityHint')}</p>
		<TechnicalNote class="mt-3" lines={list('home.technical')} />
	</section>
{/if}
