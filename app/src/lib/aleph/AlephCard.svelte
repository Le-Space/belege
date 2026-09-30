<script>
	// Integrationen → Aleph Cloud (issue #113): which own addresses are Aleph
	// accounts, and per account and month "Verbrauchsnachweis erstellen" – an
	// Eigenbeleg of what the credits were used for (aleph.js). Read only: the
	// bridge asks Aleph's public API; nothing is signed or moved.
	import { createBridgeClient } from '$lib/bridge/client.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { formatDate } from '$lib/bank/format.js';
	import { amount } from '$lib/export/datev.js';
	import { loadWallets } from '$lib/wallets/wallet-sync.js';
	import {
		createAlephStatement,
		findStatement,
		loadAleph,
		previousMonth,
		saveAleph,
		scanAleph
	} from './aleph.js';

	let { url, token } = $props();
	const client = $derived(createBridgeClient({ url, token }));

	/** @type {import('./aleph.js').AlephSettings} */
	let aleph = $state({ scan: false, extra: [], accounts: [] });
	/** @type {import('$lib/wallets/wallet-sync.js').Wallet[]} */
	let wallets = $state([]);
	let extra = $state('');
	let scanning = $state(false);
	/** @type {string | null} */
	let scanNote = $state(null);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {Record<string, string>} month chosen per account */
	let month = $state({});
	/** @type {string | null} the account whose statement is being made */
	let making = $state(null);
	/** @type {Record<string, string>} */
	let made = $state({});

	const months = (() => {
		const now = new Date();
		return Array.from({ length: 12 }, (_, i) =>
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1))
				.toISOString()
				.slice(0, 7)
		);
	})();

	$effect(() => {
		if (!token) return;
		load();
	});

	async function load() {
		const store = currentStore();
		if (!store) return;
		aleph = await loadAleph(store.settings);
		wallets = await loadWallets(store.settings);
	}

	/** A wallet's name for an address, when the person gave it one. @param {string} address */
	const nameOf = (address) =>
		wallets.find((w) => w.address.toLowerCase() === address.toLowerCase())?.name ?? '';

	/** @param {boolean} on */
	async function setScan(on) {
		const store = currentStore();
		if (!store) return;
		aleph = await saveAleph(store.settings, { scan: on });
	}

	async function addExtra() {
		error = null;
		const a = extra.trim();
		if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
			error = t('aleph.badAddress');
			return;
		}
		const store = currentStore();
		if (!store) return;
		aleph = await saveAleph(store.settings, { extra: [...new Set([...aleph.extra, a])] });
		extra = '';
	}

	async function scan() {
		const store = currentStore();
		if (!store) return;
		scanning = true;
		error = null;
		scanNote = null;
		try {
			const { asked, accounts } = await scanAleph({ client, settings: store.settings, wallets });
			aleph = await loadAleph(store.settings);
			scanNote = t('aleph.scanned', { asked, found: accounts.length });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			scanning = false;
		}
	}

	/** @param {string} address */
	async function makeStatement(address) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs) return;
		making = address;
		error = null;
		try {
			const chosen = month[address] ?? previousMonth(new Date());
			const { number, statement } = await createAlephStatement({
				store,
				blobs,
				client,
				address,
				month: chosen,
				accountName: nameOf(address),
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? ''
			});
			made[address] = t('aleph.made', {
				number,
				month: chosen,
				eur: statement.totals.eurCents === null ? '—' : `${amount(statement.totals.eurCents)} EUR`
			});
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			making = null;
		}
	}

	const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	const credits = (/** @type {number} */ n) => Math.round(n).toLocaleString(intlLocale());
</script>

<section class={card} aria-labelledby="aleph-h" data-testid="aleph-card">
	<h2 id="aleph-h" class="text-lg font-semibold text-heading">{t('aleph.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('aleph.what')}</p>
	{#if !token}
		<p class="mt-2 text-sm text-faint">{t('aleph.needsBridge')}</p>
	{:else}
		<label class="mt-3 flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				class="mt-0.5"
				checked={aleph.scan}
				onchange={(e) => setScan(e.currentTarget.checked)}
				data-testid="aleph-scan-switch"
			/>
			<span>
				<span class="text-heading">{t('aleph.scanLabel')}</span>
				<span class="block text-xs text-faint">{t('aleph.scanPrivacy')}</span>
			</span>
		</label>
		<form
			class="mt-3 flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addExtra();
			}}
		>
			<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
				>{t('aleph.extraLabel')}
				<input
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
					bind:value={extra}
					autocomplete="off"
					spellcheck="false"
					placeholder="0x…"
					data-testid="aleph-extra-input"
				/></label
			>
			<button type="submit" class={button} disabled={!extra.trim()} data-testid="aleph-extra-add"
				>{t('aleph.extraAdd')}</button
			>
			<button
				type="button"
				class={button}
				disabled={scanning || (!aleph.scan && !aleph.extra.length)}
				onclick={scan}
				data-testid="aleph-scan">{scanning ? t('aleph.scanning') : t('aleph.scan')}</button
			>
		</form>
		{#if scanNote}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="aleph-scan-result">
				{scanNote}
			</p>
		{/if}
		{#if error}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="aleph-error">{error}</p>
			<WayOut message={error} />
		{/if}

		{#if aleph.accounts.length}
			<ul class="mt-3 divide-y divide-border text-sm" data-testid="aleph-accounts">
				{#each aleph.accounts as a (a.address)}
					{@const chosen = month[a.address] ?? previousMonth(new Date())}
					{@const existing = findStatement(app.receipts, a.address, chosen)}
					<li class="py-2" data-testid="aleph-account">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="min-w-0">
								{#if nameOf(a.address)}<span class="block text-heading">{nameOf(a.address)}</span
									>{/if}
								<span class="block font-mono text-xs break-all text-faint">{a.address}</span>
							</span>
							<span class="text-xs text-faint" data-testid="aleph-account-credits"
								>{t('aleph.credits', {
									credits: credits(a.credits),
									date: formatDate(a.checkedAt.slice(0, 10))
								})}</span
							>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-2">
							<label class="text-xs text-faint"
								>{t('aleph.month')}
								<select
									class="ml-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
									value={chosen}
									onchange={(e) => (month[a.address] = e.currentTarget.value)}
									data-testid="aleph-month"
								>
									{#each months as m (m)}<option value={m}>{m}</option>{/each}
								</select></label
							>
							{#if existing}
								<span class="text-xs text-success" data-testid="aleph-statement-exists"
									>{t('aleph.exists', { number: existing.selfNumber })}</span
								>
							{:else}
								<button
									type="button"
									class={button}
									disabled={making !== null}
									onclick={() => makeStatement(a.address)}
									data-testid="aleph-make"
									>{making === a.address ? t('aleph.making') : t('aleph.make')}</button
								>
							{/if}
						</div>
						{#if made[a.address]}
							<p class="mt-1 text-xs text-heading" role="status" data-testid="aleph-made">
								{made[a.address]}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-faint">{t('aleph.none')}</p>
		{/if}
	{/if}
</section>
