<script>
	// "Was war diese Zahlung?": what the address of a crypto transfer is to the
	// books – an own wallet (added and read), the person's private address, a
	// vendor's or customer's, or own money at an exchange or custodian Belege
	// does not read (partners.js ADDRESS_KINDS). The answer is kept for the
	// address, so every booking with it is treated the same. An own wallet is
	// offered only where Belege can read one (wallets/suggest.js).
	import { t } from '$lib/i18n/index.js';

	/** @type {('private' | 'vendor' | 'custodian')[]} */
	const SAID = ['private', 'vendor', 'custodian'];

	/**
	 * @type {{
	 *   incoming: boolean,
	 *   ownChains: import('$lib/wallets/chains.js').WalletChain[],
	 *   current: { kind: 'vendor' | 'private' | 'custodian', name: string } | null,
	 *   busy: boolean,
	 *   onown: (chain: string) => void,
	 *   onsave: (kind: 'vendor' | 'private' | 'custodian', name: string) => void,
	 *   onforget: () => void
	 * }}
	 */
	let { incoming, ownChains, current, busy, onown, onsave, onforget } = $props();

	/** @type {'own' | 'private' | 'vendor' | 'custodian'} */
	let kind = $state('vendor');
	let name = $state('');
	// What is remembered, else an own wallet where one can be added, else a vendor.
	$effect(() => {
		kind = current?.kind ?? (ownChains.length ? 'own' : 'vendor');
		name = current?.name ?? '';
	});
	/** @param {'own' | 'private' | 'vendor' | 'custodian'} k */
	function choose(k) {
		kind = k;
		if (k === 'private' && !name.trim()) name = t('zahlungen.detail.addressKind.privateName');
	}
	const label = (/** @type {'private' | 'vendor' | 'custodian'} */ k) =>
		k === 'vendor'
			? t(`zahlungen.detail.addressKind.${incoming ? 'vendorIn' : 'vendorOut'}`)
			: t(`zahlungen.detail.addressKind.${k}`);
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-heading hover:bg-surface disabled:opacity-50';
</script>

<form
	class="mt-2 text-sm"
	onsubmit={(e) => {
		e.preventDefault();
		if (kind !== 'own' && name.trim()) onsave(kind, name);
	}}
	data-testid="tx-address-kind"
	data-current={current?.kind ?? ''}
>
	<fieldset>
		<legend class="font-medium text-heading">
			{t(`zahlungen.detail.addressKind.${incoming ? 'titleIn' : 'titleOut'}`)}
		</legend>
		<p class="text-xs text-faint">{t('zahlungen.detail.addressKind.hint')}</p>
		{#if current}
			<p class="mt-1 text-text" data-testid="tx-address-kind-current">
				{t('zahlungen.detail.addressKind.current', {
					kind: label(current.kind),
					name: current.name
				})}
				<button
					type="button"
					class="ml-1 underline"
					disabled={busy}
					onclick={onforget}
					data-testid="tx-address-kind-forget">{t('zahlungen.detail.addressKind.forget')}</button
				>
			</p>
		{/if}
		<div class="mt-1 flex flex-col gap-1">
			{#if ownChains.length}
				<label class="flex items-start gap-2">
					<input
						type="radio"
						class="mt-1"
						checked={kind === 'own'}
						onchange={() => choose('own')}
						data-testid="tx-address-kind-own"
					/>
					<span>{t(`zahlungen.detail.addressKind.${incoming ? 'ownIn' : 'own'}`)}</span>
				</label>
			{/if}
			{#each SAID as k (k)}
				<label class="flex items-start gap-2">
					<input
						type="radio"
						class="mt-1"
						checked={kind === k}
						onchange={() => choose(k)}
						data-testid="tx-address-kind-{k}"
					/>
					<span>{label(k)}</span>
				</label>
			{/each}
		</div>
	</fieldset>
	{#if kind === 'own'}
		<p class="mt-2 text-text" data-testid="tx-detail-wallet-offer">
			{t('zahlungen.detail.walletOffer')}
		</p>
		<div class="mt-1 flex flex-wrap gap-2">
			{#each ownChains as c (c.id)}
				<button
					type="button"
					class={button}
					disabled={busy}
					onclick={() => onown(c.id)}
					data-testid="tx-detail-wallet-offer-add"
					data-chain={c.id}>{t('zahlungen.detail.walletOfferAdd', { chain: c.name })}</button
				>
			{/each}
		</div>
	{:else}
		<p class="mt-2 text-xs text-faint" data-testid="tx-address-kind-hint">
			{t(`zahlungen.detail.addressKind.${kind}Hint`)}
		</p>
		<div class="mt-1 flex flex-wrap items-end gap-2">
			<label class="flex min-w-48 flex-1 flex-col text-xs text-faint"
				>{t('zahlungen.detail.addressKind.nameLabel')}
				<input
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-heading"
					bind:value={name}
					maxlength="80"
					placeholder={kind === 'custodian'
						? t('zahlungen.detail.addressKind.custodianPlaceholder')
						: kind === 'vendor'
							? t('zahlungen.detail.where.namePlaceholder')
							: ''}
					data-testid="tx-where-name"
				/>
			</label>
			<button
				type="submit"
				class={button}
				disabled={busy || !name.trim()}
				data-testid="tx-where-name-save">{t('zahlungen.detail.addressKind.save')}</button
			>
		</div>
	{/if}
</form>
