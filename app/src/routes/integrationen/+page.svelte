<script>
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import MatchingSettings from '$lib/MatchingSettings.svelte';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { extractionTotals } from '$lib/activity/events.js';
	import { integer } from '$lib/receipts/how.js';
	import { describeMoment } from '$lib/moment.js';
	import PortalsCard from '$lib/portals/PortalsCard.svelte';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { createBridgeClient, DEFAULT_BRIDGE_URL } from '$lib/bridge/client.js';
	import { getSetting, setSetting } from '$lib/store/settings.js';
	import { syncHibiscus } from '$lib/bank/hibiscus-sync.js';
	import { parseCamt053 } from '$lib/bank/camt.js';
	import { importCamtStatements } from '$lib/bank/import.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { list, t } from '$lib/i18n/index.js';

	/** @typedef {import('$lib/bridge/client.js').BridgeAccount} BridgeAccount */
	/** @typedef {{ new: number, updated: number, skipped: number }} Counts */

	let bridgeUrl = $state(DEFAULT_BRIDGE_URL);
	/** @type {string | null} */
	let token = $state(null);
	/** @type {'unknown' | 'checking' | 'online' | 'offline'} */
	let bridgeState = $state('unknown');
	let bridgePaired = $state(false);
	let hibiscusConfigured = $state(false);
	let code = $state('');
	/** @type {string | null} */
	let bridgeError = $state(null);
	let pairing = $state(false);

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

	const client = $derived(createBridgeClient({ url: bridgeUrl, token }));

	/** @type {Awaited<ReturnType<ReturnType<typeof createBridgeClient>['llmStatus']>> | null} */
	let llmStatus = $state(null);
	/** @type {string | null} */
	let llmError = $state(null);
	let totals = $derived(extractionTotals(app.events));
	let lastMoment = $derived(totals.lastAt ? describeMoment(totals.lastAt) : null);

	async function loadLlmStatus() {
		llmError = null;
		try {
			llmStatus = await client.llmStatus();
		} catch (error) {
			llmStatus = null;
			llmError = error instanceof Error ? error.message : String(error);
		}
	}

	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		const saved = await getSetting(store.settings, 'bridge');
		if (saved?.url) bridgeUrl = saved.url;
		if (saved?.token) token = saved.token;
		await checkBridge();
		if (token && bridgeState === 'online') await Promise.all([loadAccounts(), loadLlmStatus()]);
	});

	async function checkBridge() {
		bridgeState = 'checking';
		bridgeError = null;
		try {
			const health = await createBridgeClient({ url: bridgeUrl }).health();
			bridgeState = health.ok ? 'online' : 'offline';
			bridgePaired = health.paired;
			hibiscusConfigured = health.hibiscus?.configured ?? false;
		} catch (error) {
			bridgeState = 'offline';
			bridgeError = error instanceof Error ? error.message : String(error);
		}
	}

	/** @param {SubmitEvent} event */
	async function pair(event) {
		event.preventDefault();
		const store = currentStore();
		if (!store) return;
		pairing = true;
		bridgeError = null;
		try {
			const newToken = await createBridgeClient({ url: bridgeUrl }).pair(code.trim());
			// Into the sealed store, never localStorage.
			await setSetting(store.settings, 'bridge', {
				url: bridgeUrl,
				token: newToken,
				pairedAt: new Date().toISOString()
			});
			token = newToken;
			code = '';
			await checkBridge();
			await Promise.all([loadAccounts(), loadLlmStatus()]);
		} catch (error) {
			bridgeError = error instanceof Error ? error.message : String(error);
		} finally {
			pairing = false;
		}
	}

	async function unpair() {
		const store = currentStore();
		if (!store) return;
		bridgeError = null;
		try {
			// The bridge forgets the token too, so a copy of it is worthless.
			await client.unpair();
		} catch {
			bridgeError = t('integrationen.bridge.unpairOffline');
		}
		await setSetting(store.settings, 'bridge', { url: bridgeUrl, token: null });
		token = null;
		llmStatus = null;
		bridgeAccounts = [];
		selected.clear();
	}

	async function loadAccounts() {
		syncError = null;
		try {
			bridgeAccounts = await client.accounts();
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
				client,
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
						label: `${result.account.name} ···${result.account.ibanLast4}`,
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

<h1 class="text-2xl font-bold text-heading">{t('integrationen.title')}</h1>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="bridge-h"
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 id="bridge-h" class="text-lg font-semibold">{t('integrationen.bridge.title')}</h2>
		<button
			type="button"
			class="rounded-md border border-border px-3 py-1 text-sm text-text hover:bg-surface-2 hover:text-heading"
			onclick={checkBridge}>{t('integrationen.bridge.check')}</button
		>
	</div>
	<p class="mt-1 text-sm text-text">{t('integrationen.bridge.intro')}</p>
	<p class="mt-3 text-sm text-text" data-testid="bridge-status" data-state={bridgeState}>
		{#if bridgeState === 'checking'}
			{t('integrationen.bridge.checking')}
		{:else if bridgeState === 'online'}
			<span class="font-medium text-success">{t('integrationen.bridge.online')}</span>
			· {token ? t('integrationen.bridge.paired') : t('integrationen.bridge.unpaired')}
			{#if !hibiscusConfigured}· {t('integrationen.bridge.noHibiscus')}{/if}
		{:else if bridgeState === 'offline'}
			<span class="font-medium text-danger">{t('integrationen.bridge.offline')}</span>
		{:else}
			{t('integrationen.bridge.unknown')}
		{/if}
	</p>

	{#if !token}
		<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={pair}>
			<label class="flex flex-col text-sm">
				<span class="text-faint">{t('integrationen.bridge.url')}</span>
				<input
					class="mt-1 w-64 max-w-full rounded-md border px-2 py-1.5 font-mono text-sm"
					bind:value={bridgeUrl}
					data-testid="bridge-url"
				/>
			</label>
			<label class="flex flex-col text-sm">
				<span class="text-faint">{t('integrationen.bridge.code')}</span>
				<input
					class="mt-1 w-40 rounded-md border px-2 py-1.5 font-mono text-sm uppercase"
					bind:value={code}
					placeholder="ABCD-EFGH"
					autocomplete="off"
					data-testid="pairing-code"
				/>
			</label>
			<button
				type="submit"
				class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={pairing || !code.trim()}>{t('integrationen.bridge.pair')}</button
			>
		</form>
		<p class="mt-2 text-xs text-faint">
			{t('integrationen.bridge.codeHint', {
				when: bridgePaired
					? t('integrationen.bridge.codeHintPaired')
					: t('integrationen.bridge.codeHintFirst')
			})}
		</p>
	{:else}
		<button
			type="button"
			class="mt-3 text-sm text-text underline hover:text-heading"
			onclick={unpair}
			data-testid="unpair">{t('integrationen.bridge.unpair')}</button
		>
	{/if}
	{#if bridgeError}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="bridge-error">{bridgeError}</p>
	{/if}
</section>

{#if token}
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
		{/if}
	</section>
{/if}

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="ki-h"
	data-testid="ki-card"
>
	<h2 id="ki-h" class="text-lg font-semibold">{t('integrationen.ki.title')}</h2>
	<p class="mt-1 text-sm text-text" data-testid="ki-simple">{t('integrationen.ki.simple')}</p>
	<p class="mt-1 text-sm text-text" data-testid="ki-key-where">{t('integrationen.ki.keyWhere')}</p>
	{#if !token}
		<p class="mt-3 text-sm text-faint">{t('integrationen.ki.noBridge')}</p>
	{:else if llmError}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="ki-error">
			{t('integrationen.ki.unreachable', { error: llmError })}
		</p>
	{:else if llmStatus}
		<dl
			class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
			data-testid="ki-status"
		>
			<dt class="text-faint">{t('integrationen.ki.provider')}</dt>
			<dd class="font-mono text-xs break-all text-heading" data-testid="ki-provider">
				{llmStatus.provider ?? '—'}
				{#if !llmStatus.configured}
					<span class="font-sans text-danger">· {t('integrationen.ki.notSetUp')}</span>
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.models')}</dt>
			<dd class="text-heading" data-testid="ki-models">
				{llmStatus.models.fallback
					? t('integrationen.ki.modelsValue', {
							primary: llmStatus.models.primary ?? '—',
							fallback: llmStatus.models.fallback
						})
					: (llmStatus.models.primary ?? '—')}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.key')}</dt>
			<dd
				class={llmStatus.keyConfigured ? 'font-medium text-success' : 'font-medium text-danger'}
				data-testid="ki-key"
				data-configured={llmStatus.keyConfigured ? 'true' : 'false'}
			>
				{llmStatus.keyConfigured ? t('integrationen.ki.keyOk') : t('integrationen.ki.keyMissing')}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.terms')}</dt>
			<dd class="text-heading tabular-nums" data-testid="ki-terms">{llmStatus.redactTerms}</dd>
			<dt class="text-faint">{t('integrationen.ki.authServ')}</dt>
			<dd class="text-heading" data-testid="ki-authserv">
				{#if llmStatus.mail?.authServId}
					<span class="font-mono text-xs">{llmStatus.mail.authServId}</span>
				{:else}
					<span class="text-text">{t('integrationen.ki.authServNone')}</span>
					<span class="block text-xs text-faint">{t('integrationen.ki.authServNoneHint')}</span>
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.last')}</dt>
			<dd class="text-heading" data-testid="ki-last">
				{#if lastMoment}
					<time datetime={lastMoment.datetime} title={lastMoment.utc}>{lastMoment.local}</time>
					{#if totals.lastModel}· <span class="font-mono text-xs">{totals.lastModel}</span>{/if}
				{:else}
					{t('integrationen.ki.lastNone')}
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.totals')}</dt>
			<dd class="text-heading tabular-nums" data-testid="ki-totals">
				{t('integrationen.ki.totalsValue', {
					calls: integer(totals.calls),
					tokens: integer(totals.tokens)
				})}{totals.failed
					? t('integrationen.ki.totalsFailed', { count: totals.failed })
					: ''}{totals.fallbacks
					? t('integrationen.ki.totalsFallback', { count: totals.fallbacks })
					: ''}
			</dd>
		</dl>
		<a
			href={`${resolve('/verlauf')}?group=auslesen`}
			class="mt-3 inline-block text-sm text-text underline hover:text-heading"
			data-testid="ki-verlauf">{t('integrationen.ki.verlauf')}</a
		>
	{/if}
	<TechnicalNote class="mt-3" lines={list('integrationen.ki.technical')} />
</section>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="camt-h"
>
	<h2 id="camt-h" class="text-lg font-semibold">{t('integrationen.camt.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.camt.intro')}</p>
	<label class="mt-3 inline-block max-w-full text-sm text-text">
		<span class="sr-only">{t('integrationen.camt.title')}</span>
		<input
			type="file"
			accept=".xml,application/xml,text/xml"
			multiple
			disabled={camtBusy}
			onchange={importCamt}
			class="max-w-full file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-heading"
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
					{account.name} ···{account.ibanLast4} · {account.source === 'camt'
						? t('integrationen.books.camt')
						: t('integrationen.books.hibiscus')} · {account.currency}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<PortalsCard url={bridgeUrl} {token} />

<MatchingSettings />
