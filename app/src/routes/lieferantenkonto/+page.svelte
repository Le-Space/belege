<script>
	// Lieferantenkonto (issue #121): one vendor's payments and receipts on one
	// timeline with a running balance, for prepaid tariffs and collective
	// billing, where one payment never pairs with one receipt
	// (matching/vendor-account.js). Kept as a prepaid account, its top-ups need
	// no receipt and its statements count as covered.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { app, currentStore, runMatchingNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { cleanMatchingSettings } from '$lib/matching/classify.js';
	import { setPrepaidOpening, setPrepaidVendor } from '$lib/matching/actions.js';
	import { looksPrepaid, vendorTimeline } from '$lib/matching/vendor-account.js';
	import { shownYear } from '$lib/year/year.svelte.js';
	import { onMount } from 'svelte';
	import { getSetting } from '$lib/store/settings.js';
	import { recordEvent } from '$lib/activity/events.js';
	import { eventCalls } from '$lib/stats/usage.js';
	import AiMark from '$lib/AiMark.svelte';

	let name = $derived(page.url.searchParams.get('name') ?? '');
	let year = $derived(String(shownYear()));
	let from = $derived(`${year}-01-01`);
	let until = $derived.by(() => {
		const u = page.url.searchParams.get('until') ?? '';
		return /^\d{4}-\d{2}-\d{2}$/.test(u) && u.startsWith(year) ? u : `${year}-12-31`;
	});
	let wholeYear = $state(false);
	let prepaid = $derived(
		cleanMatchingSettings(app.matchingSettings).prepaidVendors.find((v) => v.name === name) ?? null
	);
	let opening = $derived(prepaid?.openings[year] ?? null);
	let timeline = $derived(
		name
			? vendorTimeline({
					transactions: app.transactions,
					receipts: app.receipts,
					name,
					from,
					until: wholeYear ? `${year}-12-31` : until,
					openingCents: opening
				})
			: null
	);
	let suggest = $derived(
		name && !prepaid
			? looksPrepaid({ transactions: app.transactions, receipts: app.receipts, name })
			: false
	);

	let openingText = $state('');
	let busy = $state(false);
	/** @param {() => Promise<unknown>} fn */
	async function act(fn) {
		if (!currentStore() || busy) return;
		busy = true;
		try {
			await fn();
			await runMatchingNow();
		} finally {
			busy = false;
		}
	}
	const store = () => /** @type {any} */ (currentStore());
	function saveOpening() {
		const raw = openingText.trim().replace(/\./g, '').replace(',', '.');
		const cents = raw === '' ? null : Math.round(Number(raw) * 100);
		if (cents !== null && !Number.isFinite(cents)) return;
		act(() => setPrepaidOpening(store(), name, year, cents));
	}

	/** @param {number} cents */
	const money = (cents) => formatMoney(cents, 'EUR');
	/** @param {import('$lib/matching/vendor-account.js').Finding} f */
	function findingText(f) {
		if (f.kind === 'gap') {
			const [y, m] = String(f.month).split('-');
			return t('vendorAccount.finding.gap', { month: `${m}/${y}` });
		}
		return t(`vendorAccount.finding.${f.kind}`, {
			date: f.date ? formatDate(f.date) : '',
			amount: typeof f.cents === 'number' ? money(f.cents) : ''
		});
	}

	// "✦ Ungereimtheiten erklären" (bridge POST /vendor/assist): notes only.
	/** @type {{ vendorAssist: (body: any) => Promise<any> } | null} */
	let client = $state(null);
	onMount(async () => {
		const store = currentStore();
		const saved = store ? await getSetting(store.settings, 'bridge') : null;
		if (!saved?.token) return;
		const { createBridgeClient } = await import('$lib/bridge/client.js');
		client = createBridgeClient({ url: saved.url, token: saved.token });
	});
	/** @type {string[] | null} */
	let notes = $state(null);
	let explaining = $state(false);
	/** @type {string | null} */
	let explainError = $state(null);
	const shownUntil = () => (wholeYear ? `${year}-12-31` : until);
	/** @param {number} cents */
	const plainMoney = (cents) => formatMoney(cents, 'EUR').replace(/\s*EUR$/, '');

	async function explain() {
		if (!client || !timeline) return;
		explaining = true;
		explainError = null;
		notes = null;
		try {
			const r = await client.vendorAssist({
				vendor: name,
				from,
				until: shownUntil(),
				opening: opening === null ? null : plainMoney(opening),
				closing: plainMoney(timeline.closingCents),
				rows: timeline.rows.slice(0, 120).map((row) => ({
					date: row.date,
					kind: row.kind,
					...(row.topUpCents ? { topUp: plainMoney(row.topUpCents) } : {}),
					...(row.usageCents ? { usage: plainMoney(row.usageCents) } : {}),
					balance: plainMoney(row.balanceCents),
					period: row.period ?? null,
					items: (row.items ?? []).map((i) => ({
						description: i.description,
						amount: plainMoney(i.cents)
					}))
				})),
				findings: timeline.findings.map(findingText)
			});
			notes = r.notes;
			await recordEvent(currentStore()?.events, 'vendor-assist', {
				rows: timeline.rows.length,
				model: r.llm.calls.at(-1)?.model ?? null,
				calls: eventCalls(r.llm.calls),
				ms: r.llm.calls.reduce(
					(/** @type {number} */ n, /** @type {any} */ c) => n + (c.ms ?? 0),
					0
				),
				tokensTotal: r.llm.calls.reduce(
					(/** @type {number} */ n, /** @type {any} */ c) =>
						n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
					0
				)
			});
		} catch (e) {
			explainError = e instanceof Error ? e.message : String(e);
		} finally {
			explaining = false;
		}
	}

	async function downloadPdf() {
		if (!timeline) return;
		const { vendorAccountPdf } = await import('$lib/matching/vendor-account-pdf.js');
		const bytes = await vendorAccountPdf({
			name,
			from,
			until: shownUntil(),
			timeline,
			findings: timeline.findings.map(findingText),
			prepaid: Boolean(prepaid),
			createdAt: new Date().toISOString()
		});
		const url = URL.createObjectURL(
			new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], {
				type: 'application/pdf'
			})
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = `Lieferantenkonto-${name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}-${year}.pdf`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<h1 class="text-2xl font-bold break-words text-heading" data-testid="vendor-account-title">
		{t('vendorAccount.title', { name: name || '—' })}
	</h1>
	<a class="text-sm text-text underline" href={resolve('/zahlungen')}>{t('vendorAccount.back')}</a>
</div>
<p class="mt-1 text-sm text-faint">{t('vendorAccount.intro')}</p>

{#if timeline}
	<section class="mt-4 {card}" data-testid="vendor-account-summary">
		<dl class="grid gap-3 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-faint">{t('vendorAccount.opening', { date: formatDate(from) })}</dt>
				<dd class="font-mono text-heading tabular-nums" data-testid="vendor-account-opening">
					{opening === null ? t('vendorAccount.unknown') : money(opening)}
				</dd>
			</div>
			<div>
				<dt class="text-faint">{t('vendorAccount.topUps')}</dt>
				<dd class="font-mono text-heading tabular-nums">{money(timeline.topUpCents)}</dd>
			</div>
			<div>
				<dt class="text-faint">{t('vendorAccount.usage')}</dt>
				<dd class="font-mono text-heading tabular-nums">{money(timeline.usageCents)}</dd>
			</div>
			<div>
				<dt class="text-faint">
					{t('vendorAccount.closing', { date: formatDate(wholeYear ? `${year}-12-31` : until) })}
				</dt>
				<dd
					class="font-mono tabular-nums {timeline.closingCents < 0
						? 'text-danger'
						: 'text-heading'}"
					data-testid="vendor-account-closing"
				>
					{money(timeline.closingCents)}
				</dd>
			</div>
		</dl>
		<label class="mt-3 flex items-center gap-2 text-sm text-text">
			<input type="checkbox" bind:checked={wholeYear} data-testid="vendor-account-whole-year" />
			{t('vendorAccount.wholeYear', { year })}
		</label>
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class={button}
				disabled={!client || explaining || !timeline.rows.length}
				title={client ? t('vendorAccount.explainTitle') : t('vendorAccount.explainNeedsBridge')}
				onclick={explain}
				data-testid="vendor-account-explain"><AiMark />{t('vendorAccount.explain')}</button
			>
			<button
				type="button"
				class={button}
				disabled={!timeline.rows.length}
				onclick={downloadPdf}
				data-testid="vendor-account-pdf">{t('vendorAccount.pdf')}</button
			>
		</div>
		{#if explainError}
			<p class="mt-2 text-sm text-danger" role="alert">{explainError}</p>
		{/if}
		{#if notes}
			<div
				class="mt-3 rounded-md border border-cyan-800/40 bg-surface-2 px-3 py-2 text-sm dark:border-cyan/40"
				role="status"
				data-testid="vendor-account-notes"
			>
				<p class="font-medium text-heading"><AiMark />{t('vendorAccount.notes')}</p>
				<ul class="mt-1 list-disc pl-5">
					{#each notes as note, i (i)}<li>{note}</li>{/each}
				</ul>
			</div>
		{/if}
	</section>

	{#if timeline.findings.length}
		<section class="mt-4 {card}" data-testid="vendor-account-findings">
			<h2 class="text-sm font-semibold text-heading">{t('vendorAccount.findings')}</h2>
			<ul class="mt-2 list-disc pl-5 text-sm text-text">
				{#each timeline.findings as f, i (i)}
					<li data-testid="vendor-account-finding" data-kind={f.kind}>{findingText(f)}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="mt-4 {card}">
		{#if prepaid}
			<p class="text-sm text-heading" data-testid="vendor-account-prepaid">
				{t('vendorAccount.isPrepaid')}
			</p>
			<form
				class="mt-2 flex flex-wrap items-end gap-2 text-sm"
				onsubmit={(e) => {
					e.preventDefault();
					saveOpening();
				}}
			>
				<label class="flex flex-col text-faint"
					>{t('vendorAccount.openingLabel', { year })}
					<input
						class="mt-1 w-32 rounded border border-border bg-surface px-2 py-1 text-heading"
						inputmode="decimal"
						placeholder={opening === null ? '0,00' : (opening / 100).toFixed(2).replace('.', ',')}
						bind:value={openingText}
						data-testid="vendor-account-opening-input"
					/></label
				>
				<button
					type="submit"
					class={button}
					disabled={busy}
					data-testid="vendor-account-opening-save">{t('vendorAccount.save')}</button
				>
				<button
					type="button"
					class={button}
					disabled={busy}
					onclick={() => act(() => setPrepaidVendor(store(), name, false))}
					data-testid="vendor-account-prepaid-off">{t('vendorAccount.prepaidOff')}</button
				>
			</form>
		{:else}
			{#if suggest}
				<p class="text-sm text-heading" data-testid="vendor-account-suggest">
					{t('vendorAccount.suggest')}
				</p>
			{/if}
			<p class="mt-1 text-sm text-text">{t('vendorAccount.prepaidWhat')}</p>
			<button
				type="button"
				class="mt-2 {button}"
				disabled={busy || !name}
				onclick={() => act(() => setPrepaidVendor(store(), name, true))}
				data-testid="vendor-account-prepaid-on">{t('vendorAccount.prepaidOn')}</button
			>
		{/if}
	</section>

	<section class="mt-4 {card}">
		{#if timeline.rows.length}
			<div class="overflow-x-auto">
				<table class="w-full text-sm" data-testid="vendor-account-rows">
					<thead>
						<tr class="text-left text-xs text-faint">
							<th class="py-1 pr-3 font-medium">{t('vendorAccount.col.date')}</th>
							<th class="py-1 pr-3 font-medium">{t('vendorAccount.col.what')}</th>
							<th class="py-1 pr-3 font-medium">{t('vendorAccount.period')}</th>
							<th class="py-1 pr-3 text-right font-medium">{t('vendorAccount.col.topUp')}</th>
							<th class="py-1 pr-3 text-right font-medium">{t('vendorAccount.col.usage')}</th>
							<th class="py-1 text-right font-medium">{t('vendorAccount.col.balance')}</th>
						</tr>
					</thead>
					<tbody class="tabular-nums">
						{#each timeline.rows as r (r.kind + r.id)}
							<tr
								class="border-t border-border"
								data-testid="vendor-account-row"
								data-kind={r.kind}
							>
								<td class="py-1.5 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
								<td class="py-1.5 pr-3">
									{#if r.kind === 'payment'}
										<a
											class="underline"
											href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(r.id)}`}
											>{t('vendorAccount.payment')}</a
										>
									{:else if r.items?.length}
										<details data-testid="vendor-account-items">
											<summary class="cursor-pointer">{t('vendorAccount.statement')}</summary>
											<ul class="mt-1 text-xs text-faint">
												{#each r.items as item, i (i)}
													<li>{item.description} · {money(item.cents)}</li>
												{/each}
											</ul>
										</details>
									{:else}
										{t('vendorAccount.statement')}
									{/if}
								</td>
								<td
									class="py-1.5 pr-3 whitespace-nowrap text-faint"
									data-testid="vendor-account-period"
									>{r.period ? `${formatDate(r.period.from)} – ${formatDate(r.period.to)}` : ''}</td
								>
								<td class="py-1.5 pr-3 text-right font-mono"
									>{r.topUpCents ? money(r.topUpCents) : ''}</td
								>
								<td class="py-1.5 pr-3 text-right font-mono"
									>{r.usageCents ? money(r.usageCents) : ''}</td
								>
								<td
									class="py-1.5 text-right font-mono {r.balanceCents < 0
										? 'text-danger'
										: 'text-heading'}">{money(r.balanceCents)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-faint" data-testid="vendor-account-empty">
				{t('vendorAccount.empty')}
			</p>
		{/if}
	</section>
{/if}
