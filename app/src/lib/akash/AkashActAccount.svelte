<script>
	// Akash as a vendor account (issue #305, step 3; act-account.js): on an
	// Akash wallet's card, on request, the ACT topped up, used and left month
	// by month, at cost. Read from the bridge only when opened.
	import { app } from '$lib/session.svelte.js';
	import { formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { actAccount } from './act-account.js';

	/** @type {{ wallet: import('$lib/wallets/wallet-sync.js').Wallet, client: any }} */
	let { wallet, client } = $props();

	let open = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	let chain = $state(
		/** @type {{ deployments: import('$lib/bridge/client.js').AkashDeployment[], actBalance: string } | null} */ (
			null
		)
	);

	let account = $derived(
		chain
			? actAccount({
					address: wallet.address,
					accounts: app.accounts,
					transactions: app.transactions,
					deployments: chain.deployments,
					actBalance: chain.actBalance,
					untilMonth: new Date().toISOString().slice(0, 7)
				})
			: null
	);
	/** @param {string} d */
	const act = (d) => String(d).replace('.', ',');
	/** @param {number} cents */
	const eur = (cents) => formatMoney(cents, 'EUR');

	async function show() {
		open = !open;
		if (!open || chain || !client) return;
		busy = true;
		error = null;
		try {
			chain = await client.akashDeployments({
				address: wallet.address,
				endpoints: wallet.endpoints ?? {}
			});
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="akash-act">
	<button
		type="button"
		class="font-medium text-heading underline"
		onclick={show}
		aria-expanded={open}
		disabled={!client}
		data-testid="akash-act-open">{t('akash.act.open')}</button
	>
	{#if open}
		<p class="mt-0.5 text-xs text-faint">{t('akash.act.what')}</p>
		{#if busy}
			<p class="mt-1 text-faint">{t('akash.act.loading')}</p>
		{:else if account && account.months.length}
			<p class="mt-2 text-text" data-testid="akash-act-summary">
				{t('akash.act.summary', {
					minted: act(account.minted),
					cost: eur(account.costCents),
					perAct: account.perActCents === null ? '—' : eur(Math.round(account.perActCents)),
					used: act(account.used),
					usedCost: eur(account.usedCents),
					held: act(account.held),
					escrow: act(account.escrow),
					left: eur(account.leftCents)
				})}
			</p>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full text-xs" data-testid="akash-act-table">
					<thead class="text-faint">
						<tr>
							<th class="py-1 text-left font-medium">{t('akash.act.month')}</th>
							<th class="py-1 text-right font-medium">{t('akash.act.minted')}</th>
							<th class="py-1 text-right font-medium">{t('akash.act.used')}</th>
							<th class="py-1 text-right font-medium">{t('akash.act.balance')}</th>
							<th class="py-1 text-right font-medium">{t('akash.act.cost')}</th>
							<th class="py-1 text-right font-medium">{t('akash.act.usedCost')}</th>
						</tr>
					</thead>
					<tbody class="font-mono text-heading tabular-nums">
						{#each account.months as m (m.month)}
							<tr class="border-t border-border" data-testid="akash-act-month">
								<td class="py-1 font-sans">{m.month}</td>
								<td class="py-1 text-right">{act(m.minted)}</td>
								<td class="py-1 text-right">{act(m.used)}</td>
								<td class="py-1 text-right">{act(m.balance)}</td>
								<td class="py-1 text-right">{m.costCents ? eur(m.costCents) : ''}</td>
								<td class="py-1 text-right">{eur(m.usedCents)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if account.derived}
				<p class="mt-1 text-xs text-faint" data-testid="akash-act-derived">
					{t('akash.act.derived')}
				</p>
			{/if}
			<p class="mt-1 text-xs text-faint">{t('akash.act.booking')}</p>
		{:else if account}
			<p class="mt-1 text-faint">{t('akash.act.none')}</p>
		{/if}
		{#if error}<p class="mt-1 text-danger" role="alert">{error}</p>{/if}
	{/if}
</div>
