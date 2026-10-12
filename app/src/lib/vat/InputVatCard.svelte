<script>
	// The VAT of the year shown (issue #195): per month or quarter (the
	// setting under Buchhaltung) the input VAT at 19 % and 7 % (input-vat.js),
	// the output VAT of our own invoices – Ist or Soll, the setting – and the
	// VAT payable, the year's sums, and what is not in them: foreign VAT, §13b,
	// receipts without a VAT line, invoices whose VAT the app did not send or
	// that are not paid yet (output-vat.js). A small business (§19 UStG) sees a
	// note and its turnover against the limits instead of the table.
	import { formatMoney, formatMonth } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { inputVat } from './input-vat.js';
	import { outputVat, smallBusinessLimits } from './output-vat.js';
	import { ownInvoiceTest } from './own-invoice.js';
	import { vatKinds } from './vat-kind.js';
	import { resolve } from '$app/paths';

	/**
	 * @type {{
	 *   receipts: Record<string, any>[],
	 *   matches: Record<string, any>[],
	 *   transactions: Record<string, any>[],
	 *   basis: 'ist' | 'soll',
	 *   companyNames?: string[],
	 *   ownVatId?: string,
	 *   year: number,
	 *   yearName: string,
	 *   startMonth: number,
	 *   period: 'month' | 'quarter',
	 *   smallBusiness: boolean
	 * }}
	 */
	let {
		receipts,
		matches,
		transactions,
		basis,
		companyNames = [],
		ownVatId = '',
		year,
		yearName,
		startMonth,
		period,
		smallBusiness
	} = $props();

	/** Our own invoices among the receipts (#354): never input VAT, their VAT is output VAT. */
	let isOwn = $derived(ownInvoiceTest({ companyNames, ownVatId }));
	let vat = $derived(inputVat({ receipts, matches, year, startMonth, period, isOwn }));
	let out = $derived(
		outputVat({ receipts, matches, transactions, year, startMonth, period, basis, isOwn })
	);
	/** The international and special cases of the year (#354): what is not in the table. */
	let kinds = $derived(vatKinds({ receipts, isOwn, year, startMonth, period }));
	let special = $derived(
		['intraEu', 'thirdCountry', 'reverseChargeDe', 'exempt'].some((k) => kinds.output[k]) ||
			Boolean(kinds.input.intraEuAcquisition) ||
			kinds.unclear.length > 0
	);
	const receiptHref = (/** @type {string} */ id) =>
		`${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;
	/** Output and payable columns only once there are own invoices. */
	let withOutput = $derived(out.invoices > 0);
	let limits = $derived(smallBusinessLimits(year));
	/** @param {string} key */
	const outOf = (key) => out.periods.find((p) => p.key === key);
	/** @param {number} cents */
	const money = (cents) => formatMoney(cents, 'EUR');
	/** @param {{ key: string }} p */
	const label = (p) =>
		period === 'month' ? formatMonth(p.key) : t('home.vat.quarter', { n: p.key.slice(1) });
	let any = $derived(
		vat.year.receipts + vat.foreign.receipts + vat.reverse.receipts + vat.noLines.receipts > 0 ||
			out.invoices > 0
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
			{#if out.invoices}
				<p
					class="mt-2 text-sm {out.turnover > limits.currentYear * 100
						? 'text-warning'
						: 'text-text'}"
					data-testid="vat-turnover"
				>
					{t(
						out.turnover > limits.currentYear * 100 ? 'home.vat.turnoverOver' : 'home.vat.turnover',
						{
							year: yearName,
							amount: money(out.turnover),
							limit: money(limits.currentYear * 100),
							previous: money(limits.previousYear * 100)
						}
					)}
				</p>
			{/if}
		{:else}
			<p class="mt-1 text-xs text-faint">
				{t('home.vat.what', {
					basis: t(basis === 'soll' ? 'home.vat.basisSoll' : 'home.vat.basisIst')
				})}
			</p>
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
							{#if withOutput}
								<th scope="col" class={head}>{t('home.vat.output')}</th>
								<th scope="col" class={head}>{t('home.vat.due')}</th>
							{/if}
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
								{#if withOutput}
									<td class={cell} data-testid="vat-period-output"
										>{money(outOf(p.key)?.total ?? 0)}</td
									>
									<td class={cell} data-testid="vat-period-due"
										>{money((outOf(p.key)?.total ?? 0) - p.total)}</td
									>
								{/if}
							</tr>
						{/each}
						<tr class="font-semibold text-heading">
							<th scope="row" class="px-1 py-1.5 text-left sm:px-2">{t('home.vat.year')}</th>
							<td class={cell}>{money(vat.year.r19)}</td>
							<td class={cell}>{money(vat.year.r7)}</td>
							<td class={cell} data-testid="vat-year-total">{money(vat.year.total)}</td>
							{#if withOutput}
								<td class={cell} data-testid="vat-year-output">{money(out.year.total)}</td>
								<td class={cell} data-testid="vat-year-due"
									>{money(out.year.total - vat.year.total)}</td
								>
							{/if}
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
				{#if out.open.invoices}
					<li data-testid="vat-output-open">
						{t('home.vat.outputOpen', { amount: money(out.open.cents), count: out.open.invoices })}
					</li>
				{/if}
				{#if out.missing.invoices}
					<li data-testid="vat-output-missing">
						{t('home.vat.outputMissing', {
							amount: money(out.missing.cents),
							count: out.missing.invoices
						})}
					</li>
				{/if}
				{#if out.none.invoices}
					<li>
						{t('home.vat.outputNone', { amount: money(out.none.cents), count: out.none.invoices })}
					</li>
				{/if}
				{#if !withOutput}
					<li class="text-faint">{t('home.vat.outputLater')}</li>
				{/if}
			</ul>
			{#if special}
				<!-- International and special cases (#354): not in the table, each with its receipts. -->
				<div class="mt-4 border-t border-border pt-3" data-testid="vat-special">
					<h3 class="text-sm font-medium text-heading">{t('home.vat.special.title')}</h3>
					<ul class="mt-2 space-y-1 text-xs text-text">
						{#each ['intraEu', 'thirdCountry', 'reverseChargeDe', 'exempt'] as kind (kind)}
							{#if kinds.output[kind]}
								<li data-testid="vat-kind-{kind}">
									{t(`home.vat.special.${kind}`, {
										amount: money(kinds.output[kind].netCents),
										count: kinds.output[kind].receipts.length
									})}
								</li>
							{/if}
						{/each}
						{#if kinds.input.intraEuAcquisition}
							<li data-testid="vat-kind-intraEuAcquisition">
								{t('home.vat.special.intraEuAcquisition', {
									amount: money(kinds.input.intraEuAcquisition.netCents),
									count: kinds.input.intraEuAcquisition.receipts.length
								})}
							</li>
						{/if}
					</ul>
					{#if kinds.zm.length}
						<p class="mt-3 text-xs font-medium text-heading">{t('home.vat.special.zm')}</p>
						<table class="mt-1 w-full text-xs" data-testid="vat-zm">
							<thead>
								<tr class="text-faint">
									<th scope="col" class="py-0.5 text-left font-medium">{t('home.vat.period')}</th>
									<th scope="col" class="py-0.5 text-left font-medium"
										>{t('home.vat.special.vatId')}</th
									>
									<th scope="col" class="py-0.5 text-right font-medium"
										>{t('home.vat.special.net')}</th
									>
								</tr>
							</thead>
							<tbody>
								{#each kinds.zm as z (`${z.period}|${z.vatId}`)}
									<tr data-testid="vat-zm-line">
										<td class="py-0.5">{label({ key: z.period })}</td>
										<td class="py-0.5 font-mono">{z.vatId}</td>
										<td class="py-0.5 text-right font-mono tabular-nums">{money(z.netCents)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
					{#if kinds.unclear.length}
						<p class="mt-3 text-xs text-warning" data-testid="vat-unclear">
							{t('home.vat.special.unclear', { count: kinds.unclear.length })}
						</p>
						<ul class="mt-1 space-y-0.5 text-xs">
							{#each kinds.unclear.slice(0, 8) as u (u.id)}
								<li>
									<a class="underline" href={receiptHref(u.id)} data-testid="vat-unclear-link"
										>{t(`home.vat.special.reasons.${u.reason ?? 'noCategory'}`)}</a
									>
								</li>
							{/each}
						</ul>
					{/if}
					<p class="mt-2 text-xs text-faint">{t('home.vat.special.note')}</p>
				</div>
			{/if}
		{/if}
	</section>
{/if}
