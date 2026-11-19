<script>
	// Integrationen → Eigene Wallets → Filecoin Pay: which own Filecoin wallets
	// have a balance in the payment contract, a month of one as it was settled,
	// and "Verbrauchsnachweis erstellen" – an Eigenbeleg of what left the
	// balance for which provider (filecoin-pay.js). Read only: the bridge asks
	// the makers' index and Blockscout; nothing is signed or moved.
	//
	// Shown only when the books keep a Filecoin wallet a contract can hold a
	// balance for (f410f…): nothing is asked before "Prüfen".
	import { createBridgeClient } from '$lib/bridge/client.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { formatDate } from '$lib/bank/format.js';
	import { amount } from '$lib/export/datev.js';
	import { loadWallets } from '$lib/wallets/wallet-sync.js';
	import { walletList } from '$lib/wallets/wallet-list.svelte.js';
	import { previousMonth } from '$lib/aleph/aleph.js';
	import {
		createFilecoinPayStatement,
		findFilecoinPayStatement,
		loadFilecoinPay,
		payerWallets,
		scanFilecoinPay,
		shortAmount
	} from './filecoin-pay.js';

	/** @type {{ url: string, token: string | null, paired?: boolean }} */
	let { url, token, paired = Boolean(token) } = $props();
	const client = $derived(createBridgeClient({ url, token }));

	/** @type {import('./filecoin-pay.js').FilecoinPayAccount[]} */
	let accounts = $state([]);
	/** @type {import('$lib/wallets/wallet-sync.js').Wallet[]} */
	let wallets = $state([]);
	let scanning = $state(false);
	/** @type {string | null} */
	let scanNote = $state(null);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {Record<string, string>} month chosen per wallet */
	let month = $state({});
	/** @type {string | null} the wallet being read or written for */
	let busy = $state(null);
	/** @type {Record<string, import('$lib/bridge/client.js').FilecoinPayStatement>} the month shown, per wallet */
	let shown = $state({});
	/** @type {Record<string, string>} */
	let made = $state({});
	/** Whether the bridge asked Blockscout with a key the last time; null until it was asked. @type {boolean | null} */
	let keyed = $state(null);

	const months = (() => {
		const now = new Date();
		return Array.from({ length: 12 }, (_, i) =>
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1))
				.toISOString()
				.slice(0, 7)
		);
	})();

	let candidates = $derived(payerWallets(wallets));

	$effect(() => {
		// Again when a wallet was added or removed on the card above.
		void walletList.changes;
		load();
	});

	async function load() {
		const store = currentStore();
		if (!store) return;
		wallets = await loadWallets(store.settings);
		accounts = (await loadFilecoinPay(store.settings)).accounts;
	}

	/** @param {string} address */
	const nameOf = (address) => wallets.find((w) => w.address === address)?.name ?? '';
	/** @param {string} address */
	const chosenOf = (address) => month[address] ?? previousMonth(new Date());
	/** @param {number | null} cents */
	const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);

	async function scan() {
		const store = currentStore();
		if (!store) return;
		scanning = true;
		error = null;
		scanNote = null;
		try {
			const result = await scanFilecoinPay({ client, settings: store.settings, wallets });
			accounts = result.accounts;
			if (result.asked > result.failed.length) keyed = result.keyed;
			scanNote = t('filecoinPay.scanned', { asked: result.asked, found: result.accounts.length });
			if (result.failed.length) error = result.failed[0].error;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			scanning = false;
		}
	}

	/** @param {string} address */
	async function show(address) {
		busy = address;
		error = null;
		try {
			const s = await client.filecoinPayStatement(address, chosenOf(address));
			shown[address] = s;
			keyed = s.blockscoutKey === true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	/** @param {string} address */
	async function make(address) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs) return;
		busy = address;
		error = null;
		try {
			const chosen = chosenOf(address);
			const { number, statement } = await createFilecoinPayStatement({
				store,
				blobs,
				client,
				address,
				month: chosen,
				statement: shown[address]?.month === chosen ? shown[address] : null,
				walletName: nameOf(address),
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? ''
			});
			shown[address] = statement;
			keyed = statement.blockscoutKey === true;
			made[address] = t('filecoinPay.made', {
				number,
				month: chosen,
				eur: euro(statement.totals.eurCents)
			});
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	const utc = (/** @type {string} */ iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
</script>

{#if candidates.length}
	<section class={card} aria-labelledby="filecoin-pay-h" data-testid="filecoin-pay-card">
		<h2 id="filecoin-pay-h" class="text-lg font-semibold text-heading">
			{t('filecoinPay.title')}
		</h2>
		<p class="mt-1 text-sm text-text">{t('filecoinPay.what')}</p>
		{#if !paired}
			<p class="mt-2 text-sm text-faint">{t('filecoinPay.needsBridge')}</p>
		{:else}
			<p class="mt-2 text-xs text-faint">{t('filecoinPay.privacy')}</p>
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<button
					type="button"
					class={button}
					disabled={scanning}
					onclick={scan}
					data-testid="filecoin-pay-scan"
					>{scanning
						? t('filecoinPay.scanning')
						: t('filecoinPay.scan', { count: candidates.length })}</button
				>
			</div>
			{#if scanNote}
				<p class="mt-2 text-sm text-heading" role="status" data-testid="filecoin-pay-scan-result">
					{scanNote}
				</p>
			{/if}
			{#if error}
				<p class="mt-2 text-sm text-danger" role="alert" data-testid="filecoin-pay-error">
					{error}
				</p>
				<WayOut message={error} />
			{/if}
			{#if keyed === false}
				<p class="mt-2 text-xs text-faint" data-testid="filecoin-pay-no-key">
					{t('filecoinPay.noKey')} <code class="font-mono">pnpm setup:blockscout</code>
				</p>
			{/if}

			{#if accounts.length}
				<ul class="mt-3 divide-y divide-border text-sm" data-testid="filecoin-pay-accounts">
					{#each accounts as a (a.address)}
						{@const chosen = chosenOf(a.address)}
						{@const existing = findFilecoinPayStatement(app.receipts, a.address, chosen)}
						{@const s = shown[a.address]?.month === chosen ? shown[a.address] : null}
						<li class="py-2" data-testid="filecoin-pay-account">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="min-w-0">
									{#if nameOf(a.address)}<span class="block text-heading">{nameOf(a.address)}</span
										>{/if}
									<span class="block font-mono text-xs break-all text-faint">{a.address}</span>
								</span>
								<span class="text-xs text-faint" data-testid="filecoin-pay-funds"
									>{t('filecoinPay.funds', {
										funds: shortAmount(a.funds),
										locked: shortAmount(a.lockedUp),
										rails: a.rails,
										date: formatDate(a.checkedAt.slice(0, 10))
									})}</span
								>
							</div>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<label class="text-xs text-faint"
									>{t('filecoinPay.month')}
									<select
										class="ml-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
										value={chosen}
										onchange={(e) => (month[a.address] = e.currentTarget.value)}
										data-testid="filecoin-pay-month"
									>
										{#each months as m (m)}<option value={m}>{m}</option>{/each}
									</select></label
								>
								<button
									type="button"
									class={button}
									disabled={busy !== null}
									onclick={() => show(a.address)}
									data-testid="filecoin-pay-show"
									>{busy === a.address ? t('filecoinPay.reading') : t('filecoinPay.show')}</button
								>
								{#if existing}
									<span class="text-xs text-success" data-testid="filecoin-pay-exists"
										>{t('filecoinPay.exists', { number: existing.selfNumber })}</span
									>
								{:else}
									<button
										type="button"
										class={button}
										disabled={busy !== null}
										onclick={() => make(a.address)}
										data-testid="filecoin-pay-make">{t('filecoinPay.make')}</button
									>
								{/if}
							</div>
							{#if made[a.address]}
								<p class="mt-1 text-xs text-heading" role="status" data-testid="filecoin-pay-made">
									{made[a.address]}
								</p>
							{/if}
							{#if s}
								<div class="mt-3 text-xs" data-testid="filecoin-pay-statement">
									<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
										<dt class="text-faint">{t('filecoinPay.opening')}</dt>
										<dd class="text-right font-mono" data-testid="filecoin-pay-opening">
											{shortAmount(s.opening)}
										</dd>
										<dt class="text-faint">{t('filecoinPay.deposits')}</dt>
										<dd class="text-right font-mono">{shortAmount(s.totals.deposits)}</dd>
										<dt class="text-faint">{t('filecoinPay.withdrawals')}</dt>
										<dd class="text-right font-mono">{shortAmount(s.totals.withdrawals)}</dd>
										<dt class="text-faint">{t('filecoinPay.usage')}</dt>
										<dd class="text-right font-mono" data-testid="filecoin-pay-usage">
											{shortAmount(s.totals.usage)} · {euro(s.totals.eurCents)}
										</dd>
										<dt class="text-heading">{t('filecoinPay.closing')}</dt>
										<dd
											class="text-right font-mono text-heading"
											data-testid="filecoin-pay-closing"
										>
											{shortAmount(s.closing)}
											{s.asset}
										</dd>
									</dl>
									{#if s.usage.length}
										<div class="mt-2 overflow-x-auto">
											<table class="w-full text-left">
												<thead class="text-faint">
													<tr>
														<th class="pr-3 font-normal">{t('filecoinPay.col.time')}</th>
														<th class="pr-3 font-normal">{t('filecoinPay.col.rail')}</th>
														<th class="pr-3 font-normal">{t('filecoinPay.col.payee')}</th>
														<th class="pr-3 font-normal">{t('filecoinPay.col.until')}</th>
														<th class="pr-3 text-right font-normal">{s.asset}</th>
														<th class="text-right font-normal">EUR</th>
													</tr>
												</thead>
												<tbody>
													{#each s.usage as u (u.txHash + u.railId + u.time)}
														<tr class="border-t border-border" data-testid="filecoin-pay-line">
															<td class="pr-3 whitespace-nowrap">{utc(u.time)}</td>
															<td class="pr-3">{u.railId}{u.service ? ` · ${u.service}` : ''}</td>
															<td class="pr-3 font-mono"
																>{u.payee.slice(0, 8)}…{u.payee.slice(-6)}</td
															>
															<td class="pr-3 whitespace-nowrap"
																>{u.paidUntil
																	? formatDate(u.paidUntil.slice(0, 10))
																	: t('filecoinPay.oneTime')}</td
															>
															<td class="pr-3 text-right font-mono">{shortAmount(u.amount)}</td>
															<td class="text-right font-mono"
																>{u.eurCents === null ? '—' : amount(u.eurCents)}</td
															>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									{:else}
										<p class="mt-2 text-faint">{t('filecoinPay.noUsage')}</p>
									{/if}
									<p class="mt-2 text-faint" data-testid="filecoin-pay-source">
										{t(`filecoinPay.source.${s.source}`)}
										{#if s.movementsFrom === 'transfers'}{t('filecoinPay.source.transfers')}{/if}
									</p>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-sm text-faint">{t('filecoinPay.none')}</p>
			{/if}
			<p class="mt-3 text-xs text-faint">{t('filecoinPay.limits')}</p>
		{/if}
	</section>
{/if}
