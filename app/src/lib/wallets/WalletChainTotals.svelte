<script>
	import { SvelteMap } from 'svelte/reactivity';
	// The "Übersicht" tab under the chart (#1019): per chain, how many wallets,
	// what they hold per asset (the accounts' balances added up, rounded as in
	// the list) and what the chain was worth on the last day with a rate, as
	// the chart has it.
	import { formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { walletChain } from './chains.js';
	import { roundedQuantity } from './wallet-groups.js';

	/**
	 * @type {{
	 *   wallets: import('./wallet-sync.js').Wallet[],
	 *   accounts: Record<string, any>[],
	 *   summary: Map<string, { color: string, value: string | null }>
	 * }}
	 * `accounts`: the wallets' asset accounts; `summary`: per chain, the chart's colour and value
	 */
	let { wallets, accounts, summary } = $props();

	const rows = $derived.by(() => {
		const chains = [...new Set(wallets.map((w) => w.chain))];
		return chains
			.map((chain) => {
				/** @type {SvelteMap<string, { units: bigint, decimals: number, asset: string }>} */
				const held = new SvelteMap();
				for (const a of accounts) {
					if (a.source !== chain || typeof a.balance !== 'string') continue;
					if (!Number.isInteger(a.decimals)) continue;
					const key = `${a.asset}|${a.decimals}`;
					let units = 0n;
					try {
						units = BigInt(a.balance);
					} catch {
						continue;
					}
					const h = held.get(key) ?? { units: 0n, decimals: a.decimals, asset: a.asset };
					h.units += units;
					held.set(key, h);
				}
				return {
					chain,
					name: walletChain(chain)?.name ?? chain,
					count: wallets.filter((w) => w.chain === chain).length,
					color: summary.get(chain)?.color ?? 'other',
					value: summary.get(chain)?.value ?? null,
					holdings: [...held.values()]
						.filter((h) => h.units !== 0n)
						.map((h) => roundedQuantity(h.units.toString(), h.decimals, h.asset))
				};
			})
			.sort(
				(a, b) => Number(b.value ?? -1) - Number(a.value ?? -1) || a.name.localeCompare(b.name)
			);
	});
	const total = $derived(rows.reduce((sum, r) => sum + Number(r.value ?? 0), 0));
	/** @param {number} euros */
	const money = (euros) => formatMoney(Math.round(euros * 100));
</script>

<div class="mt-4" data-testid="wallet-chain-totals">
	<h3 class="font-medium text-heading">{t('integrationen.wallets.overview.perChain')}</h3>
	<div class="mt-2 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-border text-left text-xs text-faint">
					<th class="py-1.5 pr-3 font-medium">{t('integrationen.wallets.overview.chain')}</th>
					<th class="py-1.5 pr-3 text-right font-medium"
						>{t('integrationen.wallets.overview.wallets')}</th
					>
					<th class="py-1.5 pr-3 text-right font-medium"
						>{t('integrationen.wallets.overview.holdings')}</th
					>
					<th class="py-1.5 text-right font-medium">{t('integrationen.wallets.overview.value')}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.chain)}
					<tr
						class="border-b border-border align-top"
						data-testid="wallet-chain-total"
						data-chain={r.chain}
					>
						<td class="py-2 pr-3 text-heading">
							<span class="inline-flex items-center gap-2"
								><span
									class="h-2.5 w-2.5 shrink-0 rounded-sm"
									style="background: var(--chart-{r.color})"
									data-color={r.color}
								></span>{r.name}</span
							>
						</td>
						<td class="py-2 pr-3 text-right tabular-nums">{r.count}</td>
						<td class="py-2 pr-3 text-right font-mono whitespace-nowrap text-heading tabular-nums">
							{#each r.holdings as h (h)}<span class="block">{h}</span>{/each}
						</td>
						<td class="py-2 text-right font-mono whitespace-nowrap text-heading tabular-nums"
							>{r.value === null
								? t('integrationen.wallets.overview.noRate')
								: money(Number(r.value))}</td
						>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="font-semibold text-heading">
					<td class="py-2 pr-3">{t('integrationen.wallets.overview.total')}</td>
					<td class="py-2 pr-3 text-right tabular-nums">{wallets.length}</td>
					<td></td>
					<td class="py-2 text-right font-mono tabular-nums" data-testid="wallet-chain-total-sum"
						>{money(total)}</td
					>
				</tr>
			</tfoot>
		</table>
	</div>
</div>
