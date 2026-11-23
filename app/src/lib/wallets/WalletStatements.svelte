<script>
	// The "Nachweise" tab of Integrationen → Eigene Wallets (#1019): the
	// monthly statements the wallets give, one card each – Akash's usage
	// statement and act account per Akash wallet, Filecoin Pay – and where the
	// Aleph statements are. Before, they stood between the wallets.
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import AkashStatement from '$lib/akash/AkashStatement.svelte';
	import AkashActAccount from '$lib/akash/AkashActAccount.svelte';
	import FilecoinPayCard from '$lib/filecoin-pay/FilecoinPayCard.svelte';
	import { walletChain } from './chains.js';

	/**
	 * @type {{
	 *   wallets: import('./wallet-sync.js').Wallet[],
	 *   client: ReturnType<typeof import('$lib/bridge/client.js').createBridgeClient>,
	 *   url: string,
	 *   token: string | null,
	 *   paired: boolean,
	 *   colorOf: (chain: string) => string
	 * }}
	 */
	let { wallets, client, url, token, paired, colorOf } = $props();

	const akash = $derived(wallets.filter((w) => w.chain === 'akash'));
</script>

<div class="flex flex-col gap-3" data-testid="wallet-statements">
	<p class="text-sm text-text">{t('integrationen.wallets.statements.intro')}</p>
	{#each akash as wallet (wallet.id)}
		<article
			class="rounded-lg border border-l-4 border-border px-4 py-3"
			style="border-left-color: var(--chart-{colorOf(wallet.chain)})"
			data-testid="wallet-statement"
			data-chain={wallet.chain}
		>
			<h3 class="font-medium text-heading">
				{walletChain(wallet.chain)?.name} · {wallet.name || wallet.address}
			</h3>
			<AkashStatement {wallet} {client} />
			<AkashActAccount {wallet} {client} />
		</article>
	{/each}
	<FilecoinPayCard {url} {token} {paired} />
	<article
		class="rounded-lg border border-l-4 border-border px-4 py-3"
		style="border-left-color: var(--chart-other)"
		data-testid="wallet-statement-aleph"
	>
		<h3 class="font-medium text-heading">{t('integrationen.wallets.statements.alephTitle')}</h3>
		<p class="mt-1 text-sm text-text">{t('integrationen.wallets.statements.alephText')}</p>
		<a
			class="mt-1 inline-block text-sm text-link underline"
			href={resolve('/integrationen/[id]', { id: 'aleph' })}
			>{t('integrationen.wallets.statements.alephLink')}</a
		>
	</article>
</div>
