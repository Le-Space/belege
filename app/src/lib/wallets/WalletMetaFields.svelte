<script>
	// A wallet's name, ledger account and cost centre: the same fields when it
	// is added and when it is changed (WalletAddForm, WalletRow).
	import { t } from '$lib/i18n/index.js';

	/** @type {{ name: string, ledger: string, cost: string, id: string }} `id`: the prefix of the test ids */
	let { name = $bindable(), ledger = $bindable(), cost = $bindable(), id } = $props();
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
	<label class="flex flex-col gap-1">
		{t('integrationen.wallets.meta.ledger')}
		<input
			class="w-32 rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading"
			bind:value={ledger}
			inputmode="numeric"
			data-testid={`${id}-ledger`}
		/>
	</label>
	<label class="flex flex-col gap-1">
		{t('integrationen.wallets.meta.costCentre')}
		<input
			class="w-40 rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading"
			bind:value={cost}
			maxlength="36"
			data-testid={`${id}-cost`}
		/>
	</label>
</div>
<p class="text-xs text-faint">{t('integrationen.wallets.meta.hint')}</p>
