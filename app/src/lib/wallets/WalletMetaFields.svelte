<script>
	// A wallet's name, ledger accounts and cost centre: the same fields when it
	// is added and when it is changed (WalletAddForm, WalletRow). One ledger
	// account per asset: `assets` gives a field for each, bound in `ledgers`;
	// without `assets`, one field (`ledger`) for the asset `asset`.
	import { t } from '$lib/i18n/index.js';

	/**
	 * @type {{
	 *   name: string,
	 *   ledger?: string,
	 *   ledgers?: Record<string, string>,
	 *   assets?: string[],
	 *   asset?: string,
	 *   cost: string,
	 *   id: string
	 * }} `id`: the prefix of the test ids
	 */
	let {
		name = $bindable(),
		ledger = $bindable(''),
		ledgers = $bindable({}),
		assets = [],
		asset = '',
		cost = $bindable(),
		id
	} = $props();

	// Two assets on one number: said here, the save is not held up.
	const shared = $derived.by(() => {
		/** @type {Record<string, string[]>} */
		const byNumber = {};
		for (const a of assets) {
			const number = String(ledgers[a] ?? '').trim();
			if (number) byNumber[number] = [...(byNumber[number] ?? []), a];
		}
		return Object.entries(byNumber).filter(([, list]) => list.length > 1);
	});
	const field = 'rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading';
</script>

<label class="flex flex-col gap-1">
	{t('integrationen.wallets.meta.name')}
	<input
		class="rounded-md border border-border bg-surface px-2 py-1 text-heading"
		bind:value={name}
		maxlength="60"
		placeholder={t('integrationen.wallets.meta.namePlaceholder')}
		data-testid={`${id}-name`}
	/>
</label>
<div class="flex flex-wrap gap-3">
	{#if assets.length}
		{#each assets as a (a)}
			<label class="flex flex-col gap-1">
				{t('integrationen.wallets.meta.ledgerFor', { asset: a })}
				<input
					class="w-32 {field}"
					bind:value={ledgers[a]}
					inputmode="numeric"
					data-testid={`${id}-ledger`}
					data-asset={a}
				/>
			</label>
		{/each}
	{:else}
		<label class="flex flex-col gap-1">
			{asset
				? t('integrationen.wallets.meta.ledgerFor', { asset })
				: t('integrationen.wallets.meta.ledger')}
			<input
				class="w-32 {field}"
				bind:value={ledger}
				inputmode="numeric"
				data-testid={`${id}-ledger`}
				data-asset={asset}
			/>
		</label>
	{/if}
	<label class="flex flex-col gap-1">
		{t('integrationen.wallets.meta.costCentre')}
		<input class="w-40 {field}" bind:value={cost} maxlength="36" data-testid={`${id}-cost`} />
	</label>
</div>
{#each shared as [number, list] (number)}
	<p class="text-xs text-danger" role="alert" data-testid={`${id}-ledger-shared`}>
		{t('integrationen.wallets.meta.ledgerShared', { assets: list.join(', '), number })}
	</p>
{/each}
<p class="text-xs text-faint">
	{assets.length || !asset
		? t('integrationen.wallets.meta.hint')
		: t('integrationen.wallets.meta.hintNew', { asset })}
</p>
