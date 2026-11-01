<script>
	// The monthly Akash usage statement on an Akash wallet's card (issue #305,
	// statement.js): a month with bookings of this wallet, "Erstellen", and
	// where the statement is once made.
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { createAkashStatement, findAkashStatement } from './statement.js';

	/** @type {{ wallet: import('$lib/wallets/wallet-sync.js').Wallet, client: any }} */
	let { wallet, client } = $props();

	let accountIds = $derived(
		new Set(
			app.accounts
				.filter((a) => a.source === 'akash' && a.walletAddress === wallet.address)
				.map((a) => a.id)
		)
	);
	let months = $derived(
		[
			...new Set(
				app.transactions
					.filter((tx) => !tx.deleted && accountIds.has(tx.accountId))
					.map((tx) => String(tx.bookedOn ?? '').slice(0, 7))
					.filter((m) => /^\d{4}-\d{2}$/.test(m))
			)
		].sort((a, b) => (a < b ? 1 : -1))
	);
	/** @type {string | null} */
	let chosen = $state(null);
	let month = $derived(chosen && months.includes(chosen) ? chosen : (months[0] ?? null));
	let existing = $derived(month ? findAkashStatement(app.receipts, wallet.address, month) : null);
	let busy = $state(false);
	/** @type {string | null} */
	let note = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	async function make() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !month) return;
		busy = true;
		error = null;
		note = null;
		try {
			const { number, data, linked } = await createAkashStatement({
				store,
				blobs,
				client,
				wallet,
				month,
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? ''
			});
			note = t('akash.made', {
				number,
				month,
				fees: linked,
				act: data.totals.usageAct.replace('.', ',')
			});
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if months.length}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="akash-statement">
		<p class="font-medium text-heading">{t('akash.title')}</p>
		<p class="mt-0.5 text-xs text-faint">{t('akash.what')}</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<label class="text-text"
				>{t('akash.month')}
				<select
					class="ml-1 rounded-md border border-border bg-surface px-2 py-1 text-heading"
					value={month}
					onchange={(e) => (chosen = e.currentTarget.value)}
					data-testid="akash-statement-month"
				>
					{#each months as m (m)}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</label>
			{#if existing}
				<span class="text-text" data-testid="akash-statement-exists"
					>{t('akash.exists', { number: existing.selfNumber })}</span
				>
			{:else}
				<button
					type="button"
					class={btn.secondary}
					onclick={make}
					disabled={busy || !client}
					data-testid="akash-statement-make">{busy ? t('akash.making') : t('akash.make')}</button
				>
			{/if}
		</div>
		{#if note}<p class="mt-1 text-success" role="status" data-testid="akash-statement-note">
				{note}
			</p>{/if}
		{#if error}<p class="mt-1 text-danger" role="alert" data-testid="akash-statement-error">
				{error}
			</p>{/if}
	</div>
{/if}
