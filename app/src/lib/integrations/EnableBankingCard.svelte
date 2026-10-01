<script>
	// Enable Banking (issue #224, step 2): link a bank through the own
	// application the bridge holds, see the linked ones with the day their
	// consent ends, and unlink. The bank's answer comes back to
	// /integrationen/bank/verbunden (enablebanking/return.js). Fetching the
	// transactions is step 3.
	import { btn } from '$lib/ui/styles.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { formatDate } from '$lib/bank/format.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { rememberStart, RETURN_PATH } from '$lib/enablebanking/return.js';
	import { bridge, bridgeClient } from './bridge-state.svelte.js';

	/** @typedef {import('$lib/bridge/client.js').EnableBankingBank} Bank */
	/** @typedef {import('$lib/bridge/client.js').EnableBankingLink} Link */

	/** The countries Enable Banking serves: the EEA. */
	const COUNTRIES = [
		'AT',
		'BE',
		'BG',
		'CY',
		'CZ',
		'DE',
		'DK',
		'EE',
		'ES',
		'FI',
		'FR',
		'GR',
		'HR',
		'HU',
		'IE',
		'IS',
		'IT',
		'LI',
		'LT',
		'LU',
		'LV',
		'MT',
		'NL',
		'NO',
		'PL',
		'PT',
		'RO',
		'SE',
		'SI',
		'SK'
	];
	const countryName = (/** @type {string} */ code) => {
		try {
			return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(code) ?? code;
		} catch {
			return code;
		}
	};
	let countries = $derived(
		COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
			a.name.localeCompare(b.name, intlLocale())
		)
	);

	let ready = $derived(Boolean(bridge.token) && bridge.state === 'online');
	let configured = $derived(bridge.health.enablebanking);

	/** @type {Link[]} */
	let links = $state([]);
	let country = $state('DE');
	/** @type {Bank[]} */
	let banks = $state([]);
	let bankName = $state('');
	/** @type {'business' | 'personal'} */
	let psuType = $state('business');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	let bank = $derived(banks.find((b) => b.name === bankName) ?? null);
	let bothKinds = $derived(Boolean(bank && bank.psuTypes.length > 1));
	let redirectUrl = $derived(
		typeof location === 'undefined' ? RETURN_PATH : `${location.origin}${RETURN_PATH}`
	);

	/** @param {unknown} e */
	const message = (e) => (e instanceof Error ? e.message : String(e));

	async function loadLinks() {
		try {
			links = await bridgeClient().enableBankingLinks();
		} catch (e) {
			error = message(e);
		}
	}

	/** @param {string} code */
	async function loadBanks(code) {
		banks = [];
		bankName = '';
		try {
			banks = await bridgeClient().enableBankingBanks(code);
		} catch (e) {
			error = message(e);
		}
	}

	$effect(() => {
		if (ready && configured) loadLinks();
	});
	$effect(() => {
		if (ready && configured) loadBanks(country);
	});
	// Business where the bank offers it, else what it offers.
	$effect(() => {
		if (bank) psuType = bank.psuTypes.includes('business') ? 'business' : 'personal';
	});

	async function link() {
		if (!bank) return;
		busy = true;
		error = null;
		try {
			const started = await bridgeClient().enableBankingLink({
				bank: bank.name,
				country: bank.country,
				psuType
			});
			rememberStart(sessionStorage, { state: started.state, bank: bank.name });
			location.assign(started.url);
		} catch (e) {
			error = message(e);
			busy = false;
		}
	}

	/** @param {Link} l */
	async function unlink(l) {
		if (!confirm(t('integrationen.enableBanking.unlinkConfirm', { bank: l.bank }))) return;
		error = null;
		try {
			await bridgeClient().enableBankingUnlink(l.id);
			await loadLinks();
		} catch (e) {
			error = message(e);
		}
	}

	/** @param {Link} l */
	const endsSoon = (l) =>
		l.validUntil !== null && Date.parse(l.validUntil) - Date.now() < 14 * 86_400_000;
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="eb-h"
	data-testid="enablebanking-card"
>
	<h2 id="eb-h" class="text-lg font-semibold">{t('integrationen.enableBanking.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.enableBanking.intro')}</p>

	{#if !ready}
		<p class="mt-2 text-sm text-faint">{t('integrationen.enableBanking.needsBridge')}</p>
	{:else if !configured}
		<p class="mt-3 text-sm font-medium text-heading">
			{t('integrationen.enableBanking.needTitle')}
		</p>
		<ol class="mt-1 list-decimal pl-5 text-sm text-text" data-testid="enablebanking-need">
			<li>{t('integrationen.enableBanking.need1')}</li>
			<li>
				{t('integrationen.enableBanking.need2')}
				<code class="font-mono text-xs break-all text-heading" data-testid="enablebanking-redirect"
					>{redirectUrl}</code
				>
			</li>
			<li>
				{t('integrationen.enableBanking.need3')}
				<code class="font-mono text-xs text-heading">pnpm setup:enablebanking</code>
			</li>
		</ol>
	{:else}
		{#if links.length}
			<ul class="mt-3 divide-y divide-border" data-testid="enablebanking-links">
				{#each links as l (l.id)}
					<li class="py-2" data-testid="enablebanking-link">
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span class="font-medium text-heading">{l.bank}</span>
							<span class="text-xs text-faint"
								>{t(`integrationen.enableBanking.kind.${l.psuType}`)}</span
							>
							{#if l.validUntil}
								<span
									class="text-xs {endsSoon(l) ? 'text-danger' : 'text-faint'}"
									data-testid="enablebanking-valid"
									>{t('integrationen.enableBanking.validUntil', {
										date: formatDate(l.validUntil.slice(0, 10))
									})}</span
								>
							{/if}
							<button
								type="button"
								class="ml-auto text-xs underline"
								onclick={() => unlink(l)}
								data-testid="enablebanking-unlink">{t('integrationen.enableBanking.unlink')}</button
							>
						</div>
						<ul class="mt-1 font-mono text-xs text-faint">
							{#each l.accounts as a (a.uid)}
								<li data-testid="enablebanking-account">
									{[a.name, a.ibanLast4 && `····${a.ibanLast4}`, a.currency]
										.filter(Boolean)
										.join(' · ')}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-xs text-faint">{t('integrationen.enableBanking.fetchLater')}</p>
		{/if}

		<div class="mt-4 flex flex-wrap items-end gap-3">
			<label class="text-sm text-text">
				<span class="block">{t('integrationen.enableBanking.country')}</span>
				<select
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
					bind:value={country}
					data-testid="enablebanking-country"
				>
					{#each countries as c (c.code)}
						<option value={c.code}>{c.name}</option>
					{/each}
				</select>
			</label>
			<label class="min-w-48 flex-1 text-sm text-text">
				<span class="block">{t('integrationen.enableBanking.bank')}</span>
				<input
					class="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
					list="eb-banks"
					bind:value={bankName}
					placeholder={t('integrationen.enableBanking.bankPlaceholder', { count: banks.length })}
					data-testid="enablebanking-bank"
				/>
				<datalist id="eb-banks">
					{#each banks as b (b.name)}
						<option value={b.name}></option>
					{/each}
				</datalist>
			</label>
			{#if bothKinds}
				<label class="text-sm text-text">
					<span class="block">{t('integrationen.enableBanking.kindLabel')}</span>
					<select
						class="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
						bind:value={psuType}
						data-testid="enablebanking-kind"
					>
						<option value="business">{t('integrationen.enableBanking.kind.business')}</option>
						<option value="personal">{t('integrationen.enableBanking.kind.personal')}</option>
					</select>
				</label>
			{/if}
		</div>
		<button
			type="button"
			class="mt-3 {btn.primary}"
			disabled={!bank || busy}
			onclick={link}
			data-testid="enablebanking-start"
			>{busy
				? t('integrationen.enableBanking.going')
				: t('integrationen.enableBanking.start')}</button
		>
		{#if bank}
			<p class="mt-1 text-xs text-faint">
				{t('integrationen.enableBanking.startHint', {
					days: Math.min(bank.maxConsentDays, 180)
				})}
			</p>
		{/if}
	{/if}

	{#if error}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="enablebanking-error">{error}</p>
		<WayOut message={error} />
	{/if}
</section>
