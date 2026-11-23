<script>
	// What a wallet's row opens (#1019): its full address, where it is read
	// (Alchemy, or each endpoint with the service it is), its ledger account and
	// cost centre, every asset account with the exact balance and the balance
	// check, the last sync and the full error with its way out.
	import WayOut from '$lib/help/WayOut.svelte';
	import { formatDate } from '$lib/bank/format.js';
	import { formatQuantity } from '$lib/assets/quantity.js';
	import { t } from '$lib/i18n/index.js';

	/**
	 * @type {{
	 *   wallet: import('./wallet-sync.js').Wallet,
	 *   open: boolean,
	 *   id: string,
	 *   alchemy: boolean,
	 *   alchemyInternal: boolean,
	 *   endpoints: { name: string, label: string, url: string, own: boolean }[],
	 *   accounts: { account: Record<string, any>, balance: string, gap: { booked: bigint, gap: bigint } | null }[],
	 *   error?: string
	 * }}
	 * `alchemy`: Alchemy reads this wallet; `alchemyInternal`: and its internal transactions too
	 */
	let { wallet, open, id, alchemy, alchemyInternal, endpoints, accounts, error } = $props();
</script>

<dl
	{id}
	class="mx-3 mb-3 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-sm sm:ml-11 sm:grid-cols-[max-content_minmax(0,1fr)]"
	hidden={!open}
	data-testid="wallet-details"
>
	<dt class="text-faint">{t('integrationen.wallets.details.address')}</dt>
	<dd class="font-mono text-xs break-all text-heading">{wallet.address}</dd>

	<dt class="text-faint">{t('integrationen.wallets.details.endpoints')}</dt>
	<dd class="min-w-0">
		<ul class="text-xs text-text" data-testid="wallet-endpoints">
			{#if alchemy}
				<li data-testid="wallet-source">{t('integrationen.wallets.source.wallet')}</li>
			{/if}
			{#each endpoints as e (e.name)}
				{#if !alchemy || !alchemyInternal}
					<li class="break-all">
						{#if alchemy}{t('integrationen.wallets.source.internalVia')} –{/if}
						{e.label}:
						<span class="font-mono">{e.url}</span>
						{e.own ? t('integrationen.wallets.own') : t('integrationen.wallets.default')}
					</li>
				{/if}
			{/each}
		</ul>
	</dd>

	{#if wallet.ledgerAccount || wallet.costCentre}
		<dt class="text-faint">{t('integrationen.wallets.details.booking')}</dt>
		<dd class="text-heading" data-testid="wallet-booking">
			{#if wallet.ledgerAccount}{t('integrationen.wallets.meta.ledgerShort', {
					account: wallet.ledgerAccount
				})}{/if}{#if wallet.ledgerAccount && wallet.costCentre}
				·
			{/if}{#if wallet.costCentre}{t('integrationen.wallets.meta.costCentreShort', {
					costCentre: wallet.costCentre
				})}{/if}
		</dd>
	{/if}

	{#if accounts.length}
		<dt class="text-faint">{t('integrationen.wallets.details.accounts')}</dt>
		<dd class="min-w-0">
			<ul data-testid="wallet-accounts">
				{#each accounts as { account, balance, gap } (account.id)}
					<li class="flex flex-wrap gap-x-3" data-testid="wallet-account">
						<span class="text-heading">{account.name}</span>
						<span class="font-mono text-heading tabular-nums">{balance}</span>
						{#if account.balanceOn}
							<span class="text-xs text-faint"
								>{t('integrationen.kraken.balanceOn', {
									date: formatDate(account.balanceOn)
								})}</span
							>
						{/if}
						{#if gap && gap.gap !== 0n}
							<span class="basis-full text-xs text-warning" data-testid="wallet-balance-gap"
								>{t('integrationen.wallets.balanceGap', {
									booked: formatQuantity(String(gap.booked), account.decimals, account.asset),
									balance
								})}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		</dd>
		<dt class="text-faint">{t('integrationen.wallets.details.check')}</dt>
		<dd class="text-text">
			{#if !accounts.some((a) => a.gap && a.gap.gap !== 0n)}
				{t('integrationen.wallets.details.checkOk')}
			{:else}
				<span class="text-warning">{t('integrationen.wallets.row.gap')}</span>
			{/if}
		</dd>
	{/if}

	{#if wallet.lastSyncedAt}
		<dt class="text-faint">{t('integrationen.wallets.details.lastSync')}</dt>
		<dd class="text-text">
			{t('integrationen.wallets.lastSync', { date: formatDate(wallet.lastSyncedAt.slice(0, 10)) })}
		</dd>
	{/if}

	{#if error}
		<dt class="text-faint">{t('integrationen.wallets.details.error')}</dt>
		<dd class="min-w-0">
			<p class="text-danger" data-testid="wallet-error-full">{error}</p>
			<WayOut message={error} />
		</dd>
	{/if}
</dl>
