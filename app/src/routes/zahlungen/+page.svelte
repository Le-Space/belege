<script>
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TransactionDetail from '$lib/TransactionDetail.svelte';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import {
		displayPurpose,
		formatMoney,
		groupByDay,
		matchesSearch,
		monthSummaries
	} from '$lib/bank/format.js';
	import { coverageBadge, isTxCovered } from '$lib/matching/view.js';
	import { cleanMatchingSettings } from '$lib/matching/classify.js';
	import { graceWait, localDay } from '$lib/matching/grace.js';
	import { isBookingConfirmed } from '$lib/booking/suggest.js';

	/** @typedef {{ id: string, bookedOn: string, counterparty?: string, purpose?: string, amountCents?: number, currency?: string, accountId?: string, source?: string, receiptId?: string | null, noReceipt?: any, booking?: any }} Tx */

	let accountId = $state('');
	let query = $state('');
	/** @type {'ohne' | 'alle' | 'konto'} */
	let receiptFilter = $state('ohne');
	/** @type {string | null} */
	let chosenMonth = $state(null);

	let transactions = $derived(/** @type {Tx[]} */ (/** @type {unknown} */ (app.transactions)));
	let accountsById = $derived(new Map(app.accounts.map((a) => [a.id, a])));

	/** Account and search, but not the receipt filter: its buttons count both ways. */
	let searched = $derived(
		transactions.filter(
			(tx) => (!accountId || tx.accountId === accountId) && matchesSearch(tx, query)
		)
	);
	/** @param {Tx} tx */
	const covered = (tx) => isTxCovered(tx, app.classifications);
	let withoutReceipt = $derived(searched.filter((tx) => !covered(tx)));
	// Bookings without a confirmed account ("Konto"): the export waits for them.
	let withoutAccount = $derived(searched.filter((tx) => !isBookingConfirmed(tx)));
	let filtered = $derived(
		receiptFilter === 'ohne'
			? withoutReceipt
			: receiptFilter === 'konto'
				? withoutAccount
				: searched
	);
	// Coverage per month counts all bookings of the search, not only the filtered ones.
	let coverageByMonth = $derived(
		new Map(monthSummaries(searched, covered).map((m) => [m.month, m.coverage]))
	);
	let months = $derived(
		monthSummaries(filtered, covered).map((m) => ({
			...m,
			coverage: coverageByMonth.get(m.month) ?? m.coverage
		}))
	);
	let month = $derived(
		chosenMonth && months.some((m) => m.month === chosenMonth)
			? chosenMonth
			: (months[0]?.month ?? null)
	);
	let days = $derived(
		groupByDay(filtered.filter((tx) => String(tx.bookedOn ?? '').slice(0, 7) === month))
	);

	let graceDays = $derived(cleanMatchingSettings(app.matchingSettings).graceDays);
	const today = localDay();
	/** A booking without a receipt that the matching does not ask about yet. @param {Tx} tx */
	const waitingDays = (tx) => (covered(tx) ? null : graceWait(tx, graceDays, today));

	/** @type {string | null} */
	let openId = $state(null);
	onMount(() => {
		const id = page.url.searchParams.get('tx');
		if (id) openId = id;
	});

	/** @type {Record<string, string>} */
	const coverageClass = {
		receipt: 'border-success/30 bg-success/10 text-success',
		'no-receipt': 'border-border bg-surface-2 text-text',
		'own-transfer': 'border-infra/30 bg-infra/10 text-infra-800 dark:text-infra',
		'bank-fee': 'border-border bg-surface-2 text-text',
		loan: 'border-border bg-surface-2 text-text',
		'rule-ignore': 'border-border bg-surface-2 text-faint',
		'rule-private': 'border-border bg-surface-2 text-faint'
	};

	/** @param {Tx} tx */
	function badge(tx) {
		const account = tx.accountId ? accountsById.get(tx.accountId) : null;
		if (!account) return tx.source === 'camt' ? 'CAMT' : '';
		return `${account.source === 'camt' ? 'CAMT' : 'Hibiscus'} ···${account.ibanLast4}`;
	}

	// Only in development and in the E2E build.
	const showTestButton = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';

	async function addTestTransaction() {
		await currentStore()?.transactions.put({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: 'Testpartner GmbH',
			purpose: 'Testbuchung',
			amountCents: -1999
		});
	}
</script>

<div class="flex flex-wrap items-center justify-between gap-4">
	<h1 class="text-2xl font-bold text-heading">{t('zahlungen.title')}</h1>
	{#if showTestButton}
		<button
			type="button"
			class="rounded-md border border-dashed border-faint px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading"
			onclick={addTestTransaction}
			data-testid="add-test-transaction">{t('zahlungen.addTest')}</button
		>
	{/if}
</div>

{#if transactions.length === 0}
	<p
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 text-text shadow-sm"
		data-testid="transactions-empty"
	>
		{t('zahlungen.emptyBefore')}<a class="underline" href={resolve('/integrationen')}
			>{t('zahlungen.emptyLink')}</a
		>{t('zahlungen.emptyAfter')}
	</p>
{:else}
	<div class="mt-4 flex flex-wrap items-center gap-3">
		<label class="sr-only" for="account-filter">{t('zahlungen.account')}</label>
		<select
			id="account-filter"
			bind:value={accountId}
			class="rounded-md border px-2 py-1.5 text-sm"
			data-testid="account-filter"
		>
			<option value="">{t('zahlungen.allAccounts')}</option>
			{#each app.accounts as account (account.id)}
				<option value={account.id}>{account.name} ···{account.ibanLast4}</option>
			{/each}
		</select>
		<label class="sr-only" for="transaction-search">{t('zahlungen.search')}</label>
		<input
			id="transaction-search"
			type="search"
			bind:value={query}
			placeholder={t('zahlungen.searchPlaceholder')}
			class="min-w-48 flex-1 rounded-md border px-3 py-1.5 text-sm"
			data-testid="transaction-search"
		/>
		<div
			class="flex rounded-md border border-border bg-surface p-0.5 text-sm"
			role="group"
			aria-label={t('zahlungen.receiptFilter')}
		>
			<button
				type="button"
				class="rounded px-3 py-1 {receiptFilter === 'ohne'
					? 'bg-cyan-800 text-white dark:bg-cyan dark:text-bg'
					: 'text-text hover:text-heading'}"
				aria-pressed={receiptFilter === 'ohne'}
				onclick={() => (receiptFilter = 'ohne')}
				data-testid="filter-without-receipt"
				>{t('zahlungen.withoutReceipt', { count: withoutReceipt.length })}</button
			>
			<button
				type="button"
				class="rounded px-3 py-1 {receiptFilter === 'alle'
					? 'bg-cyan-800 text-white dark:bg-cyan dark:text-bg'
					: 'text-text hover:text-heading'}"
				aria-pressed={receiptFilter === 'alle'}
				onclick={() => (receiptFilter = 'alle')}
				data-testid="filter-all">{t('zahlungen.all', { count: searched.length })}</button
			>
			<button
				type="button"
				class="rounded px-3 py-1 {receiptFilter === 'konto'
					? 'bg-cyan-800 text-white dark:bg-cyan dark:text-bg'
					: 'text-text hover:text-heading'}"
				aria-pressed={receiptFilter === 'konto'}
				onclick={() => (receiptFilter = 'konto')}
				data-testid="filter-without-account"
				>{t('zahlungen.withoutAccount', { count: withoutAccount.length })}</button
			>
		</div>
	</div>

	<div class="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
		<nav aria-label={t('zahlungen.months')}>
			<ul class="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
				{#each months as m (m.month)}
					<li class="min-w-44 md:min-w-0">
						<button
							type="button"
							class="w-full rounded-md border px-3 py-2 text-left {m.month === month
								? 'border-cyan-800 bg-surface shadow-sm dark:border-cyan'
								: 'border-transparent hover:bg-surface/60'}"
							aria-current={m.month === month ? 'true' : undefined}
							onclick={() => (chosenMonth = m.month)}
							data-testid="transaction-month"
							data-month={m.month}
						>
							<span class="flex items-baseline justify-between gap-2">
								<span class="font-medium text-heading">{m.label}</span>
								<span class="text-sm text-faint tabular-nums" data-testid="month-count"
									>{m.count}</span
								>
							</span>
							<span
								class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border"
								role="progressbar"
								aria-label={t('zahlungen.coverage', { month: m.label })}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={m.coverage}
							>
								<span class="block h-full bg-identity" style="width: {m.coverage}%"></span>
							</span>
							<span class="mt-0.5 block text-xs text-faint"
								>{t('zahlungen.coverageText', { percent: m.coverage })}</span
							>
						</button>
					</li>
				{:else}
					<li class="px-3 py-2 text-sm text-faint">{t('zahlungen.noMatches')}</li>
				{/each}
			</ul>
		</nav>

		<section aria-label={t('zahlungen.bookings')} class="min-w-0">
			{#each days as day (day.day)}
				<div class="mb-4" data-testid="transaction-day" data-day={day.day}>
					<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">{day.label}</h2>
					<ul
						class="mt-1.5 divide-y divide-border rounded-lg border border-border bg-surface shadow-sm"
					>
						{#each day.items as tx (tx.id)}
							{@const cover = coverageBadge(tx, app.classifications)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
									onclick={() => (openId = tx.id)}
									aria-label={`${t('zahlungen.open')}: ${tx.counterparty || '—'}`}
									data-testid="transaction"
									data-covered={cover ? 'true' : 'false'}
								>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-medium text-heading"
											>{tx.counterparty || '—'}</span
										>
										{#if tx.purpose}<span
												class="block truncate text-sm text-faint"
												title={tx.purpose}
												data-testid="purpose">{displayPurpose(tx.purpose)}</span
											>{/if}
										{#if !isBookingConfirmed(tx)}
											<span
												class="mt-1 mr-1 inline-block rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
												data-testid="no-account-badge">{t('zahlungen.noAccountBadge')}</span
											>
										{/if}
										{#if cover}
											<span
												class="mt-1 inline-block rounded border px-1.5 py-0.5 text-xs font-medium {coverageClass[
													cover
												]}"
												data-testid="coverage-badge"
												data-kind={cover}>{t(`matching.badge.${cover}`)}</span
											>
										{:else if waitingDays(tx) !== null}
											{@const days = waitingDays(tx)}
											<span
												class="mt-1 inline-block rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-faint"
												data-testid="waiting-badge"
												>{days === 1
													? t('matching.waitingOne')
													: t('matching.waiting', { days: days ?? 0 })}</span
											>
										{/if}
									</span>
									{#if badge(tx)}
										<span
											class="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text"
											data-testid="account-badge">{badge(tx)}</span
										>
									{/if}
									<span
										class="shrink-0 font-mono whitespace-nowrap tabular-nums {(tx.amountCents ??
											0) < 0
											? 'text-red-700 dark:text-red-400'
											: (tx.amountCents ?? 0) > 0
												? 'text-emerald-700 dark:text-emerald-400'
												: 'text-heading'}"
										data-testid="amount"
									>
										{formatMoney(tx.amountCents ?? 0, tx.currency)}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="rounded-lg border border-border bg-surface px-5 py-4 text-text shadow-sm">
					{t('zahlungen.noneForSelection')}
				</p>
			{/each}
		</section>
	</div>
{/if}

{#if openId}
	<TransactionDetail txId={openId} onclose={() => (openId = null)} onopen={(id) => (openId = id)} />
{/if}
