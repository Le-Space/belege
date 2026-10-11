<script>
	// An e-invoice (#160) has no picture: its XML is the original. This shows
	// what was read from it – seller, number, dates, lines, VAT, total – as a
	// plain view, marked as a view of the original. Nothing of the XML is
	// rendered as markup.
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';

	/** @type {{ receipt: Record<string, any>, class?: string, testid?: string }} */
	let { receipt, class: cls = '', testid = 'preview-einvoice' } = $props();

	let x = $derived(receipt.extraction ?? {});
	let currency = $derived(String(x.currency ?? 'EUR'));
	const money = (/** @type {unknown} */ n, /** @type {string} */ c) =>
		typeof n === 'number' && Number.isFinite(n) ? formatMoney(Math.round(n * 100), c) : '—';
	const date = (/** @type {unknown} */ d) =>
		typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDate(d) : '—';
</script>

<div
	class="overflow-auto rounded border border-border bg-surface-2 p-3 text-xs text-text {cls}"
	data-testid={testid}
	data-rendered="true"
>
	<p class="font-medium text-heading">
		{t('belege.einvoice.title', { syntax: String(receipt.eInvoice?.syntax ?? '').toUpperCase() })}
	</p>
	{#if receipt.eInvoice && receipt.eInvoice.en16931 === false}
		<p class="mt-1 text-warning" data-testid="einvoice-not-en16931">
			{t('belege.einvoice.notEn16931')}
		</p>
	{/if}
	<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
		<dt class="text-faint">{t('belege.einvoice.seller')}</dt>
		<dd>{x.vendor ?? '—'}{x.vendor_vat_id ? ` · ${x.vendor_vat_id}` : ''}</dd>
		<dt class="text-faint">{t('belege.einvoice.number')}</dt>
		<dd>{x.invoice_number ?? '—'}</dd>
		<dt class="text-faint">{t('belege.einvoice.issued')}</dt>
		<dd>{date(x.invoice_date)}</dd>
		{#if x.due_or_debit_date}
			<dt class="text-faint">{t('belege.einvoice.due')}</dt>
			<dd>{date(x.due_or_debit_date)}</dd>
		{/if}
	</dl>
	{#if Array.isArray(x.line_items) && x.line_items.length}
		<table class="mt-2 w-full">
			<tbody>
				{#each x.line_items as line, i (i)}
					<tr>
						<td class="py-0.5 pr-2">{line.description}</td>
						<td class="py-0.5 text-right tabular-nums">{money(line.amount, currency)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-border pt-2">
		<dt class="text-faint">{t('belege.einvoice.net')}</dt>
		<dd class="text-right tabular-nums">{money(x.net, currency)}</dd>
		{#each Array.isArray(x.vat) ? x.vat : [] as v, i (i)}
			<dt class="text-faint">{t('belege.einvoice.vat', { rate: v.rate })}</dt>
			<dd class="text-right tabular-nums">{money(v.amount, currency)}</dd>
		{/each}
		<dt class="font-medium text-heading">{t('belege.einvoice.gross')}</dt>
		<dd class="text-right font-medium text-heading tabular-nums" data-testid="einvoice-gross">
			{money(x.gross, currency)}
		</dd>
	</dl>
	<p class="mt-2 text-faint">{t('belege.einvoice.note')}</p>
</div>
