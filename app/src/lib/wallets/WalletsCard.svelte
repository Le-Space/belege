<script>
	// Integrationen → Eigene Wallets: add a wallet by chain and address (read
	// only, never a key), see which node and explorer are used, synchronise
	// it (wallet-sync.js), take it off the list again.
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { formatDate } from '$lib/bank/format.js';
	import { formatQuantity, toUnits } from '$lib/assets/quantity.js';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { list, t } from '$lib/i18n/index.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { WALLET_CHAINS, looksLikeAddress, safeExplorerUrl, walletChain } from './chains.js';
	import {
		addWallet,
		loadWallets,
		removeWallet,
		syncWallet,
		updateWalletMeta
	} from './wallet-sync.js';

	/** @type {{ url: string, token: string | null }} */
	let { url, token } = $props();

	const client = $derived(createBridgeClient({ url, token }));

	/** @type {import('$lib/bridge/client.js').ChainInfo[]} */
	let chains = $state([]);
	/** Whether the bridge has an Alchemy key (never the key); null until known. */
	/** @type {boolean | null} */
	let alchemy = $state(null);
	/** @type {import('./wallet-sync.js').Wallet[]} */
	let wallets = $state([]);
	let chainId = $state('nyx');
	let address = $state('');
	let newName = $state('');
	let newLedger = $state('');
	let newCostCentre = $state('');
	/** @type {string | null} the wallet whose name, account and cost centre are open */
	let editing = $state(null);
	let editName = $state('');
	let editLedger = $state('');
	let editCostCentre = $state('');
	/** @type {string | null} */
	let editError = $state(null);
	/** @type {Record<string, string>} */
	let custom = $state({});
	let adding = $state(false);
	/** @type {string | null} */
	let addError = $state(null);
	/** @type {string | null} wallet id */
	let syncing = $state(null);
	/** @type {Record<string, Awaited<ReturnType<typeof syncWallet>>>} */
	let results = $state({});
	/** @type {Record<string, string>} */
	let errors = $state({});

	const info = $derived(chains.find((c) => c.id === chainId) ?? null);
	const localChain = $derived(walletChain(chainId));

	$effect(() => {
		if (!token) return;
		load();
	});

	async function load() {
		const store = currentStore();
		if (store) wallets = await loadWallets(store.settings);
		try {
			const answer = await client.chains();
			chains = answer.chains.filter((c) => walletChain(c.id));
			alchemy = typeof answer.alchemy === 'boolean' ? answer.alchemy : null;
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {string} name */
	const endpointLabel = (name) => t(`integrationen.wallets.endpoint.${name}`);

	/**
	 * Alchemy reads a new wallet of this chain unless an own API endpoint is
	 * given: then the field is that own endpoint, not Blockscout.
	 *
	 * @param {string} name
	 */
	const alchemyField = (name) => Boolean(alchemy && info?.alchemySupported && name === 'api');

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function openEdit(wallet) {
		editing = wallet.id;
		editName = wallet.name ?? '';
		editLedger = wallet.ledgerAccount ?? '';
		editCostCentre = wallet.costCentre ?? '';
		editError = null;
	}

	/** @param {SubmitEvent} event @param {import('./wallet-sync.js').Wallet} wallet */
	async function saveEdit(event, wallet) {
		event.preventDefault();
		const store = currentStore();
		if (!store) return;
		editError = null;
		try {
			await updateWalletMeta(store, wallet.id, {
				name: editName,
				ledgerAccount: editLedger,
				costCentre: editCostCentre
			});
			wallets = await loadWallets(store.settings);
			await refreshNow();
			editing = null;
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function accountsOf(wallet) {
		return app.accounts
			.filter((a) => a.source === wallet.chain && a.walletAddress === wallet.address && !a.deleted)
			.sort((a, b) => (a.name < b.name ? -1 : 1));
	}

	/** @param {Record<string, any>} account */
	function balanceText(account) {
		if (typeof account.balance !== 'string' || !Number.isInteger(account.decimals)) return '';
		try {
			return formatQuantity(
				toUnits(account.balance, account.decimals),
				account.decimals,
				account.asset
			);
		} catch {
			return '';
		}
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function endpointsOf(wallet) {
		const defaults = chains.find((c) => c.id === wallet.chain)?.endpoints ?? {};
		return Object.entries(defaults).map(([name, url]) => ({
			name,
			url: wallet.endpoints?.[name] || url,
			own: Boolean(wallet.endpoints?.[name])
		}));
	}

	/**
	 * Alchemy reads this wallet when there is a key, the chain is one of
	 * Alchemy's and the wallet names no API endpoint of its own.
	 *
	 * @param {import('./wallet-sync.js').Wallet} wallet
	 */
	function readByAlchemy(wallet) {
		const info = chains.find((c) => c.id === wallet.chain);
		return Boolean(alchemy && info?.alchemySupported && !wallet.endpoints?.api);
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function addressLink(wallet) {
		const saved = safeExplorerUrl(wallet.addressUrl);
		if (saved) return saved;
		const pattern = chains.find((c) => c.id === wallet.chain)?.explorer.address;
		return pattern ? safeExplorerUrl(pattern.replace('{address}', wallet.address)) : null;
	}

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
			wallets = await loadWallets(store.settings);
			address = '';
			custom = {};
			newName = '';
			newLedger = '';
			newCostCentre = '';
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	async function sync(wallet) {
		const store = currentStore();
		if (!store) return;
		syncing = wallet.id;
		errors = Object.fromEntries(Object.entries(errors).filter(([id]) => id !== wallet.id));
		let done = false;
		try {
			results = { ...results, [wallet.id]: await syncWallet({ client, store, wallet }) };
			wallets = await loadWallets(store.settings);
			await refreshNow();
			done = true;
		} catch (e) {
			errors = { ...errors, [wallet.id]: e instanceof Error ? e.message : String(e) };
		} finally {
			syncing = null;
		}
		if (done) await runMatchingNow();
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	async function remove(wallet) {
		const store = currentStore();
		if (!store) return;
		await removeWallet(store.settings, wallet.id);
		wallets = await loadWallets(store.settings);
	}
</script>

{#snippet metaFields(
	/** @type {{ name: string, ledger: string, cost: string }} */ v,
	/** @type {string} */ id
)}
	<label class="flex flex-col gap-1">
		{t('integrationen.wallets.meta.name')}
		<input
			class="rounded-md border border-border bg-surface px-2 py-1 text-heading"
			bind:value={v.name}
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
				bind:value={v.ledger}
				inputmode="numeric"
				placeholder="1200"
				data-testid={`${id}-ledger`}
			/>
		</label>
		<label class="flex flex-col gap-1">
			{t('integrationen.wallets.meta.costCentre')}
			<input
				class="w-40 rounded-md border border-border bg-surface px-2 py-1 font-mono text-heading"
				bind:value={v.cost}
				maxlength="36"
				data-testid={`${id}-cost`}
			/>
		</label>
	</div>
	<p class="text-xs text-faint">{t('integrationen.wallets.meta.hint')}</p>
{/snippet}

{#if token}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		aria-labelledby="wallets-h"
		data-testid="wallets-card"
	>
		<h2 id="wallets-h" class="text-lg font-semibold">{t('integrationen.wallets.title')}</h2>
		<p class="mt-2 text-sm text-text">{t('integrationen.wallets.intro')}</p>
		{#if alchemy !== null}
			<div
				class="mt-2 text-sm text-text"
				data-testid="wallets-source"
				data-source={alchemy ? 'alchemy' : 'blockscout'}
			>
				{#if alchemy}
					<p>{t('integrationen.wallets.source.alchemy')}</p>
				{:else}
					<p>{t('integrationen.wallets.source.blockscout')}</p>
					<pre
						class="mt-1 overflow-x-auto rounded bg-surface-2 px-3 py-2 font-mono text-xs text-heading"
						data-testid="wallets-setup-alchemy">pnpm setup:alchemy</pre>
				{/if}
				<TechnicalNote
					class="mt-2"
					testid="wallets-source-technical"
					lines={list(
						alchemy
							? 'integrationen.wallets.source.technicalAlchemy'
							: 'integrationen.wallets.source.technicalBlockscout'
					)}
				/>
			</div>
		{/if}

		{#if wallets.length}
			<ul class="mt-3 divide-y divide-border" data-testid="wallets">
				{#each wallets as wallet (wallet.id)}
					{@const result = results[wallet.id]}
					<li class="py-3" data-testid="wallet" data-chain={wallet.chain}>
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							{#if wallet.name}
								<span class="font-semibold text-heading" data-testid="wallet-name"
									>{wallet.name}</span
								>
							{/if}
							<span class="font-medium text-heading">{walletChain(wallet.chain)?.name}</span>
							<code class="font-mono text-xs break-all text-text" data-testid="wallet-address"
								>{wallet.address}</code
							>
							{#if addressLink(wallet)}
								<a
									href={addressLink(wallet)}
									target="_blank"
									rel="noopener noreferrer"
									class="text-sm underline"
									data-testid="wallet-explorer">{t('integrationen.wallets.addressLink')}</a
								>
							{/if}
						</div>
						<ul class="mt-1 text-xs text-faint" data-testid="wallet-endpoints">
							{#if readByAlchemy(wallet)}
								<li data-testid="wallet-source">{t('integrationen.wallets.source.wallet')}</li>
							{/if}
							{#each endpointsOf(wallet) as e (e.name)}
								{#if !readByAlchemy(wallet) || !chains.find((c) => c.id === wallet.chain)?.alchemyInternal}
									<li>
										{#if readByAlchemy(wallet)}{t('integrationen.wallets.source.internalVia')} –{/if}
										{endpointLabel(e.name)}:
										<span class="font-mono">{e.url}</span>
										{e.own ? t('integrationen.wallets.own') : t('integrationen.wallets.default')}
									</li>
								{/if}
							{/each}
						</ul>
						{#if wallet.ledgerAccount || wallet.costCentre}
							<p class="mt-1 text-xs text-faint" data-testid="wallet-booking">
								{#if wallet.ledgerAccount}{t('integrationen.wallets.meta.ledgerShort', {
										account: wallet.ledgerAccount
									})}{/if}{#if wallet.ledgerAccount && wallet.costCentre}
									·
								{/if}{#if wallet.costCentre}{t('integrationen.wallets.meta.costCentreShort', {
										costCentre: wallet.costCentre
									})}{/if}
							</p>
						{/if}
						{#if wallet.lastSyncedAt}
							<p class="mt-1 text-xs text-faint">
								{t('integrationen.wallets.lastSync', {
									date: formatDate(wallet.lastSyncedAt.slice(0, 10))
								})}
							</p>
						{/if}
						{#if accountsOf(wallet).length}
							<ul class="mt-1 text-sm" data-testid="wallet-accounts">
								{#each accountsOf(wallet) as account (account.id)}
									<li class="flex flex-wrap gap-3" data-testid="wallet-account">
										<span class="text-heading">{account.name}</span>
										<span class="font-mono text-heading tabular-nums">{balanceText(account)}</span>
										{#if account.balanceOn}
											<span class="text-xs text-faint"
												>{t('integrationen.kraken.balanceOn', {
													date: formatDate(account.balanceOn)
												})}</span
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
						<div class="mt-2 flex flex-wrap gap-3">
							<button
								type="button"
								class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={syncing !== null}
								onclick={() => sync(wallet)}
								data-testid="wallet-sync"
								>{syncing === wallet.id
									? t('integrationen.wallets.syncing')
									: t('integrationen.wallets.sync')}</button
							>
							<button
								type="button"
								class="text-sm text-text underline hover:text-heading"
								onclick={() => (editing === wallet.id ? (editing = null) : openEdit(wallet))}
								aria-expanded={editing === wallet.id}
								data-testid="wallet-edit">{t('integrationen.wallets.meta.edit')}</button
							>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								disabled={syncing !== null}
								onclick={() => remove(wallet)}
								data-testid="wallet-remove">{t('integrationen.wallets.remove')}</button
							>
						</div>
						{#if editing === wallet.id}
							<form
								class="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
								onsubmit={(e) => saveEdit(e, wallet)}
								data-testid="wallet-edit-form"
							>
								{@render metaFields(
									{
										get name() {
											return editName;
										},
										set name(v) {
											editName = v;
										},
										get ledger() {
											return editLedger;
										},
										set ledger(v) {
											editLedger = v;
										},
										get cost() {
											return editCostCentre;
										},
										set cost(v) {
											editCostCentre = v;
										}
									},
									'wallet-edit'
								)}
								<div class="flex gap-3">
									<button
										type="submit"
										class="rounded-md border border-border bg-surface px-3 py-1 font-medium text-heading hover:bg-surface-2"
										data-testid="wallet-edit-save">{t('integrationen.wallets.meta.save')}</button
									>
									<button
										type="button"
										class="text-faint underline hover:text-heading"
										onclick={() => (editing = null)}
										>{t('integrationen.wallets.meta.cancel')}</button
									>
								</div>
								{#if editError}
									<p class="text-danger" role="alert" data-testid="wallet-edit-error">
										{editError}
									</p>
								{/if}
							</form>
						{/if}
						{#if result}
							<p class="mt-2 text-sm text-heading" role="status" data-testid="wallet-result">
								{t('integrationen.counts', result.totals)}
							</p>
							{#if result.unpriced.length}
								<p class="mt-1 text-sm text-danger" role="alert" data-testid="wallet-unpriced">
									{t('integrationen.wallets.unpriced', {
										count: result.unpriced.length,
										assets: [...new Set(result.unpriced.map((u) => u.asset))].join(', ')
									})}
								</p>
							{/if}
							{#if result.unknownAssets}
								<p class="mt-1 text-xs text-faint" data-testid="wallet-unknown">
									{t('integrationen.wallets.unknownAssets', { count: result.unknownAssets })}
								</p>
							{/if}
							{#if result.history.pruned}
								<p class="mt-1 text-sm text-danger" role="alert" data-testid="wallet-pruned">
									{t('integrationen.wallets.pruned', {
										date: result.history.earliestTime
											? formatDate(result.history.earliestTime.slice(0, 10))
											: '?'
									})}
								</p>
							{/if}
						{/if}
						{#if errors[wallet.id]}
							<p class="mt-2 text-sm text-danger" role="alert" data-testid="wallet-error">
								{errors[wallet.id]}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form class="mt-4 flex flex-col gap-2 text-sm" onsubmit={add} data-testid="wallet-add">
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
						placeholder={localChain?.kind === 'evm' ? '0x…' : `${localChain?.bech32Prefix ?? ''}1…`}
						data-testid="wallet-address-input"
					/>
				</label>
				<p class="text-xs text-faint">{t('integrationen.wallets.addressHint')}</p>
			{/if}
			{@render metaFields(
				{
					get name() {
						return newName;
					},
					set name(v) {
						newName = v;
					},
					get ledger() {
						return newLedger;
					},
					set ledger(v) {
						newLedger = v;
					},
					get cost() {
						return newCostCentre;
					},
					set cost(v) {
						newCostCentre = v;
					}
				},
				'wallet-new'
			)}
			{#if info}
				<div
					class="rounded-md border border-border bg-surface-2 px-3 py-2"
					data-testid="wallet-uses"
				>
					<p class="text-xs font-semibold text-heading">{t('integrationen.wallets.uses')}</p>
					{#each Object.entries(info.endpoints) as [name, fallback] (name)}
						<label class="mt-1 flex flex-col gap-0.5 text-xs">
							<span
								>{alchemyField(name)
									? t('integrationen.wallets.endpoint.apiOwn')
									: `${endpointLabel(name)} (${t('integrationen.wallets.customHint')})`}</span
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
			{#if addError}
				<p class="text-sm text-danger" role="alert" data-testid="wallet-add-error">{addError}</p>
			{/if}
		</form>
	</section>
{/if}
