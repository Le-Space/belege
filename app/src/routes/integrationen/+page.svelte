<script>
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { createBridgeClient, DEFAULT_BRIDGE_URL } from '$lib/bridge/client.js';
	import { getSetting, setSetting } from '$lib/store/settings.js';
	import { syncHibiscus } from '$lib/bank/hibiscus-sync.js';
	import { parseCamt053 } from '$lib/bank/camt.js';
	import { importCamtStatements } from '$lib/bank/import.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';

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

	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		const saved = await getSetting(store.settings, 'bridge');
		if (saved?.url) bridgeUrl = saved.url;
		if (saved?.token) token = saved.token;
		await checkBridge();
		if (token && bridgeState === 'online') await loadAccounts();
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
			await loadAccounts();
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
			bridgeError =
				'Die Bridge war nicht erreichbar: Die Kopplung ist nur auf diesem Gerät gelöst. ' +
				'Auf der Bridge entfernt `pnpm bridge -- --revoke-all` alle Kopplungen.';
		}
		await setSetting(store.settings, 'bridge', { url: bridgeUrl, token: null });
		token = null;
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
				accounts: bridgeAccounts.filter((a) => selected.has(a.id))
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
	}

	/** @param {Counts} c */
	const countsText = (c) =>
		`Neu: ${c.new} · Aktualisiert: ${c.updated} · Übersprungen: ${c.skipped}`;

	/** @param {string} id */
	function lastSync(id) {
		const record = app.accounts.find((a) => a.source === 'hibiscus' && a.sourceAccountId === id);
		return record?.lastSyncedOn ? formatDate(record.lastSyncedOn) : null;
	}
</script>

<h1 class="text-2xl font-semibold text-slate-900">Integrationen</h1>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="bridge-h">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 id="bridge-h" class="text-lg font-semibold text-slate-900">Bridge</h2>
		<button
			type="button"
			class="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
			onclick={checkBridge}>Status prüfen</button
		>
	</div>
	<p class="mt-1 text-sm text-slate-600">
		Die Bridge läuft auf diesem Rechner (127.0.0.1) und holt Umsätze aus Hibiscus. Konten, deren
		IBAN nicht freigegeben ist, verlassen sie nie.
	</p>
	<p class="mt-3 text-sm" data-testid="bridge-status" data-state={bridgeState}>
		{#if bridgeState === 'checking'}
			Prüfe …
		{:else if bridgeState === 'online'}
			<span class="font-medium text-emerald-700">Bridge erreichbar</span>
			· {token ? 'dieses Gerät ist gekoppelt' : 'nicht gekoppelt'}
			{#if !hibiscusConfigured}· Hibiscus ist noch nicht eingerichtet{/if}
		{:else if bridgeState === 'offline'}
			<span class="font-medium text-red-700">Bridge nicht erreichbar</span>
		{:else}
			Status unbekannt
		{/if}
	</p>

	{#if !token}
		<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={pair}>
			<label class="flex flex-col text-sm">
				<span class="text-slate-600">Bridge-Adresse</span>
				<input
					class="mt-1 w-64 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
					bind:value={bridgeUrl}
					data-testid="bridge-url"
				/>
			</label>
			<label class="flex flex-col text-sm">
				<span class="text-slate-600">Kopplungscode</span>
				<input
					class="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase"
					bind:value={code}
					placeholder="ABCD-EFGH"
					autocomplete="off"
					data-testid="pairing-code"
				/>
			</label>
			<button
				type="submit"
				class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
				disabled={pairing || !code.trim()}>Koppeln</button
			>
		</form>
		<p class="mt-2 text-xs text-slate-500">
			Den Code zeigt die Bridge beim Start im Terminal an ({bridgePaired
				? 'schon ein Gerät gekoppelt: mit --pair neu starten'
				: 'einmalig, 10 Minuten gültig'}).
		</p>
	{:else}
		<button
			type="button"
			class="mt-3 text-sm text-slate-600 underline"
			onclick={unpair}
			data-testid="unpair">Kopplung lösen</button
		>
	{/if}
	{#if bridgeError}
		<p class="mt-3 text-sm text-red-700" role="alert" data-testid="bridge-error">{bridgeError}</p>
	{/if}
</section>

{#if token}
	<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="hib-h">
		<h2 id="hib-h" class="text-lg font-semibold text-slate-900">Hibiscus</h2>
		{#if bridgeAccounts.length === 0}
			<p class="mt-2 text-sm text-slate-600">
				Keine freigegebenen Konten.
				<button type="button" class="underline" onclick={loadAccounts}>Neu laden</button>
			</p>
		{:else}
			<ul class="mt-3 divide-y divide-slate-100" data-testid="hibiscus-accounts">
				{#each bridgeAccounts as account (account.id)}
					<li class="flex flex-wrap items-center gap-3 py-2" data-testid="hibiscus-account">
						<label class="flex min-w-0 flex-1 items-center gap-3">
							<input
								type="checkbox"
								checked={selected.has(account.id)}
								onchange={(e) =>
									e.currentTarget.checked ? selected.add(account.id) : selected.delete(account.id)}
							/>
							<span class="min-w-0">
								<span class="block font-medium text-slate-900">{account.name}</span>
								<span class="block font-mono text-xs text-slate-500"
									>{[
										account.ibanMasked,
										account.currency,
										lastSync(account.id) && `zuletzt ${lastSync(account.id)}`
									]
										.filter(Boolean)
										.join(' · ')}</span
								>
							</span>
						</label>
						{#if account.balanceCents !== null}
							<span class="font-mono text-sm tabular-nums"
								>{formatMoney(account.balanceCents, account.currency)}</span
							>
							{#if account.balanceDate}
								<span class="text-xs text-slate-500">am {formatDate(account.balanceDate)}</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="mt-4 rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
				disabled={syncing || selected.size === 0}
				onclick={sync}>{syncing ? 'Synchronisiere …' : 'Jetzt synchronisieren'}</button
			>
			<p class="mt-1 text-xs text-slate-500">
				Beim ersten Mal die letzten 90 Tage, danach ab der letzten Synchronisierung.
			</p>
		{/if}
		{#if syncResult}
			<p class="mt-3 text-sm text-slate-700" role="status" data-testid="sync-result">
				{countsText(syncResult)}
			</p>
		{/if}
		{#if syncError}
			<p class="mt-3 text-sm text-red-700" role="alert" data-testid="sync-error">{syncError}</p>
		{/if}
	</section>
{/if}

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="camt-h">
	<h2 id="camt-h" class="text-lg font-semibold text-slate-900">
		Kontoauszug importieren (CAMT.053)
	</h2>
	<p class="mt-1 text-sm text-slate-600">
		Für Banken ohne Hibiscus-Anbindung (etwa Revolut): die CAMT.053-Datei des Kontoauszugs. Sie wird
		nur hier im Browser gelesen.
	</p>
	<label class="mt-3 inline-block text-sm">
		<span class="sr-only">Kontoauszug importieren (CAMT.053)</span>
		<input
			type="file"
			accept=".xml,application/xml,text/xml"
			multiple
			disabled={camtBusy}
			onchange={importCamt}
			data-testid="camt-file"
		/>
	</label>
	{#each camtResults as result, i (i)}
		<p class="mt-2 text-sm text-slate-700" role="status" data-testid="camt-result">
			{result.label}: {countsText(result.counts)}{result.pending
				? ` · ${result.pending} vorgemerkt (nicht importiert)`
				: ''}
		</p>
	{/each}
	{#if camtError}
		<p class="mt-2 text-sm text-red-700" role="alert" data-testid="camt-error">{camtError}</p>
	{/if}
</section>

{#if app.accounts.length}
	<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="acc-h">
		<h2 id="acc-h" class="text-lg font-semibold text-slate-900">Konten in den Büchern</h2>
		<ul class="mt-2 text-sm" data-testid="book-accounts">
			{#each app.accounts as account (account.id)}
				<li class="py-1" data-testid="book-account">
					{account.name} ···{account.ibanLast4} · {account.source === 'camt'
						? 'CAMT-Import'
						: 'Hibiscus'} · {account.currency}
				</li>
			{/each}
		</ul>
	</section>
{/if}
