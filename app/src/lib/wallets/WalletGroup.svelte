<script>
	import { SvelteMap } from 'svelte/reactivity';
	// One chain's wallets on Integrationen → Eigene Wallets (#1019): a header in
	// the chart's colour for the chain (name, how many wallets, a problem, the
	// value, "Kette synchronisieren"), each error once with its way out, and a
	// row per wallet. Folds; while searching it is open.
	import WayOut from '$lib/help/WayOut.svelte';
	import { formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { walletRun } from './sync-run.svelte.js';
	import WalletRow from './WalletRow.svelte';

	/**
	 * @type {{
	 *   group: import('./wallet-groups.js').WalletGroup,
	 *   all: import('./wallet-sync.js').Wallet[],
	 *   name: string,
	 *   color: string,
	 *   value: string | null,
	 *   open: boolean,
	 *   searching: boolean,
	 *   syncable: number,
	 *   ctx: import('./wallet-groups.js').RowContext,
	 *   ontoggle: () => void,
	 *   onsync: () => void
	 * }}
	 * `all`: every wallet of the chain, found or not; `color`: a chart role (s1–s4, other)
	 */
	let { group, all, name, color, value, open, searching, syncable, ctx, ontoggle, onsync } =
		$props();

	const shown = $derived(open || searching);
	const bodyId = $derived(`wallet-group-${group.chain}`);
	/** Each failed sync's message once, with the wallets it is for. */
	const errors = $derived.by(() => {
		/** @type {SvelteMap<string, string[]>} */
		const by = new SvelteMap();
		for (const w of all) {
			const message = walletRun.errors[w.id];
			if (message) by.set(message, [...(by.get(message) ?? []), w.name || w.address]);
		}
		return [...by].map(([message, names]) => ({ message, names }));
	});
</script>

<section
	class="min-w-0 overflow-visible rounded-lg border border-l-4 border-border"
	style="border-left-color: var(--chart-{color})"
	data-testid="wallet-group"
	data-chain={group.chain}
	data-color={color}
	data-open={shown}
>
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-lg bg-surface-2 py-1.5 pr-2 pl-3"
	>
		<button
			type="button"
			class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-heading sm:min-h-8"
			aria-expanded={shown}
			aria-controls={bodyId}
			disabled={searching}
			onclick={ontoggle}
			data-testid="wallet-group-toggle"
		>
			<svg
				viewBox="0 0 16 16"
				class="h-3.5 w-3.5 shrink-0 text-faint transition-transform motion-reduce:transition-none {shown
					? ''
					: '-rotate-90'}"
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"><path d="M3.5 6l4.5 4.5L12.5 6" /></svg
			>
			<span class="font-semibold" data-testid="wallet-group-name">{name}</span>
			<span class="text-xs whitespace-nowrap text-faint" data-testid="wallet-group-count"
				>{searching && group.wallets.length !== group.total
					? t('integrationen.wallets.group.found', {
							found: group.wallets.length,
							count: group.total
						})
					: group.total === 1
						? t('integrationen.wallets.group.countOne')
						: t('integrationen.wallets.group.count', { count: group.total })}</span
			>
			{#if group.errors}
				<span class="text-xs whitespace-nowrap text-danger" data-testid="wallet-group-problem"
					>{t('integrationen.wallets.group.errors', { count: group.errors })}</span
				>
			{:else if group.gaps}
				<span class="text-xs whitespace-nowrap text-warning" data-testid="wallet-group-problem"
					>{t('integrationen.wallets.group.gaps', { count: group.gaps })}</span
				>
			{/if}
			{#if value !== null}
				<span
					class="ml-auto hidden font-mono text-sm whitespace-nowrap tabular-nums sm:inline"
					data-testid="wallet-group-value">{formatMoney(Math.round(Number(value) * 100))}</span
				>
			{/if}
		</button>
		{#if syncable}
			<button
				type="button"
				class="min-h-11 rounded-md border border-border bg-surface px-2.5 text-xs text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8"
				disabled={ctx.busy}
				onclick={onsync}
				aria-label={t('integrationen.wallets.group.syncLabel', { chain: name })}
				data-testid="wallet-group-sync">{t('integrationen.wallets.group.sync')}</button
			>
		{/if}
	</div>
	<div id={bodyId} hidden={!shown}>
		{#each errors as e (e.message)}
			<div
				class="mx-3 mt-2 rounded-md border border-danger/30 px-3 py-2 text-sm"
				role="alert"
				data-testid="wallet-group-error"
			>
				<p class="text-danger">{e.message}</p>
				{#if e.names.length > 1 || group.total > 1}
					<p class="mt-0.5 text-xs text-faint">
						{t('integrationen.wallets.group.errorOf', { names: e.names.join(', ') })}
					</p>
				{/if}
				<WayOut message={e.message} />
			</div>
		{/each}
		<ul data-testid="wallet-group-rows">
			{#each group.wallets as wallet (wallet.id)}
				<WalletRow {wallet} {ctx} />
			{/each}
		</ul>
	</div>
</section>
