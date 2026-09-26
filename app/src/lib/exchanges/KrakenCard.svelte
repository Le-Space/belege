<script>
	// Integrationen → Kraken: the accounts on the exchange, one per asset and
	// wallet, and "Kraken synchronisieren" (kraken-sync.js).
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { formatDate } from '$lib/bank/format.js';
	import { formatQuantity, toUnits } from '$lib/assets/quantity.js';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { syncKraken } from './kraken-sync.js';

	/** @type {{ url: string, token: string | null, configured: boolean }} */
	let { url, token, configured } = $props();

	const client = $derived(createBridgeClient({ url, token }));
	const accounts = $derived(
		app.accounts
			.filter((a) => a.source === 'kraken' && !a.deleted)
			.sort((a, b) => (a.name < b.name ? -1 : 1))
	);
	const today = new Date().toISOString().slice(0, 10);

	let from = $state('');
	let syncing = $state(false);
	/** @type {Awaited<ReturnType<typeof syncKraken>> | null} */
	let result = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @param {Record<string, any>} account */
	function balanceText(account) {
		if (typeof account.balance !== 'string' || !Number.isInteger(account.decimals)) return '';
		try {
			return formatQuantity(
				toUnits(account.balance, account.decimals),
				account.decimals,
				account.asset,
				{
					minFraction: account.asset === 'EUR' ? 2 : 0
				}
			);
		} catch {
			return '';
		}
	}

	async function sync() {
		const store = currentStore();
		if (!store) return;
		syncing = true;
		error = null;
		result = null;
		try {
			result = await syncKraken({ client, store, from: from || undefined });
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			syncing = false;
		}
		if (result) await runMatchingNow();
	}
</script>

{#if token}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		aria-labelledby="kraken-h"
		data-testid="kraken-card"
	>
		<h2 id="kraken-h" class="text-lg font-semibold">{t('integrationen.kraken.title')}</h2>
		{#if !configured}
			<p class="mt-2 text-sm text-text" data-testid="kraken-not-set-up">
				{t('integrationen.kraken.notSetUp')}
				<code class="rounded border border-border px-1 font-mono text-xs">pnpm setup:kraken</code>
			</p>
		{:else}
			<p class="mt-2 text-sm text-text">{t('integrationen.kraken.intro')}</p>
			{#if accounts.length}
				<ul class="mt-3 divide-y divide-border" data-testid="kraken-accounts">
					{#each accounts as account (account.id)}
						<li class="flex flex-wrap items-center gap-3 py-2" data-testid="kraken-account">
							<span class="min-w-0 flex-1">
								<span class="block font-medium text-heading">{account.name}</span>
								{#if account.lastSyncedOn}
									<span class="block text-xs text-faint"
										>{t('integrationen.kraken.lastSync', {
											date: formatDate(account.lastSyncedOn)
										})}</span
									>
								{/if}
							</span>
							{#if balanceText(account)}
								<span class="font-mono text-sm text-heading tabular-nums"
									>{balanceText(account)}</span
								>
								{#if account.balanceOn}
									<span class="text-xs text-faint"
										>{t('integrationen.kraken.balanceOn', {
											date: formatDate(account.balanceOn)
										})}</span
									>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<label class="mt-4 block text-sm text-text">
				{t('integrationen.kraken.fromLabel')}
				<input
					type="date"
					class="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
					max={today}
					bind:value={from}
					data-testid="kraken-from"
				/>
			</label>
			<button
				type="button"
				class="mt-3 rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={syncing}
				onclick={sync}
				data-testid="kraken-sync"
				>{syncing ? t('integrationen.kraken.syncing') : t('integrationen.kraken.sync')}</button
			>
			<p class="mt-1 text-xs text-faint">
				{from ? t('integrationen.kraken.syncHintFrom') : t('integrationen.kraken.syncHint')}
			</p>
		{/if}
		{#if result}
			<p class="mt-3 text-sm text-heading" role="status" data-testid="kraken-result">
				{t('integrationen.counts', result.totals)}
			</p>
			{#if result.transferRefs === 'refused'}
				<p class="mt-2 text-sm text-danger" role="alert" data-testid="kraken-no-hashes">
					{t('integrationen.kraken.noHashes')}
				</p>
			{/if}
			{#if result.unpriced.length}
				<div class="mt-2 text-sm text-danger" role="alert" data-testid="kraken-unpriced">
					{t('integrationen.kraken.unpriced', { count: result.unpriced.length })}
					<ul class="mt-1 list-disc pl-5 text-xs">
						{#each result.unpriced.slice(0, 5) as u (u.refid)}
							<li>{formatDate(u.date)} · {u.asset} · {u.reason}</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
		{#if error}
			<p class="mt-3 text-sm text-danger" role="alert" data-testid="kraken-error">{error}</p>
		{/if}
	</section>
{/if}
