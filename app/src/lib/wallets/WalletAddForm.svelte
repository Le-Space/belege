<script>
	// "+ Wallet hinzufügen" on Integrationen → Eigene Wallets: chain, address
	// (read only, never a key), name, ledger account and cost centre, the
	// endpoints it will be read from. Moved out of WalletsCard (#1019) as it was.
	import WayOut from '$lib/help/WayOut.svelte';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { WALLET_CHAINS, looksLikeAddress, walletChain } from './chains.js';
	import { addWallet } from './wallet-sync.js';
	import { cleanChart } from '$lib/booking/chart.js';
	import { suggestWalletLedger, walletLedgerCandidates } from '$lib/booking/ledger-match.js';
	import { endpointLabel } from './wallet-groups.js';
	import WalletMetaFields from './WalletMetaFields.svelte';

	/**
	 * @type {{
	 *   wallets: import('./wallet-sync.js').Wallet[],
	 *   chains: import('$lib/bridge/client.js').ChainInfo[],
	 *   alchemy: boolean | null,
	 *   client: ReturnType<typeof import('$lib/bridge/client.js').createBridgeClient>,
	 *   open: boolean,
	 *   loadError?: string | null,
	 *   proposed?: { chain?: string, address?: string } | null,
	 *   onadded: () => Promise<void>
	 * }}
	 * `proposed`: a wallet offered from a payment (proposal.svelte.js), taken by the card
	 */
	let {
		wallets,
		chains,
		alchemy,
		client,
		open = $bindable(),
		loadError = null,
		proposed = null,
		onadded
	} = $props();

	// A wallet offered from a payment: the form opens with its chain and
	// address; nothing is added before the person presses the button.
	const proposedChain = walletChain(proposed?.chain);
	let chainId = $state(proposedChain?.id ?? 'nyx');
	let address = $state(proposedChain ? (proposed?.address ?? '') : '');
	let newName = $state('');
	let newLedger = $state('');
	let newCostCentre = $state('');
	/** @type {Record<string, string>} */
	let custom = $state({});
	let adding = $state(false);
	/** @type {string | null} */
	let addError = $state(null);
	const shownError = $derived(addError ?? loadError);

	const info = $derived(chains.find((c) => c.id === chainId) ?? null);
	const localChain = $derived(walletChain(chainId));

	// A ledger account for the wallet being added (booking/ledger-match.js): the
	// chart account that names it or its chain, else the next free number beside
	// the other wallets'. Filled in while the person has not typed one of their own.
	const ledgerAsk = $derived({
		name: newName,
		address,
		chain: localChain,
		wallets,
		accounts: app.accounts,
		chart: cleanChart(app.chart)
	});
	const ledgerSuggestion = $derived.by(() => (open ? suggestWalletLedger(ledgerAsk) : null));
	// Several accounts of the chart fit: none is picked, they are offered.
	const ledgerCandidates = $derived.by(() =>
		open && !ledgerSuggestion ? walletLedgerCandidates(ledgerAsk) : []
	);
	/** The number the form filled in by itself, to tell it from one that was typed. */
	let autoLedger = $state('');
	$effect(() => {
		const offered = ledgerSuggestion?.number ?? '';
		if (newLedger === autoLedger && newLedger !== offered) {
			newLedger = offered;
			autoLedger = offered;
		}
	});

	/**
	 * Alchemy reads a new wallet of this chain unless an own API endpoint is
	 * given: then the field is that own endpoint, not Blockscout.
	 *
	 * @param {string} name
	 */
	const alchemyField = (name) => Boolean(alchemy && info?.alchemySupported && name === 'api');

	/** @type {string | null} */
	let bitcoinNote = $state(null);

	/** Bitcoin: the key is in the bridge; the app takes only its fingerprint. */
	async function takeBitcoinKey() {
		bitcoinNote = null;
		try {
			const { configured, fingerprint } = await client.bitcoinKey();
			if (configured && fingerprint) address = fingerprint;
			else bitcoinNote = t('integrationen.wallets.bitcoinNoKey');
		} catch (e) {
			bitcoinNote = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {SubmitEvent} event */
	async function add(event) {
		event.preventDefault();
		const store = currentStore();
		if (!store || !localChain) return;
		addError = null;
		if (!looksLikeAddress(localChain, address)) {
			addError = t('integrationen.wallets.badAddress', { chain: localChain.name });
			return;
		}
		adding = true;
		try {
			await addWallet(store.settings, {
				chain: chainId,
				address,
				endpoints: custom,
				name: newName,
				ledgerAccount: newLedger,
				costCentre: newCostCentre
			});
			await onadded();
			open = false;
			address = '';
			custom = {};
			newName = '';
			newLedger = '';
			autoLedger = '';
			newCostCentre = '';
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}
</script>

<form
	class="mt-4 flex flex-col gap-2 text-sm {wallets.length ? 'border-b border-border pb-4' : ''}"
	onsubmit={add}
	data-testid="wallet-add"
>
	<h3 class="font-medium text-heading">{t('integrationen.wallets.addTitle')}</h3>
	<label class="flex flex-wrap items-center gap-2">
		{t('integrationen.wallets.chain')}
		<select
			class="rounded-md border border-border bg-surface px-2 py-1 text-heading"
			bind:value={chainId}
			onchange={() => (custom = {})}
			data-testid="wallet-chain"
		>
			{#each Object.values(WALLET_CHAINS) as c (c.id)}
				<option value={c.id}>{c.name}</option>
			{/each}
		</select>
	</label>
	{#if localChain?.kind === 'bitcoin'}
		<div class="flex flex-col gap-1" data-testid="wallet-bitcoin-key">
			<p class="text-xs text-faint">{t('integrationen.wallets.bitcoinHint')}</p>
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2"
					onclick={takeBitcoinKey}
					data-testid="wallet-bitcoin-take">{t('integrationen.wallets.bitcoinTake')}</button
				>
				{#if address}<span class="font-mono text-heading">{address}</span>{/if}
			</div>
			{#if bitcoinNote}<p class="text-xs text-danger" role="alert">{bitcoinNote}</p>{/if}
		</div>
	{:else}
		<label class="flex flex-col gap-1">
			{t('integrationen.wallets.address')}
			<input
				class="rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading"
				bind:value={address}
				autocomplete="off"
				spellcheck="false"
				placeholder={localChain?.kind === 'evm'
					? '0x…'
					: localChain?.kind === 'filecoin'
						? 'f1… · f410f… · 0x…'
						: localChain?.kind === 'monero'
							? '4… · 8…'
							: localChain?.kind === 'near'
								? 'name.near'
								: `${localChain?.bech32Prefix ?? ''}1…`}
				data-testid="wallet-address-input"
			/>
		</label>
		<p class="text-xs text-faint">
			{localChain?.kind === 'monero'
				? t('integrationen.wallets.moneroHint')
				: t('integrationen.wallets.addressHint')}
		</p>
	{/if}
	<WalletMetaFields
		bind:name={newName}
		bind:ledger={newLedger}
		bind:cost={newCostCentre}
		id="wallet-new"
	/>
	{#if ledgerSuggestion && newLedger === ledgerSuggestion.number}
		<p class="text-xs text-text" data-testid="wallet-new-ledger-suggestion">
			{ledgerSuggestion.source === 'chart'
				? t('integrationen.wallets.meta.ledgerFromChart', {
						account: ledgerSuggestion.number,
						name: ledgerSuggestion.name
					})
				: t('integrationen.wallets.meta.ledgerNext', { account: ledgerSuggestion.number })}
		</p>
	{/if}
	{#if ledgerCandidates.length && !newLedger.trim()}
		<p
			class="flex flex-wrap items-center gap-1.5 text-xs text-text"
			data-testid="wallet-new-ledger-candidates"
		>
			{t('integrationen.wallets.meta.ledgerCandidates')}
			{#each ledgerCandidates as c (c.number)}
				<button
					type="button"
					class="rounded-md border border-border px-2 py-0.5 hover:bg-surface-2 hover:text-heading"
					onclick={() => (newLedger = c.number)}
					data-testid="wallet-new-ledger-candidate"
					data-number={c.number}>{c.number} {c.name}</button
				>
			{/each}
		</p>
	{:else if !ledgerSuggestion && !newLedger.trim() && address.trim()}
		<p class="text-xs text-faint" data-testid="wallet-new-ledger-none">
			{t(
				ledgerAsk.chart
					? 'integrationen.wallets.meta.ledgerNoneInChart'
					: 'integrationen.wallets.meta.ledgerNoneNoChart'
			)}
		</p>
	{/if}
	{#if info}
		<div class="rounded-md border border-border bg-surface-2 px-3 py-2" data-testid="wallet-uses">
			<p class="text-xs font-semibold text-heading">{t('integrationen.wallets.uses')}</p>
			{#each Object.entries(info.endpoints) as [name, fallback] (name)}
				<label class="mt-1 flex flex-col gap-0.5 text-xs">
					<span
						>{alchemyField(name)
							? t('integrationen.wallets.endpoint.apiOwn')
							: `${endpointLabel(name, localChain?.kind)} (${t('integrationen.wallets.customHint')})`}</span
					>
					<input
						class="rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading"
						value={custom[name] ?? ''}
						oninput={(e) => (custom = { ...custom, [name]: e.currentTarget.value })}
						placeholder={alchemyField(name) ? 'https://…' : fallback}
						data-testid={`wallet-endpoint-${name}`}
					/>
				</label>
				{#if info.alternatives?.[name]?.length}
					<p class="text-xs text-faint">
						{t('integrationen.wallets.alternatives', {
							list: info.alternatives[name].join(', ')
						})}
					</p>
				{/if}
			{/each}
			{#if alchemy && info.alchemySupported}
				<p class="mt-1 text-xs" data-testid="wallet-uses-alchemy">
					{t('integrationen.wallets.source.customReplaces')}
				</p>
			{/if}
			<p class="mt-1 text-xs">
				{t('integrationen.wallets.explorer', { name: info.explorer.name })}
			</p>
		</div>
	{/if}
	<button
		type="submit"
		class="self-start rounded-md border border-border px-4 py-1.5 font-medium text-heading hover:bg-surface-2 disabled:opacity-50"
		disabled={adding || !address.trim()}
		data-testid="wallet-add-button">{t('integrationen.wallets.add')}</button
	>
	{#if wallets.length}
		<button
			type="button"
			class="self-start text-sm text-text underline hover:text-heading"
			onclick={() => (open = false)}
			data-testid="wallet-add-cancel">{t('integrationen.wallets.addCancel')}</button
		>
	{/if}
	{#if shownError}
		<p class="text-sm text-danger" role="alert" data-testid="wallet-add-error">{shownError}</p>
		<WayOut message={shownError} />
	{/if}
</form>
