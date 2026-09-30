<script>
	// Bank (issue #152): the accounts Hibiscus offers through the bridge and
	// their sync, the CAMT.053 file import for banks without Hibiscus, and the
	// accounts the books keep. Moved from the Integrationen page.
	import { btn } from '$lib/ui/styles.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { syncHibiscus } from '$lib/bank/hibiscus-sync.js';
	import { parseCamt053 } from '$lib/bank/camt.js';
	import { importCamtStatements } from '$lib/bank/import.js';
	import { accountLabel, formatDate, formatMoney } from '$lib/bank/format.js';
	import { isWalletSource } from '$lib/wallets/chains.js';
	import { t } from '$lib/i18n/index.js';
	import { bridge, bridgeClient } from './bridge-state.svelte.js';

	/** @typedef {import('$lib/bridge/client.js').BridgeAccount} BridgeAccount */
	/** @typedef {{ new: number, updated: number, skipped: number }} Counts */

	/** @type {BridgeAccount[]} */
	let bridgeAccounts = $state([]);
	const selected = new SvelteSet(/** @type {string[]} */ ([]));
	let syncing = $state(false);
	/** @type {Counts | null} */
	let syncResult = $state(null);
	/** @type {string | null} */
	let syncError = $state(null);

	/** @type {{ label: string, counts: Counts, pending: number }[]} */
	let camtResults = $state([]);
	/** @type {string | null} */
	let camtError = $state(null);
	let camtBusy = $state(false);

	onMount(() => {
		if (bridge.token && bridge.state === 'online') loadAccounts();
	});
	// Paired on this page, or the bridge came back.
	$effect(() => {
		if (bridge.token && bridge.state === 'online' && bridgeAccounts.length === 0) loadAccounts();
	});

	async function loadAccounts() {
		syncError = null;
		try {
			bridgeAccounts = await bridgeClient().accounts();
			const known = new Map(
				app.accounts.filter((a) => a.source === 'hibiscus').map((a) => [a.sourceAccountId, a])
			);
			selected.clear();
			for (const account of bridgeAccounts) {
				// New accounts start chosen; known ones keep their choice.
				const record = known.get(account.id);
				if (!record || record.importEnabled !== false) selected.add(account.id);
			}
		} catch (error) {
			syncError = error instanceof Error ? error.message : String(error);
		}
	}

	/** Empty: automatic (90 days the first time, then from the last sync). */
	let syncFrom = $state('');
	const today = new Date().toISOString().slice(0, 10);

	async function sync() {
		const store = currentStore();
		if (!store) return;
		syncing = true;
		syncError = null;
		syncResult = null;
		try {
			const { totals } = await syncHibiscus({
				client: bridgeClient(),
				store,
				accounts: bridgeAccounts.filter((a) => selected.has(a.id)),
				from: syncFrom || undefined
			});
			// Accounts left out this time are remembered as such.
			for (const record of app.accounts.filter((a) => a.source === 'hibiscus')) {
				if (!selected.has(record.sourceAccountId) && record.importEnabled !== false) {
					await store.accounts.put({ ...record, importEnabled: false });
				}
			}
			syncResult = totals;
			await refreshNow();
		} catch (error) {
			syncError = error instanceof Error ? error.message : String(error);
		} finally {
			syncing = false;
		}
		// After the sync, not inside it: the buttons are free again meanwhile.
		if (syncResult) await runMatchingNow();
	}

	/** @param {Event} event */
	async function importCamt(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const store = currentStore();
		const files = [...(input.files ?? [])];
		if (!store || files.length === 0) return;
		camtBusy = true;
		camtError = null;
		camtResults = [];
		try {
			for (const file of files) {
				const statements = parseCamt053(await file.text());
				for (const result of await importCamtStatements(store, statements)) {
					camtResults.push({
						label: `${accountLabel(result.account)}`,
						counts: result.counts,
						pending: result.pending
					});
				}
			}
			await refreshNow();
		} catch (error) {
			camtError = error instanceof Error ? error.message : String(error);
		} finally {
			camtBusy = false;
			input.value = '';
		}
		if (camtResults.length) await runMatchingNow();
	}

	/** @param {Counts} c */
	const countsText = (c) =>
		t('integrationen.counts', { new: c.new, updated: c.updated, skipped: c.skipped });

	/** @param {string} id */
	function lastSync(id) {
		const record = app.accounts.find((a) => a.source === 'hibiscus' && a.sourceAccountId === id);
		return record?.lastSyncedOn ? formatDate(record.lastSyncedOn) : null;
	}
</script>

{#if bridge.token}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		aria-labelledby="hib-h"
	>
		<h2 id="hib-h" class="text-lg font-semibold">{t('integrationen.hibiscus.title')}</h2>
		{#if bridgeAccounts.length === 0}
			<p class="mt-2 text-sm text-text">
				{t('integrationen.hibiscus.none')}
				<button type="button" class="underline" onclick={loadAccounts}
					>{t('integrationen.hibiscus.reload')}</button
				>
			</p>
		{:else}
			<ul class="mt-3 divide-y divide-border" data-testid="hibiscus-accounts">
				{#each bridgeAccounts as account (account.id)}
					<li class="flex flex-wrap items-center gap-3 py-2" data-testid="hibiscus-account">
						<label class="flex min-w-0 flex-1 items-center gap-3">
							<input
								type="checkbox"
								class="h-4 w-4 accent-cyan-800 dark:accent-cyan"
								checked={selected.has(account.id)}
								onchange={(e) =>
									e.currentTarget.checked ? selected.add(account.id) : selected.delete(account.id)}
							/>
							<span class="min-w-0">
								<span class="block font-medium text-heading">{account.name}</span>
								<span class="block font-mono text-xs text-faint"
									>{[
										account.ibanMasked,
										account.currency,
										lastSync(account.id) &&
											t('integrationen.hibiscus.lastSync', { date: lastSync(account.id) ?? '' })
									]
										.filter(Boolean)
										.join(' · ')}</span
								>
							</span>
						</label>
						{#if account.balanceCents !== null}
							<span class="font-mono text-sm text-heading tabular-nums"
								>{formatMoney(account.balanceCents, account.currency)}</span
							>
							{#if account.balanceDate}
								<span class="text-xs text-faint"
									>{t('integrationen.hibiscus.balanceOn', {
										date: formatDate(account.balanceDate)
									})}</span
								>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			<label class="mt-4 block text-sm text-text">
				{t('integrationen.hibiscus.fromLabel')}
				<input
					type="date"
					class="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
					max={today}
					bind:value={syncFrom}
					data-testid="sync-from"
				/>
			</label>
			<button
				type="button"
				class="mt-3 rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={syncing || selected.size === 0}
				onclick={sync}
				>{syncing ? t('integrationen.hibiscus.syncing') : t('integrationen.hibiscus.sync')}</button
			>
			<p class="mt-1 text-xs text-faint">
				{syncFrom ? t('integrationen.hibiscus.syncHintFrom') : t('integrationen.hibiscus.syncHint')}
			</p>
		{/if}
		{#if syncResult}
			<p class="mt-3 text-sm text-heading" role="status" data-testid="sync-result">
				{countsText(syncResult)}
			</p>
		{/if}
		{#if syncError}
			<p class="mt-3 text-sm text-danger" role="alert" data-testid="sync-error">{syncError}</p>
			<WayOut message={syncError} />
		{/if}
	</section>
{/if}

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="camt-h"
>
	<h2 id="camt-h" class="text-lg font-semibold">{t('integrationen.camt.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.camt.intro')}</p>
	<label class="mt-3 inline-flex cursor-pointer items-center {btn.secondary}">
		{camtBusy ? t('integrationen.camt.reading') : t('integrationen.camt.choose')}
		<input
			type="file"
			accept=".xml,application/xml,text/xml"
			multiple
			disabled={camtBusy}
			onchange={importCamt}
			class="sr-only"
			data-testid="camt-file"
		/>
	</label>
	{#each camtResults as result, i (i)}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="camt-result">
			{result.label}: {countsText(result.counts)}{result.pending
				? t('integrationen.camt.pending', { count: result.pending })
				: ''}
		</p>
	{/each}
	{#if camtError}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="camt-error">{camtError}</p>
	{/if}
</section>

{#if app.accounts.length}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		aria-labelledby="acc-h"
	>
		<h2 id="acc-h" class="text-lg font-semibold">{t('integrationen.books.title')}</h2>
		<ul class="mt-2 text-sm text-text" data-testid="book-accounts">
			{#each app.accounts as account (account.id)}
				<li class="py-1" data-testid="book-account">
					{accountLabel(account)} · {account.source === 'camt'
						? t('integrationen.books.camt')
						: account.source === 'kraken'
							? t('integrationen.books.kraken')
							: isWalletSource(account.source)
								? t('integrationen.books.wallet')
								: t('integrationen.books.hibiscus')} · {account.asset ?? account.currency}
				</li>
			{/each}
		</ul>
	</section>
{/if}
