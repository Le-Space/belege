<script>
	// Verlauf: what the app did (sync, mail fetch, extraction, matching) and
	// what a person decided, newest first, from the sealed `events` collection.
	// Each entry links to its receipt and its booking.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { app } from '$lib/session.svelte.js';
	import { describeMoment } from '$lib/moment.js';
	import { GROUPS, eventGroup, filterEvents } from '$lib/activity/events.js';
	import { describeEvent } from '$lib/activity/view.js';
	import { list, t } from '$lib/i18n/index.js';

	const PAGE = 100;

	/** @type {'all' | import('$lib/activity/events.js').EventGroup} */
	let group = $state('all');
	let shown = $state(PAGE);

	onMount(() => {
		const wanted = page.url.searchParams.get('group');
		const known = /** @type {readonly string[]} */ (GROUPS);
		if (wanted && known.includes(wanted)) {
			group = /** @type {import('$lib/activity/events.js').EventGroup} */ (wanted);
		}
	});

	let all = $derived(filterEvents(app.events));
	let visible = $derived(filterEvents(app.events, group));
	/** @param {import('$lib/activity/events.js').EventGroup} g */
	const count = (g) => all.filter((e) => eventGroup(e) === g).length;

	/** @param {string} id */
	const receiptHref = (id) => `${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;
	/** @param {string} id */
	const txHref = (id) => `${resolve('/zahlungen')}?tx=${encodeURIComponent(id)}`;

	/** @type {Record<string, string>} */
	const groupClass = {
		auslesen: 'border-infra/30 bg-infra/10 text-infra-800 dark:text-infra',
		abgleich: 'border-cyan-800/30 bg-cyan-800/10 text-cyan-800 dark:border-cyan/30 dark:text-cyan',
		abruf: 'border-border bg-surface-2 text-text',
		entscheidungen: 'border-success/30 bg-success/10 text-success'
	};

	const chip =
		'rounded-full border px-3 py-1 text-sm aria-pressed:border-cyan-800 aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-heading dark:aria-pressed:border-cyan';
</script>

<h1 class="text-2xl font-bold text-heading">{t('verlauf.title')}</h1>
<p class="mt-1 text-sm text-faint">{t('verlauf.intro')}</p>

<div class="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('verlauf.filters')}>
	<button
		type="button"
		class="{chip} border-border text-text"
		aria-pressed={group === 'all'}
		onclick={() => (group = 'all')}
		data-testid="verlauf-filter"
		data-group="all">{t('verlauf.all', { count: all.length })}</button
	>
	{#each GROUPS as g (g)}
		<button
			type="button"
			class="{chip} border-border text-text"
			aria-pressed={group === g}
			onclick={() => {
				group = g;
				shown = PAGE;
			}}
			data-testid="verlauf-filter"
			data-group={g}>{t(`verlauf.group.${g}`, { count: count(g) })}</button
		>
	{/each}
</div>

{#if visible.length === 0}
	<p
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 text-text shadow-sm"
		data-testid="verlauf-empty"
	>
		{t('verlauf.empty')}
	</p>
{:else}
	<ol
		class="mt-4 divide-y divide-border rounded-lg border border-border bg-surface shadow-sm"
		data-testid="verlauf-list"
	>
		{#each visible.slice(0, shown) as e (e.id)}
			{@const d = describeEvent(e, { receipts: app.receipts, transactions: app.transactions })}
			{@const m = describeMoment(e.at)}
			{@const g = eventGroup(e)}
			<li
				class="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4"
				data-testid="verlauf-event"
				data-kind={e.kind}
				data-group={g}
			>
				<time
					class="shrink-0 text-xs text-faint tabular-nums sm:w-36"
					datetime={m?.datetime ?? e.at}
					title={m?.utc ?? e.at}>{m?.local ?? e.at}</time
				>
				<div class="min-w-0 flex-1">
					<p class="flex flex-wrap items-center gap-2">
						<span
							class="rounded border px-1.5 py-0.5 text-xs font-medium {groupClass[g ?? 'abruf']}"
							>{t(`verlauf.groupName.${g}`)}</span
						>
						<span
							class="font-medium {d.failed ? 'text-danger' : 'text-heading'}"
							data-testid="verlauf-title">{d.title}</span
						>
					</p>
					{#if d.text}
						<p class="mt-0.5 text-sm break-words text-text" data-testid="verlauf-text">{d.text}</p>
					{/if}
					{#if d.receiptId || d.transactionId}
						<p class="mt-1 flex flex-wrap gap-3 text-sm">
							{#if d.receiptId}
								<a
									class="text-text underline hover:text-heading"
									href={receiptHref(d.receiptId)}
									data-testid="verlauf-open-receipt">{t('verlauf.openReceipt')}</a
								>
							{/if}
							{#if d.transactionId}
								<a
									class="text-text underline hover:text-heading"
									href={txHref(d.transactionId)}
									data-testid="verlauf-open-tx">{t('verlauf.openTx')}</a
								>
							{/if}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	{#if visible.length > shown}
		<button
			type="button"
			class="mt-3 text-sm text-text underline"
			onclick={() => (shown += PAGE)}
			data-testid="verlauf-more">{t('verlauf.more', { count: visible.length - shown })}</button
		>
	{/if}
{/if}

<TechnicalNote class="mt-6" lines={list('verlauf.technical')} />
