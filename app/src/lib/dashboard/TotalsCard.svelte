<script>
	// Income and expenses of the year shown (issue #194): four sums, bank and
	// crypto apart, their total and the balance; private payments and loans on
	// lines of their own; how many crypto bookings have no rate. Every figure
	// links to Zahlungen, filtered to the bookings it sums (totals.js).
	import { resolve } from '$app/paths';
	import { formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { yearTotals } from './totals.js';

	/**
	 * @type {{
	 *   transactions: Record<string, any>[],
	 *   classifications: Record<string, any>,
	 *   year: string
	 * }}
	 */
	let { transactions, classifications, year } = $props();

	let totals = $derived(yearTotals(transactions, classifications));
	/** @param {number} cents */
	const money = (cents) => formatMoney(cents, 'EUR');
	/** @param {string} key */
	const href = (key) => `${resolve('/zahlungen')}?fluss=${key}`;
	const rows = /** @type {const} */ (['bank', 'crypto']);
	const cell =
		'px-1 py-1.5 text-right font-mono text-xs whitespace-nowrap tabular-nums sm:px-2 sm:text-sm';
	const link =
		'text-heading underline decoration-border underline-offset-2 hover:decoration-current';
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-4 py-4 shadow-sm sm:px-5"
	aria-labelledby="totals-h"
	data-testid="home-totals"
>
	<h2 id="totals-h" class="text-base font-semibold text-heading">
		{t('home.totals.title', { year })}
	</h2>
	<p class="mt-1 text-xs text-faint">{t('home.totals.what')}</p>

	<div class="mt-3 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-xs text-faint">
					<th scope="col" class="px-1 py-1 text-left font-medium sm:px-2"></th>
					<th scope="col" class="px-1 py-1 text-right font-medium sm:px-2"
						>{t('home.totals.income')}</th
					>
					<th scope="col" class="px-1 py-1 text-right font-medium sm:px-2"
						>{t('home.totals.expenses')}</th
					>
				</tr>
			</thead>
			<tbody class="divide-y divide-border">
				{#each rows as place (place)}
					<tr>
						<th scope="row" class="px-1 py-1.5 text-left font-medium text-text sm:px-2"
							>{t(`home.totals.${place}`)}</th
						>
						<td class={cell}
							><a class={link} href={href(`${place}-income`)} data-testid="totals-{place}-income"
								>{money(totals[place].income)}</a
							></td
						>
						<td class={cell}
							><a
								class={link}
								href={href(`${place}-expenses`)}
								data-testid="totals-{place}-expenses">{money(totals[place].expenses)}</a
							></td
						>
					</tr>
				{/each}
				<tr class="font-semibold text-heading">
					<th scope="row" class="px-1 py-1.5 text-left sm:px-2">{t('home.totals.total')}</th>
					<td class={cell} data-testid="totals-income">{money(totals.total.income)}</td>
					<td class={cell} data-testid="totals-expenses">{money(totals.total.expenses)}</td>
				</tr>
			</tbody>
		</table>
	</div>

	<p class="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
		<span class="text-sm font-medium text-text">{t('home.totals.balance')}</span>
		<span
			class="font-mono text-lg font-semibold tabular-nums {totals.balance < 0
				? 'text-danger'
				: 'text-heading'}"
			data-testid="totals-balance">{money(totals.balance)}</span
		>
	</p>

	{#if totals.private.count || totals.loans.count || totals.unpriced}
		<ul class="mt-2 space-y-1 text-xs text-text">
			{#if totals.private.count}
				<li data-testid="totals-private">
					<a class={link} href={href('private')}>{t('home.totals.private')}</a>:
					{t('home.totals.privateLine', {
						paid: money(totals.private.paid),
						repaid: money(totals.private.repaid)
					})}
				</li>
			{/if}
			{#if totals.loans.count}
				<li data-testid="totals-loans">
					<a class={link} href={href('loan')}>{t('home.totals.loans')}</a>:
					{t('home.totals.loansLine', {
						received: money(totals.loans.received),
						paid: money(totals.loans.paid)
					})}
				</li>
			{/if}
			{#if totals.unpriced}
				<li data-testid="totals-unpriced">
					{totals.unpriced === 1
						? t('home.totals.unpricedOne')
						: t('home.totals.unpricedMany', { count: totals.unpriced })}
					<a class={link} href={href('unpriced')}>{t('home.totals.show')}</a>
				</li>
			{/if}
		</ul>
	{/if}
</section>
