<script>
	// Integrationen → Eigene Wallets: add a wallet by chain and address (read
	// only, never a key), synchronise it (wallet-sync.js), take it off the list
	// again. Three tabs (#1019): the wallets grouped by chain in the chart's
	// colours, one row each (WalletGroup, WalletRow); the overview with the
	// value chart and the totals per chain; the monthly statements.
	import { resolve } from '$app/paths';
	import { btn } from '$lib/ui/styles.js';
	import { updateAlerts } from '$lib/integrations/alerts.js';
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { formatQuantity, toUnits } from '$lib/assets/quantity.js';
	import { balanceGap } from './balance-check.js';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { list, t } from '$lib/i18n/index.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import ChartColors from '$lib/charts/ChartColors.svelte';
	import { importedChain, safeExplorerUrl, walletChain } from './chains.js';
	import { importMoneroExport } from './monero-import.js';
	import FilecoinPayCard from '$lib/filecoin-pay/FilecoinPayCard.svelte';
	import { loadWallets, removeWallet, updateWalletMeta } from './wallet-sync.js';
	import { walletList } from './wallet-list.svelte.js';
	import WalletValueChart from './WalletValueChart.svelte';
	import WalletAddForm from './WalletAddForm.svelte';
	import WalletGroup from './WalletGroup.svelte';
	import WalletChainTotals from './WalletChainTotals.svelte';
	import WalletStatements from './WalletStatements.svelte';
	import {
		WALLET_TABS,
		endpointLabel,
		groupWallets,
		rememberTab,
		rememberedTab,
		roundedQuantity,
		walletMatches
	} from './wallet-groups.js';
	import {
		dismissWalletSummary,
		syncable,
		walletSummaryText,
		syncAllWallets,
		syncOneWallet,
		walletRun
	} from './sync-run.svelte.js';
	import { percentOf } from './sync-turn.js';
	import { askToNotify, canNotify } from '$lib/notify.js';
	import { takeWalletProposal } from './proposal.svelte.js';

	/** @type {{ url: string, token: string | null, paired?: boolean }} `paired`: a token, or the bridge's node over the stream (#575) */
	let { url, token, paired = Boolean(token) } = $props();

	const client = $derived(createBridgeClient({ url, token }));

	/** @type {import('$lib/bridge/client.js').ChainInfo[]} */
	let chains = $state([]);
	/** Whether the bridge has an Alchemy key (never the key); null until known. */
	/** @type {boolean | null} */
	let alchemy = $state(null);
	/** @type {import('./wallet-sync.js').Wallet[]} */
	let wallets = $state([]);
	/** @type {string | null} the chains could not be read from the bridge */
	let loadError = $state(null);
	// A wallet offered from a payment (proposal.svelte.js): the form opens with it.
	const offered = takeWalletProposal();
	/** @type {{ chain?: string, address?: string } | null} */
	let proposed = $state(offered);
	/** "+ Wallet hinzufügen": the form, once a wallet exists, only when asked for (issue #152). */
	let showAdd = $state(Boolean(walletChain(offered?.chain)));
	// A sync, one wallet's or all of them, is a run of the app (sync-run.svelte.js):
	// it goes on while the person is elsewhere, and its results are there on return.
	const busy = $derived(walletRun.syncing !== null || walletRun.progress !== null);
	const syncableCount = $derived(wallets.filter(syncable).length);
	// A run that ended while this card was shown or not: the list again (its "zuletzt abgerufen").
	$effect(() => {
		void walletRun.summary;
		void walletRun.syncing;
		const store = currentStore();
		if (store && walletRun.syncing === null) loadWallets(store.settings).then((w) => (wallets = w));
	});

	$effect(() => {
		if (!paired) return;
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
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	async function added() {
		const store = currentStore();
		if (!store) return;
		wallets = await loadWallets(store.settings);
		walletList.changes++;
		proposed = null;
	}

	// ── The tabs: which one this browser showed last (a UI preference, no book data).
	let tab = $state(rememberedTab());
	/** @param {(typeof WALLET_TABS)[number]} next */
	function choose(next) {
		tab = next;
		rememberTab(next);
	}
	/** @param {KeyboardEvent} event */
	function tabKey(event) {
		const i = WALLET_TABS.indexOf(tab);
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		let next = i;
		if (step) next = (i + step + WALLET_TABS.length) % WALLET_TABS.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = WALLET_TABS.length - 1;
		else return;
		event.preventDefault();
		choose(WALLET_TABS[next]);
		document.getElementById(`wallets-tab-${WALLET_TABS[next]}`)?.focus();
	}

	// ── What every row needs: the chain's endpoints and explorer, the accounts, a problem.
	/** @param {import('./wallet-sync.js').Wallet} wallet */
	const infoOf = (wallet) => chains.find((c) => c.id === wallet.chain);

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
	/** @param {Record<string, any>} account */
	function roundedText(account) {
		if (typeof account.balance !== 'string' || !Number.isInteger(account.decimals)) return '';
		try {
			return roundedQuantity(
				toUnits(account.balance, account.decimals),
				account.decimals,
				account.asset
			);
		} catch {
			return '';
		}
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function accountsOf(wallet) {
		return app.accounts
			.filter((a) => a.source === wallet.chain && a.walletAddress === wallet.address && !a.deleted)
			.sort((a, b) => (a.name < b.name ? -1 : 1))
			.map((account) => ({
				account,
				balance: balanceText(account),
				rounded: roundedText(account),
				gap: balanceGap(account, app.transactions)
			}));
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet @returns {import('./wallet-groups.js').WalletProblem} */
	function problemOf(wallet) {
		if (walletRun.errors[wallet.id]) return 'error';
		return accountsOf(wallet).some((a) => a.gap && a.gap.gap !== 0n) ? 'gap' : null;
	}

	/**
	 * Alchemy reads this wallet when there is a key, the chain is one of
	 * Alchemy's and the wallet names no API endpoint of its own.
	 *
	 * @param {import('./wallet-sync.js').Wallet} wallet
	 */
	const readByAlchemy = (wallet) =>
		Boolean(alchemy && infoOf(wallet)?.alchemySupported && !wallet.endpoints?.api);

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function endpointsOf(wallet) {
		const defaults = infoOf(wallet)?.endpoints ?? {};
		const kind = walletChain(wallet.chain)?.kind;
		return Object.entries(defaults)
			.map(([name, fallback]) => ({
				name,
				label: endpointLabel(name, kind),
				url: wallet.endpoints?.[name] || fallback,
				own: Boolean(wallet.endpoints?.[name])
			}))
			.filter((e) => e.url); // an endpoint without a default (an archive node) only when named
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	function addressLink(wallet) {
		const saved = safeExplorerUrl(wallet.addressUrl);
		if (saved) return saved;
		const pattern = infoOf(wallet)?.explorer.address;
		return pattern ? safeExplorerUrl(pattern.replace('{address}', wallet.address)) : null;
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	async function sync(wallet) {
		await syncOneWallet(wallet, { client });
	}

	/** @param {NonNullable<typeof walletRun.summary>} s */
	const summaryText = (s) => walletSummaryText(s);
	// What a sync took out because another entry replaced it is in the Verlauf (#967).
	const verlaufAbruf = `${resolve('/verlauf')}?group=abruf`;

	/** "Alle Wallets synchronisieren": the permission for a notification is asked on this click. */
	async function syncAll() {
		if (canNotify()) await askToNotify();
		await syncAllWallets({ client });
	}

	/** "Kette synchronisieren": the same turn over one chain's wallets. @param {string} chain */
	async function syncChain(chain) {
		if (canNotify()) await askToNotify();
		await syncAllWallets({ client, chain });
	}

	/**
	 * Monero: the wallet's exported history, read here (monero-import.js).
	 *
	 * @param {import('./wallet-sync.js').Wallet} wallet
	 * @param {File | undefined} file
	 */
	async function importHistory(wallet, file) {
		const store = currentStore();
		if (!store || !file) return;
		walletRun.syncing = wallet.id;
		walletRun.errors = Object.fromEntries(
			Object.entries(walletRun.errors).filter(([id]) => id !== wallet.id)
		);
		let done = false;
		try {
			const result = await importMoneroExport({ client, store, wallet, text: await file.text() });
			walletRun.results = { ...walletRun.results, [wallet.id]: result };
			await updateAlerts(store.settings, (a) => ({
				...a,
				wallets: { ...a.wallets, [wallet.id]: result.unpriced.length }
			}));
			wallets = await loadWallets(store.settings);
			await refreshNow();
			done = true;
		} catch (e) {
			walletRun.errors = {
				...walletRun.errors,
				[wallet.id]: e instanceof Error ? e.message : String(e)
			};
		} finally {
			walletRun.syncing = null;
		}
		if (done) await runMatchingNow();
	}

	/** @param {import('./wallet-sync.js').Wallet} wallet */
	async function remove(wallet) {
		const store = currentStore();
		if (!store) return;
		await removeWallet(store.settings, wallet.id);
		wallets = await loadWallets(store.settings);
		walletList.changes++;
	}

	/**
	 * @param {import('./wallet-sync.js').Wallet} wallet
	 * @param {{ name: string, ledgerAccounts: Record<string, string>, costCentre: string }} meta
	 */
	async function saveMeta(wallet, meta) {
		const store = currentStore();
		if (!store) return;
		await updateWalletMeta(store, wallet.id, meta);
		wallets = await loadWallets(store.settings);
		await refreshNow();
	}

	/** @type {import('./wallet-groups.js').RowContext} */
	const ctx = {
		get busy() {
			return busy;
		},
		verlaufAbruf,
		imported: (w) => Boolean(importedChain(walletChain(w.chain))),
		readByAlchemy,
		alchemyInternal: (w) => Boolean(infoOf(w)?.alchemyInternal),
		endpointsOf,
		addressLink,
		explorerName: (w) => infoOf(w)?.explorer.name ?? '',
		accountsOf,
		problemOf,
		sync,
		importHistory,
		remove,
		saveMeta
	};

	// ── The groups: one per chain, in the chart's colour and order; the search narrows them.
	/** @type {Map<string, { color: string, value: string | null }>} */
	let summary = $state(new Map());
	let query = $state('');
	/** @type {Record<string, boolean>} folded or open, per chain, as the person left it */
	let opened = $state({});
	// On a phone the groups start folded: the chains are the overview there.
	const narrow =
		typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches === true;
	/** @param {string} chain */
	const isOpen = (chain) => opened[chain] ?? !narrow;
	/** @param {string} chain */
	const chainName = (chain) => walletChain(chain)?.name ?? chain;
	const groups = $derived(
		groupWallets({
			wallets,
			problem: problemOf,
			values: new Map([...summary].map(([c, s]) => [c, s.value])),
			name: chainName,
			found: (w) =>
				walletMatches(query, {
					name: w.name,
					address: w.address,
					chainName: chainName(w.chain),
					assets: accountsOf(w).map((a) => String(a.account.asset ?? ''))
				})
		})
	);
	const problemChains = $derived(
		groupWallets({ wallets, problem: problemOf }).filter((g) => g.errors || g.gaps).length
	);
	/** @param {string} chain */
	const colorOf = (chain) => summary.get(chain)?.color ?? 'other';
	/** @param {boolean} open */
	function foldAll(open) {
		opened = Object.fromEntries(wallets.map((w) => [w.chain, open]));
	}
	const walletAccounts = $derived(
		app.accounts.filter(
			(a) =>
				!a.deleted && wallets.some((w) => w.chain === a.source && w.address === a.walletAddress)
		)
	);
	const tabClass = (/** @type {string} */ name) =>
		`-mb-px min-h-11 border-b-2 px-3 text-sm font-medium whitespace-nowrap ${
			tab === name
				? 'border-coral-700 text-heading'
				: 'border-transparent text-text hover:text-heading'
		}`;
</script>

{#if paired}
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

		<!-- Adding comes first: with many wallets, a form below the list is not found. -->
		<div class="mt-4 flex flex-wrap items-center gap-2">
			{#if wallets.length && !showAdd}
				<button
					type="button"
					class={btn.secondary}
					onclick={() => (showAdd = true)}
					data-testid="wallet-add-open">+ {t('integrationen.wallets.addTitle')}</button
				>
			{/if}
			{#if syncableCount > 1}
				<!-- All wallets, one after the other; it goes on while you are elsewhere in Belege. -->
				<button
					type="button"
					class={btn.primary}
					disabled={busy}
					onclick={syncAll}
					data-testid="wallets-sync-all"
					>{t('integrationen.wallets.all.button', { count: syncableCount })}</button
				>
			{/if}
		</div>
		{#if !wallets.length || showAdd}
			<WalletAddForm
				{wallets}
				{chains}
				{alchemy}
				{client}
				{loadError}
				{proposed}
				bind:open={showAdd}
				onadded={added}
			/>
		{/if}

		{#if syncableCount > 1}
			<div data-testid="wallets-sync-all-row">
				{#if walletRun.progress}
					<div class="mt-3" role="status" data-testid="wallets-sync-progress">
						<progress
							class="h-2 w-full max-w-md"
							max="100"
							value={percentOf(walletRun.progress)}
							aria-label={t('integrationen.wallets.all.progressLabel')}
						></progress>
						<p class="mt-1 text-sm text-text tabular-nums">
							{t('integrationen.wallets.all.progress', {
								done: walletRun.progress.done,
								count: walletRun.progress.count,
								percent: percentOf(walletRun.progress)
							})}{walletRun.progress.current ? ` · ${walletRun.progress.current}` : ''}
						</p>
						<p class="mt-1 text-xs text-faint">{t('integrationen.wallets.all.goesOn')}</p>
					</div>
				{:else if walletRun.summary}
					<div class="mt-3 text-sm" role="status" data-testid="wallets-sync-summary">
						<span class="text-heading">{summaryText(walletRun.summary)}</span>
						{#if walletRun.summary.superseded}
							<span class="text-heading">·</span>
							<a
								class="text-heading underline"
								href={verlaufAbruf}
								title={t('integrationen.wallets.supersededTitle')}
								data-testid="wallets-sync-summary-superseded"
								>{t('integrationen.wallets.all.summarySuperseded', {
									count: walletRun.summary.superseded
								})}</a
							>
						{/if}
						<button
							type="button"
							class="ml-2 text-xs text-faint underline hover:text-heading"
							onclick={dismissWalletSummary}
							data-testid="wallets-sync-summary-close"
							>{t('integrationen.wallets.all.close')}</button
						>
					</div>
				{/if}
			</div>
		{/if}

		{#if wallets.length}
			<ChartColors class="mt-4">
				<div
					class="flex gap-1 overflow-x-auto border-b border-border"
					role="tablist"
					aria-label={t('integrationen.wallets.tabs.label')}
					tabindex="-1"
					onkeydown={tabKey}
				>
					{#each WALLET_TABS as name (name)}
						<button
							type="button"
							role="tab"
							id={`wallets-tab-${name}`}
							aria-selected={tab === name}
							aria-controls={`wallets-panel-${name}`}
							tabindex={tab === name ? 0 : -1}
							class={tabClass(name)}
							onclick={() => choose(name)}
							data-testid={`wallets-tab-${name}`}
							>{t(`integrationen.wallets.tabs.${name}`)}{#if name === 'wallets'}<span
									class="ml-1 font-normal text-faint tabular-nums">{wallets.length}</span
								>{#if problemChains}<span
										class="ml-1.5 inline-block h-2 w-2 rounded-full bg-warning align-middle"
										title={t('integrationen.wallets.tabs.problems', { count: problemChains })}
										><span class="sr-only"
											>{t('integrationen.wallets.tabs.problems', { count: problemChains })}</span
										></span
									>{/if}{/if}</button
						>
					{/each}
				</div>

				<!-- Every panel stays mounted: the chart keeps asking for rates, the statements their months. -->
				<div
					role="tabpanel"
					id="wallets-panel-wallets"
					aria-labelledby="wallets-tab-wallets"
					hidden={tab !== 'wallets'}
					data-testid="wallets-panel-wallets"
				>
					<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
						<input
							type="search"
							class="min-h-11 min-w-0 flex-[1_1_14rem] rounded-md border border-border bg-surface px-3 text-sm text-heading sm:min-h-9"
							placeholder={t('integrationen.wallets.search.placeholder')}
							aria-label={t('integrationen.wallets.search.label')}
							bind:value={query}
							data-testid="wallets-search"
						/>
						<button
							type="button"
							class="text-sm text-text underline hover:text-heading"
							onclick={() => foldAll(true)}
							data-testid="wallets-expand-all">{t('integrationen.wallets.search.expandAll')}</button
						>
						<button
							type="button"
							class="text-sm text-text underline hover:text-heading"
							onclick={() => foldAll(false)}
							data-testid="wallets-collapse-all"
							>{t('integrationen.wallets.search.collapseAll')}</button
						>
					</div>
					<div class="mt-3 flex flex-col gap-2.5" data-testid="wallet-groups">
						{#each groups as group (group.chain)}
							<WalletGroup
								{group}
								all={wallets.filter((w) => w.chain === group.chain)}
								name={chainName(group.chain)}
								color={colorOf(group.chain)}
								value={summary.get(group.chain)?.value ?? null}
								open={isOpen(group.chain)}
								searching={Boolean(query.trim())}
								syncable={wallets.filter((w) => w.chain === group.chain && syncable(w)).length}
								{ctx}
								ontoggle={() => (opened = { ...opened, [group.chain]: !isOpen(group.chain) })}
								onsync={() => syncChain(group.chain)}
							/>
						{:else}
							<p class="py-4 text-center text-sm text-faint" data-testid="wallets-search-none">
								{t('integrationen.wallets.search.none', { query: query.trim() })}
							</p>
						{/each}
					</div>
				</div>

				<div
					role="tabpanel"
					id="wallets-panel-overview"
					aria-labelledby="wallets-tab-overview"
					hidden={tab !== 'overview'}
					data-testid="wallets-panel-overview"
				>
					<!-- What the wallets were worth, day by day (#908). -->
					<WalletValueChart {wallets} {client} {busy} onsummary={(s) => (summary = s)} />
					<WalletChainTotals {wallets} accounts={walletAccounts} {summary} />
				</div>

				<div
					role="tabpanel"
					id="wallets-panel-statements"
					aria-labelledby="wallets-tab-statements"
					hidden={tab !== 'statements'}
					class="mt-3"
					data-testid="wallets-panel-statements"
				>
					<WalletStatements {wallets} {client} {url} {token} {paired} {colorOf} />
				</div>
			</ChartColors>
		{/if}
	</section>
{:else}
	<FilecoinPayCard {url} {token} {paired} />
{/if}
