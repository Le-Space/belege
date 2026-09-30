<script>
	// Input VAT of the year shown (issue #195): per month or quarter (the
	// setting under Buchhaltung) at 19 % and 7 %, the year's sum, and what is
	// not in it – foreign VAT, §13b, receipts without a VAT line (input-vat.js).
	// A small business (§19 UStG) sees a note instead of the table.
	import { formatMoney, formatMonth } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { inputVat } from './input-vat.js';

	/**
	 * @type {{
	 *   receipts: Record<string, any>[],
	 *   matches: Record<string, any>[],
	 *   year: number,
	 *   yearName: string,
	 *   startMonth: number,
	 *   period: 'month' | 'quarter',
	 *   smallBusiness: boolean
	 * }}
	 */
	let { receipts, matches, year, yearName, startMonth, period, smallBusiness } = $props();

	let vat = $derived(inputVat({ receipts, matches, year, startMonth, period }));
	/** @param {number} cents */
	const money = (cents) => formatMoney(cents, 'EUR');
	/** @param {{ key: string }} p */
	const label = (p) =>
		period === 'month' ? formatMonth(p.key) : t('home.vat.quarter', { n: p.key.slice(1) });
	let any = $derived(
		vat.year.receipts + vat.foreign.receipts + vat.reverse.receipts + vat.noLines.receipts > 0
	);
	const cell =
		'px-1 py-1.5 text-right font-mono text-xs whitespace-nowrap tabular-nums sm:px-2 sm:text-sm';
	const head = 'px-1 py-1 text-right font-medium sm:px-2';
</script>

{#if any}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-4 py-4 shadow-sm sm:px-5"
		aria-labelledby="vat-h"
		data-testid="home-vat"
	>
		<h2 id="vat-h" class="text-base font-semibold text-heading">
			{t('home.vat.title', { year: yearName })}
		</h2>
		{#if smallBusiness}
			<p class="mt-2 text-sm text-text" data-testid="vat-small-business">
				{t('home.vat.smallBusiness', { amount: money(vat.year.total + vat.foreign.cents) })}
			</p>
		{:else}
			<p class="mt-1 text-xs text-faint">{t('home.vat.what')}</p>
			<div class="mt-3 overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-xs text-faint">
							<th scope="col" class="px-1 py-1 text-left font-medium sm:px-2"
								>{t('home.vat.period')}</th
							>
							<th scope="col" class={head}>{t('home.vat.rate19')}</th>
							<th scope="col" class={head}>{t('home.vat.rate7')}</th>
							<th scope="col" class={head}>{t('home.vat.sum')}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each vat.periods as p (p.key)}
							<tr
								class={p.receipts ? '' : 'text-faint'}
								data-testid="vat-period"
								data-period={p.key}
							>
								<th scope="row" class="px-1 py-1.5 text-left font-medium sm:px-2">{label(p)}</th>
								<td class={cell}>{money(p.r19)}</td>
								<td class={cell}>{money(p.r7)}</td>
								<td class={cell} data-testid="vat-period-total">{money(p.total)}</td>
							</tr>
						{/each}
						<tr class="font-semibold text-heading">
							<th scope="row" class="px-1 py-1.5 text-left sm:px-2">{t('home.vat.year')}</th>
							<td class={cell}>{money(vat.year.r19)}</td>
							<td class={cell}>{money(vat.year.r7)}</td>
							<td class={cell} data-testid="vat-year-total">{money(vat.year.total)}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<ul class="mt-3 space-y-1 text-xs text-text">
				{#if vat.unlinked.receipts}
					<li data-testid="vat-unlinked">
						{t('home.vat.unlinked', {
							amount: money(vat.unlinked.cents),
							count: vat.unlinked.receipts
						})}
					</li>
				{/if}
				{#if vat.reverse.receipts}
					<li data-testid="vat-reverse">
						{t('home.vat.reverse', {
							amount: money(vat.reverse.cents),
							count: vat.reverse.receipts
						})}
					</li>
				{/if}
				{#if vat.foreign.receipts}
					<li data-testid="vat-foreign">
						{t('home.vat.foreign', {
							amount: money(vat.foreign.cents),
							count: vat.foreign.receipts
						})}
					</li>
				{/if}
				{#if vat.noLines.receipts}
					<li data-testid="vat-no-lines">
						{t('home.vat.noLines', { count: vat.noLines.receipts })}
					</li>
				{/if}
				{#if vat.other.receipts}
					<li>{t('home.vat.other', { count: vat.other.receipts })}</li>
				{/if}
				{#if vat.undated}
					<li>{t('home.vat.undated', { count: vat.undated })}</li>
				{/if}
				<li class="text-faint">{t('home.vat.outputLater')}</li>
			</ul>
		{/if}
	</section>
{/if}
