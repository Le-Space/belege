<script>
	// A wallet's network fees of a month as one row (Zahlungen, #1043): the
	// sum, how many have an account and a receipt, and – opened – the single
	// fees, each opening its payment. In "Ohne Konto" one account field and one
	// "Übernehmen" for the whole group (actions.js `confirmFeeGroup`), and
	// "Rückgängig" for what it wrote until the page is left. Everything here
	// is text: a fee's memo is the chain's, never markup.
	import { quantityText } from '../assets/valuation.js';
	import { formatBookingTime, formatMonth, formatTxAmount, txDirection } from '../bank/format.js';
	import { t } from '../i18n/index.js';
	import { app, currentStore, refreshNow } from '../session.svelte.js';
	import { confirmFeeGroup, undoFeeGroup } from './actions.js';
	import { suggestFor } from './list-assist.svelte.js';
	import { catalogueAccount, isAccountNumber } from './skr03.js';
	import { isBookingConfirmed } from './suggest.js';

	/**
	 * @type {{
	 *   group: import('./fee-groups.js').FeeGroupItem,
	 *   wallet: string,
	 *   byAccount: boolean,
	 *   undo: import('./actions.js').FeeGroupUndo | null,
	 *   onundo: (undo: import('./actions.js').FeeGroupUndo | null) => void,
	 *   onopen: (id: string) => void
	 * }}
	 */
	let { group, wallet, byAccount, undo, onundo, onopen } = $props();

	let expanded = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let said = $state(null);

	// What the books suggest for the group's fees: the fee rule's account, else 4970 (suggest.js).
	let suggestion = $derived(suggestFor(group.open[0] ?? group.fees[0], app));
	let mixed = $derived(group.accounts.length > 1);
	let text = $state('');
	let seeded = $state('');
	$effect(() => {
		const offered = suggestion.account ?? group.accounts[0]?.account ?? '';
		if (offered && seeded !== `${group.id}|${offered}`) {
			seeded = `${group.id}|${offered}`;
			text = offered;
		}
	});
	let number = $derived(/^\s*(\d{4,8})(?:\s|$)/.exec(text)?.[1] ?? text.trim());
	let known = $derived(catalogueAccount(number, app.chart));
	let monthLabel = $derived(formatMonth(group.month));
	let direction = $derived(txDirection(group));
	let ids = $derived(group.fees.map((tx) => tx.id));

	/** @param {'open' | 'all'} only */
	async function take(only) {
		const store = currentStore();
		if (!store || busy) return;
		if (!isAccountNumber(number)) {
			error = t('booking.invalidAccount');
			return;
		}
		busy = true;
		error = null;
		said = null;
		try {
			const done = await confirmFeeGroup(
				/** @type {any} */ (store),
				ids,
				{ account: number, taxKey: suggestion.account === number ? suggestion.taxKey : '' },
				{ only, month: group.month }
			);
			onundo(done.changes.length ? done : null);
			await refreshNow();
		} catch (e) {
			error = t('zahlungen.feeGroup.failed', { error: e instanceof Error ? e.message : String(e) });
		} finally {
			busy = false;
		}
	}

	async function takeBack() {
		const store = currentStore();
		if (!store || !undo || busy) return;
		busy = true;
		error = null;
		try {
			const back = await undoFeeGroup(/** @type {any} */ (store), undo);
			onundo(null);
			said = t('zahlungen.feeGroup.undone', { count: back });
			await refreshNow();
		} catch (e) {
			error = t('zahlungen.feeGroup.failed', { error: e instanceof Error ? e.message : String(e) });
		} finally {
			busy = false;
		}
	}
</script>

<div
	data-testid="fee-group"
	data-group={group.id}
	data-booking={group.booking}
	data-cover={group.cover}
>
	<div class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap">
		<button
			type="button"
			class="grid size-7 shrink-0 place-items-center rounded-md border border-border text-text hover:bg-surface-2"
			aria-expanded={expanded}
			aria-label={t(expanded ? 'zahlungen.feeGroup.collapse' : 'zahlungen.feeGroup.expand', {
				wallet
			})}
			onclick={() => (expanded = !expanded)}
			data-testid="fee-group-toggle"
			><svg
				class="transition-transform motion-reduce:transition-none {expanded ? 'rotate-90' : ''}"
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg
			></button
		>
		<button
			type="button"
			class="min-w-0 flex-1 basis-0 text-left"
			onclick={() => (expanded = !expanded)}
			data-testid="fee-group-head"
		>
			<span class="block truncate font-medium text-heading" data-testid="fee-group-title"
				>{t('zahlungen.feeGroup.title', { wallet })}</span
			>
			<span class="block truncate text-sm text-faint" data-testid="fee-group-meta"
				>{t('zahlungen.feeGroup.meta', { month: monthLabel, count: group.fees.length })}</span
			>
			<span class="mt-1 flex flex-wrap gap-1">
				{#if group.booking === 'none'}
					<span
						class="inline-block rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
						data-testid="no-account-badge">{t('zahlungen.noAccountBadge')}</span
					>
				{:else if group.booking === 'some'}
					<span
						class="inline-block rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
						data-testid="fee-group-open"
						>{t('zahlungen.feeGroup.openOf', {
							open: group.open.length,
							count: group.fees.length
						})}</span
					>
				{:else}
					<span
						class="inline-block rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs text-success"
						data-testid="fee-group-confirmed">{t('zahlungen.feeGroup.allConfirmed')}</span
					>
				{/if}
				{#if group.cover === 'all'}
					<span
						class="inline-block rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs text-success"
						data-testid="fee-group-covered">{t('zahlungen.feeGroup.covered')}</span
					>
				{:else if group.cover === 'some'}
					<span
						class="inline-block rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
						data-testid="fee-group-covered-some"
						>{t('zahlungen.feeGroup.coveredSome', {
							covered: group.covered,
							count: group.fees.length
						})}</span
					>
				{:else}
					<span
						class="inline-block rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
						data-testid="no-receipt-badge">{t('zahlungen.noReceiptBadge')}</span
					>
				{/if}
				{#if mixed}
					<span
						class="inline-block rounded border border-warning/40 bg-surface-2 px-1.5 py-0.5 text-xs text-warning"
						data-testid="fee-group-mixed">{t('zahlungen.feeGroup.mixed')}</span
					>
				{/if}
			</span>
		</button>
		{#if group.accounts.length}
			<span
				class="min-w-0 truncate rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text sm:shrink-0"
				data-testid="fee-group-accounts"
				>{mixed
					? group.accounts.map((a) => t('zahlungen.feeGroup.accountTimes', a)).join(' · ')
					: group.accounts[0].account}</span
			>
		{/if}
		<span class="ml-auto flex shrink-0 flex-col items-end">
			<span
				class="font-mono whitespace-nowrap tabular-nums {direction < 0
					? 'text-red-700 dark:text-red-400'
					: 'text-heading'}"
				data-testid="amount">{formatTxAmount(group)}</span
			>
			{#if quantityText(group)}
				<span
					class="font-mono text-xs whitespace-nowrap text-faint tabular-nums"
					data-testid="amount-quantity">{quantityText(group)}</span
				>
			{/if}
		</span>
	</div>

	{#if undo}
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-sm text-success"
			role="status"
			data-testid="fee-group-taken"
		>
			<span
				>{t('zahlungen.feeGroup.taken', {
					count: undo.changes.length,
					account: undo.account
				})}</span
			>
			<button
				type="button"
				class="text-link underline disabled:opacity-50"
				disabled={busy}
				onclick={takeBack}
				data-testid="fee-group-undo">{t('zahlungen.feeGroup.undo')}</button
			>
		</div>
	{:else if byAccount && (group.open.length || mixed)}
		<div
			class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 text-sm"
			data-testid="fee-group-take"
		>
			<label class="flex items-center gap-2">
				<span class="text-faint">{t('booking.account')}</span>
				<input
					class="w-28 rounded-md border px-2 py-1 font-mono text-sm"
					list="suggest-accounts-out"
					inputmode="numeric"
					autocomplete="off"
					aria-label={t('zahlungen.feeGroup.account')}
					bind:value={text}
					placeholder={t('zahlungen.suggest.placeholder')}
					data-testid="fee-group-input"
				/>
			</label>
			{#if group.open.length}
				<button
					type="button"
					class="rounded-md border border-cyan-800 px-2 py-1 text-sm font-semibold text-heading hover:bg-surface-2 disabled:opacity-50 dark:border-cyan"
					disabled={busy || !isAccountNumber(number)}
					onclick={() => take('open')}
					data-testid="fee-group-confirm"
					>{t('zahlungen.feeGroup.take', { count: group.open.length })}</button
				>
			{/if}
			{#if group.accounts.length && (mixed || group.accounts[0].account !== number)}
				<button
					type="button"
					class="rounded-md border border-border px-2 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
					disabled={busy || !isAccountNumber(number)}
					onclick={() => take('all')}
					data-testid="fee-group-unify">{t('zahlungen.feeGroup.unify')}</button
				>
			{/if}
			<span class="min-w-0 flex-1 truncate text-xs text-faint" data-testid="fee-group-why">
				{#if known}<span class="text-text">{known.name}</span>{/if}
				{#if group.open.length && group.open.length < group.fees.length}
					{#if known}&nbsp;·&#32;{/if}{t('zahlungen.feeGroup.kept', {
						count: group.fees.length - group.open.length
					})}
				{/if}
			</span>
		</div>
	{/if}
	{#if said}
		<p class="px-4 pb-3 text-sm text-faint" role="status" data-testid="fee-group-said">{said}</p>
	{/if}
	{#if error}
		<p class="px-4 pb-3 text-sm text-danger" role="alert" data-testid="fee-group-error">{error}</p>
	{/if}

	{#if expanded}
		<ul
			class="ml-4 divide-y divide-border border-t border-dashed border-border sm:ml-11"
			data-testid="fee-group-fees"
		>
			{#each [...group.fees].reverse() as tx (tx.id)}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-x-3 px-4 py-2 text-left text-sm hover:bg-surface-2/60"
						onclick={() => onopen(tx.id)}
						data-tx={tx.id}
						data-testid="fee-group-fee"
					>
						<span class="min-w-0 flex-1 truncate text-text"
							><span class="tabular-nums">{formatBookingTime(tx) || tx.bookedOn}</span
							>{#if tx.purpose}&nbsp;·&#32;{tx.purpose}{/if}</span
						>
						{#if isBookingConfirmed(tx)}
							<span
								class="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text"
								>{tx.booking.account}</span
							>
						{:else}
							<span
								class="shrink-0 rounded border border-coral-700/40 px-1.5 py-0.5 text-xs text-coral-800 dark:border-coral/40 dark:text-coral"
								>{t('zahlungen.noAccountBadge')}</span
							>
						{/if}
						<span class="flex shrink-0 flex-col items-end">
							<span
								class="font-mono text-xs whitespace-nowrap text-red-700 tabular-nums dark:text-red-400"
								>{formatTxAmount(tx)}</span
							>
							{#if quantityText(tx)}
								<span class="font-mono text-xs whitespace-nowrap text-faint tabular-nums"
									>{quantityText(tx)}</span
								>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
