<script>
	// Integrationen → Eigene Geräte: how many of the receipts' files are on
	// this device, and which receipts still lack theirs (receipts/prefetch.js
	// fetches them in the background from the own devices).
	import { resolve } from '$app/paths';
	import { app } from '$lib/session.svelte.js';
	import { missingReceipts } from '$lib/receipts/prefetch.js';
	import { receiptDay } from '$lib/year/year.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';

	let files = $derived(app.files);
	let here = $derived(Math.max(0, files.total - files.missing.length));
	let lacking = $derived(files.missing.length ? missingReceipts(app.receipts, files) : []);

	/** @param {string} id */
	const receiptHref = (id) => `${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;

	/** @param {Record<string, any>} r */
	function line(r) {
		const day = receiptDay(r);
		return [
			day ? formatDate(day) : '',
			typeof r.amountCents === 'number' ? formatMoney(r.amountCents, r.currency ?? 'EUR') : ''
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<div class="mt-4" data-testid="files-status" data-checked={files.checked ? 'true' : 'false'}>
	<h3 class="text-sm font-semibold text-heading">{t('devices.files.title')}</h3>
	{#if !files.checked}
		<p class="mt-1 text-sm text-faint">{t('devices.files.checking')}</p>
	{:else if files.total === 0}
		<p class="mt-1 text-sm text-faint">{t('devices.files.none')}</p>
	{:else if files.missing.length === 0}
		<p class="mt-1 text-sm text-text" data-testid="files-summary">
			{t('devices.files.allHere', { total: files.total })}
		</p>
	{:else}
		<p
			class="mt-1 text-sm text-text"
			data-testid="files-summary"
			data-here={here}
			data-total={files.total}
		>
			{t('devices.files.summary', { here, total: files.total })}
			{#if files.fetching.length}
				{t('devices.files.fetching', { count: files.fetching.length })}
			{/if}
		</p>
		{#if lacking.length}
			<details class="mt-1 text-sm" data-testid="files-missing">
				<summary class="cursor-pointer text-text underline"
					>{t('devices.files.listToggle', { count: lacking.length })}</summary
				>
				<ul class="mt-1 divide-y divide-border">
					{#each lacking as m (m.receipt.id)}
						<li
							class="flex flex-wrap items-baseline justify-between gap-2 py-1.5"
							data-testid="files-missing-item"
						>
							<span class="min-w-0">
								<a
									class="text-heading underline"
									href={receiptHref(String(m.receipt.id))}
									data-testid="files-missing-link"
									>{m.receipt.vendor || m.receipt.fileName || t('devices.files.unnamed')}</a
								>
								{#if line(m.receipt)}<span class="text-xs text-faint">
										· {line(m.receipt)}</span
									>{/if}
							</span>
							<span
								class="text-xs {m.fetching ? 'text-text' : 'text-warning'}"
								data-testid="files-missing-state"
								data-state={m.fetching ? 'fetching' : m.tooLarge ? 'large' : 'waiting'}
								>{t(
									m.fetching
										? 'devices.files.stateFetching'
										: m.tooLarge
											? 'devices.files.stateLarge'
											: 'devices.files.stateWaiting'
								)}</span
							>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</div>
