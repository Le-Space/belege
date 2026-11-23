<script>
	// One wallet as one row of its chain's group (#1019): status, name and
	// address, the balances rounded and aligned, when it was synced, a sync
	// icon, a ⋯ menu (name, account, cost centre · block explorer · remove) and
	// the details. What a sync brought stays below the row.
	import { formatDate } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import { walletRun } from './sync-run.svelte.js';
	import { syncedAgo } from './wallet-groups.js';
	import WalletDetails from './WalletDetails.svelte';
	import WalletMetaFields from './WalletMetaFields.svelte';

	/** @type {{ wallet: import('./wallet-sync.js').Wallet, ctx: import('./wallet-groups.js').RowContext }} */
	let { wallet, ctx } = $props();

	const label = $derived(
		wallet.name ||
			(wallet.address.length > 16
				? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
				: wallet.address)
	);
	const accounts = $derived(ctx.accountsOf(wallet));
	const shown = $derived(accounts.filter((a) => a.rounded));
	const without = $derived(accounts.length - shown.length);
	const problem = $derived(ctx.problemOf(wallet));
	const error = $derived(walletRun.errors[wallet.id]);
	const result = $derived(walletRun.results[wallet.id]);
	const ago = $derived(syncedAgo(wallet.lastSyncedAt));
	const agoText = $derived(
		ago.key === 'date'
			? t('integrationen.wallets.row.ago.date', { date: formatDate(ago.date ?? '') })
			: t(`integrationen.wallets.row.ago.${ago.key}`, { count: ago.count ?? 0 })
	);
	const link = $derived(ctx.addressLink(wallet));

	let detailsOpen = $state(false);
	let menuOpen = $state(false);
	let editing = $state(false);
	let editName = $state('');
	let editLedger = $state('');
	let editCostCentre = $state('');
	/** @type {string | null} */
	let editError = $state(null);
	/** @type {HTMLElement | undefined} */
	let menuBox = $state();

	function openEdit() {
		menuOpen = false;
		editing = true;
		editName = wallet.name ?? '';
		editLedger = wallet.ledgerAccount ?? '';
		editCostCentre = wallet.costCentre ?? '';
		editError = null;
	}

	/** @param {SubmitEvent} event */
	async function saveEdit(event) {
		event.preventDefault();
		editError = null;
		try {
			await ctx.saveMeta(wallet, {
				name: editName,
				ledgerAccount: editLedger,
				costCentre: editCostCentre
			});
			editing = false;
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {MouseEvent} event */
	function outside(event) {
		if (menuOpen && menuBox && !menuBox.contains(/** @type {Node} */ (event.target)))
			menuOpen = false;
	}
	/** @param {KeyboardEvent} event */
	function escape(event) {
		if (menuOpen && event.key === 'Escape') menuOpen = false;
	}
	const icon =
		'inline-flex h-11 w-11 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-md text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const item =
		'block w-full rounded px-3 py-2 text-left text-sm text-heading hover:bg-surface-2 disabled:opacity-50';
</script>

<svelte:window onclick={outside} onkeydown={escape} />

<li
	class="border-t border-border first:border-t-0"
	data-testid="wallet"
	data-chain={wallet.chain}
	data-problem={problem ?? 'ok'}
>
	<div
		class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 pr-2 pl-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto]"
	>
		<span
			class="row-start-1 flex h-5 w-5 items-center justify-center"
			title={t(`integrationen.wallets.row.${problem ?? 'ok'}`)}
			data-testid="wallet-status"
			data-status={problem ?? 'ok'}
		>
			<span class="sr-only">{t(`integrationen.wallets.row.${problem ?? 'ok'}`)}</span>
			{#if problem === 'error'}
				<svg viewBox="0 0 16 16" class="h-4 w-4 text-danger" aria-hidden="true"
					><circle cx="8" cy="8" r="7" fill="currentColor" /><path
						d="M5.5 5.5l5 5M10.5 5.5l-5 5"
						stroke="var(--surface)"
						stroke-width="1.6"
					/></svg
				>
			{:else if problem === 'gap'}
				<svg viewBox="0 0 16 16" class="h-4 w-4 text-warning" aria-hidden="true"
					><path
						d="M8 1.5l7 12.5H1z"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linejoin="round"
					/><path
						d="M8 6v4M8 11.6v.1"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/></svg
				>
			{:else}
				<svg viewBox="0 0 16 16" class="h-4 w-4 text-success" aria-hidden="true"
					><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path
						d="M5 8.2l2 2 4-4.2"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
					/></svg
				>
			{/if}
		</span>

		<div class="row-start-1 flex min-w-0 flex-col">
			{#if wallet.name}
				<span class="truncate font-medium text-heading" data-testid="wallet-name"
					>{wallet.name}</span
				>
			{/if}
			<code class="flex min-w-0 font-mono text-xs text-faint" data-testid="wallet-address"
				><CopyButton
					text={wallet.address}
					label={t('copy.address')}
					class="flex min-w-0 items-baseline gap-0.5"
					valueClass="truncate"
					testid="wallet-address-copy">{wallet.address}</CopyButton
				></code
			>
			{#if error}
				<span class="truncate text-xs text-danger" data-testid="wallet-error">{error}</span>
			{:else if problem === 'gap'}
				<span class="text-xs text-warning">{t('integrationen.wallets.row.gap')}</span>
			{/if}
		</div>

		<div
			class="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-col items-stretch gap-px sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:items-end"
			data-testid="wallet-balances"
		>
			{#each shown as a (a.account.id)}
				<span
					class="flex justify-between gap-2 font-mono text-sm whitespace-nowrap text-heading tabular-nums sm:justify-end"
					title={a.balance}
					data-testid="wallet-balance">{a.rounded}</span
				>
			{/each}
			{#if without}
				<span class="text-xs text-faint sm:text-right" data-testid="wallet-more-tokens"
					>{t('integrationen.wallets.row.moreTokens', { count: without })}</span
				>
			{/if}
		</div>

		<div class="col-start-3 row-start-1 flex items-center gap-0.5 sm:col-start-4">
			<span
				class="mr-1 hidden min-w-[5.5rem] text-right text-xs whitespace-nowrap text-faint sm:inline"
				title={t('integrationen.wallets.row.synced')}
				data-testid="wallet-synced"
				>{walletRun.syncing === wallet.id ? t('integrationen.wallets.syncing') : agoText}</span
			>
			{#if ctx.imported(wallet)}
				<!-- Monero: no sync by address; the wallet's own export, read here. -->
				<label
					class="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-2 text-xs text-heading hover:bg-surface-2 sm:min-h-8 {ctx.busy
						? 'pointer-events-none opacity-50'
						: ''}"
					data-testid="wallet-import"
					>{walletRun.syncing === wallet.id
						? t('integrationen.wallets.importing')
						: t('integrationen.wallets.import')}<input
						type="file"
						accept=".csv,text/csv"
						class="sr-only"
						disabled={ctx.busy}
						onchange={(e) => {
							const input = /** @type {HTMLInputElement} */ (e.currentTarget);
							void ctx.importHistory(wallet, input.files?.[0]);
							input.value = '';
						}}
						data-testid="wallet-import-file"
					/></label
				>
			{:else}
				<button
					type="button"
					class={icon}
					disabled={ctx.busy}
					onclick={() => ctx.sync(wallet)}
					title={t('integrationen.wallets.sync')}
					aria-label={t('integrationen.wallets.row.syncOne', { name: label })}
					data-testid="wallet-sync"
					data-syncing={walletRun.syncing === wallet.id}
					><svg
						viewBox="0 0 16 16"
						class="h-4 w-4 {walletRun.syncing === wallet.id ? 'motion-safe:animate-spin' : ''}"
						aria-hidden="true"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.6M2.5 8a5.5 5.5 0 0 1 9.6-3.6" /><path
							d="M12.5 1.5v3h-3M3.5 14.5v-3h3"
						/></svg
					></button
				>
			{/if}
			<div class="relative" bind:this={menuBox}>
				<button
					type="button"
					class={icon}
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					aria-label={t('integrationen.wallets.row.more', { name: label })}
					title={t('integrationen.wallets.row.more', { name: label })}
					onclick={() => (menuOpen = !menuOpen)}
					data-testid="wallet-menu"
					><svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true" fill="currentColor"
						><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle
							cx="13"
							cy="8"
							r="1.4"
						/></svg
					></button
				>
				<div
					class="absolute top-full right-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface p-1 shadow-lg"
					role="menu"
					hidden={!menuOpen}
					data-testid="wallet-menu-items"
				>
					<button
						type="button"
						role="menuitem"
						class={item}
						onclick={openEdit}
						data-testid="wallet-edit">{t('integrationen.wallets.meta.edit')} …</button
					>
					{#if link}
						<a
							role="menuitem"
							href={link}
							target="_blank"
							rel="noopener noreferrer"
							class={item}
							onclick={() => (menuOpen = false)}
							data-testid="wallet-explorer"
							>{t('integrationen.wallets.explorerMenu', { name: ctx.explorerName(wallet) })} ↗</a
						>
					{/if}
					<hr class="my-1 border-border" />
					<button
						type="button"
						role="menuitem"
						class="{item} text-danger"
						disabled={ctx.busy}
						onclick={() => {
							menuOpen = false;
							void ctx.remove(wallet);
						}}
						data-testid="wallet-remove">{t('integrationen.wallets.remove')}</button
					>
				</div>
			</div>
			<button
				type="button"
				class={icon}
				aria-expanded={detailsOpen}
				aria-controls={`wallet-details-${wallet.id}`}
				aria-label={t('integrationen.wallets.row.details', { name: label })}
				title={t('integrationen.wallets.row.details', { name: label })}
				onclick={() => (detailsOpen = !detailsOpen)}
				data-testid="wallet-details-toggle"
				><svg
					viewBox="0 0 16 16"
					class="h-4 w-4 transition-transform motion-reduce:transition-none {detailsOpen
						? ''
						: '-rotate-90'}"
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"><path d="M3.5 6l4.5 4.5L12.5 6" /></svg
				></button
			>
		</div>
	</div>

	{#if editing}
		<form
			class="mx-3 mb-3 flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm sm:ml-11"
			onsubmit={saveEdit}
			data-testid="wallet-edit-form"
		>
			<WalletMetaFields
				bind:name={editName}
				bind:ledger={editLedger}
				bind:cost={editCostCentre}
				id="wallet-edit"
			/>
			<div class="flex gap-3">
				<button
					type="submit"
					class="rounded-md border border-border bg-surface px-3 py-1 font-medium text-heading hover:bg-surface-2"
					data-testid="wallet-edit-save">{t('integrationen.wallets.meta.save')}</button
				>
				<button
					type="button"
					class="text-faint underline hover:text-heading"
					onclick={() => (editing = false)}>{t('integrationen.wallets.meta.cancel')}</button
				>
			</div>
			{#if editError}
				<p class="text-danger" role="alert" data-testid="wallet-edit-error">{editError}</p>
			{/if}
		</form>
	{/if}

	<WalletDetails
		{wallet}
		open={detailsOpen}
		id={`wallet-details-${wallet.id}`}
		alchemy={ctx.readByAlchemy(wallet)}
		alchemyInternal={ctx.alchemyInternal(wallet)}
		endpoints={ctx.endpointsOf(wallet)}
		{accounts}
		{error}
	/>

	{#if result}
		<div class="mx-3 mb-3 sm:ml-11">
			<p class="text-sm text-heading" role="status" data-testid="wallet-result">
				{t('integrationen.counts', result.totals)}{#if result.superseded}
					·
					<a
						class="underline"
						href={ctx.verlaufAbruf}
						title={t('integrationen.wallets.supersededTitle')}
						data-testid="wallet-result-superseded"
						>{t('integrationen.wallets.superseded', { count: result.superseded })}</a
					>{/if}
			</p>
			{#if result.unpriced.length}
				<p class="mt-1 text-sm text-warning" role="status" data-testid="wallet-unpriced">
					{t('integrationen.wallets.unpriced', {
						count: result.unpriced.length,
						assets: [...new Set(result.unpriced.map((u) => u.asset))].join(', ')
					})}
				</p>
			{/if}
			{#if result.unknownAssets}
				<p class="mt-1 text-xs text-faint" data-testid="wallet-unknown">
					{t('integrationen.wallets.unknownAssets', { count: result.unknownAssets })}
				</p>
			{/if}
			{#if result.history.pruned && result.history.completedBy === 'indexer'}
				<p class="mt-1 text-xs text-faint" data-testid="wallet-indexed">
					{t('integrationen.wallets.indexed', {
						date: result.history.earliestTime
							? formatDate(result.history.earliestTime.slice(0, 10))
							: '?'
					})}
				</p>
				{#if result.history.unknownAmounts}
					<p class="mt-1 text-sm text-warning" role="status" data-testid="wallet-unknown-amounts">
						{t('integrationen.wallets.unknownAmounts', { count: result.history.unknownAmounts })}
					</p>
				{/if}
			{:else if result.history.pruned}
				<p class="mt-1 text-sm text-warning" role="status" data-testid="wallet-pruned">
					{t('integrationen.wallets.pruned', {
						date: result.history.earliestTime
							? formatDate(result.history.earliestTime.slice(0, 10))
							: '?'
					})}{result.history.indexerError ? ` ${t('integrationen.wallets.indexerFailed')}` : ''}
				</p>
			{/if}
		</div>
	{/if}
</li>
