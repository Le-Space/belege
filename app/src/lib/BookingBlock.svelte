<script>
	// "Konto" in a booking's detail: the suggested contra account and BU key
	// with where they come from (booking/suggest.js), a field to search the
	// SKR 03 catalogue or type any number, and "Übernehmen". Only a confirmed
	// account is exported (export/plan.js); confirming teaches the vendor.
	import { untrack } from 'svelte';
	import TechnicalNote from './TechnicalNote.svelte';
	import { app, currentStore, refreshNow } from './session.svelte.js';
	import { confirmBooking } from './booking/actions.js';
	import { suggestBooking } from './booking/suggest.js';
	import { cleanDatevSettings } from './booking/settings.js';
	import {
		accountLabel,
		catalogueAccount,
		isAccountNumber,
		searchAccounts
	} from './booking/skr03.js';
	import { matchesOfTx } from './matching/view.js';
	import { formatDate } from './bank/format.js';
	import { list, t } from './i18n/index.js';

	/** @type {{ tx: import('./store/repository.js').StoredRecord }} */
	let { tx } = $props();

	let keys = $derived(cleanDatevSettings(app.datevSettings).taxKeys);
	let receipts = $derived(
		matchesOfTx(tx.id, app.matches).flatMap((m) => {
			const r = app.receipts.find((x) => x.id === m.receiptId);
			return r ? [r] : [];
		})
	);
	let suggestion = $derived(
		suggestBooking(tx, {
			classification: app.classifications[tx.id] ?? null,
			receipts,
			partners: app.partners ?? [],
			keys
		})
	);
	let income = $derived((tx.amountCents ?? 0) > 0);
	let catalogue = $derived(searchAccounts('', { income }));

	let accountText = $state('');
	let keyText = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another booking, or a new suggestion (a receipt was linked): start from it.
	let seed = $derived(`${tx.id}|${suggestion.account}|${suggestion.taxKey}|${suggestion.source}`);
	// Only the seed counts: the lists are read again after every write, and
	// what the person typed must not be reset by that.
	$effect(() => {
		void seed;
		untrack(() => {
			accountText = suggestion.account ?? '';
			keyText = suggestion.taxKey;
			error = null;
		});
	});

	/** "4930 Bürobedarf" or "4930" → "4930". */
	let number = $derived(/^\s*(\d{4,8})(?:\s|$)/.exec(accountText)?.[1] ?? accountText.trim());
	let valid = $derived(isAccountNumber(number) && /^\d{0,4}$/.test(keyText.trim()));
	let known = $derived(catalogueAccount(number));
	let confirmed = $derived(suggestion.source === 'confirmed');
	let unchanged = $derived(
		confirmed && number === suggestion.account && keyText.trim() === suggestion.taxKey
	);

	let sourceText = $derived(
		suggestion.source === 'learned'
			? suggestion.vendor
				? t('booking.source.learnedFrom', { vendor: suggestion.vendor })
				: t('booking.source.learned')
			: suggestion.source
				? t(`booking.source.${suggestion.source}`)
				: null
	);
	let taxText = $derived(
		t(`booking.taxVia.${suggestion.taxVia}`, {
			rate: String(
				receipts[0]?.extraction?.vat?.find((/** @type {any} */ v) => v?.rate)?.rate ?? ''
			)
		})
	);

	async function confirm() {
		const store = currentStore();
		if (!store) return;
		if (!isAccountNumber(number)) {
			error = t('booking.invalidAccount');
			return;
		}
		if (!/^\d{0,4}$/.test(keyText.trim())) {
			error = t('booking.invalidKey');
			return;
		}
		busy = true;
		error = null;
		try {
			await confirmBooking(/** @type {any} */ (store), tx.id, {
				account: number,
				taxKey: keyText.trim()
			});
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const input = 'mt-1 rounded-md border px-2 py-1.5 text-sm';
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
	data-testid="tx-booking"
	data-confirmed={confirmed ? 'true' : 'false'}
>
	<h3 class="text-sm font-semibold text-heading">{t('booking.title')}</h3>
	<p class="mt-1 text-xs text-faint">{t('booking.intro')}</p>

	{#if confirmed}
		<p class="mt-2 text-sm text-success" data-testid="tx-booking-confirmed">
			{t('booking.confirmed', {
				account: accountLabel(suggestion.account),
				key: suggestion.taxKey
					? t('booking.keyValue', { key: suggestion.taxKey })
					: t('booking.keyNone'),
				date: formatDate(String(tx.booking?.confirmedAt ?? '').slice(0, 10))
			})}
		</p>
	{:else}
		<p class="mt-2 text-sm text-text" data-testid="tx-booking-suggestion">
			{#if suggestion.account}
				<span class="font-medium text-heading">{t('booking.suggestion')}:</span>
				{accountLabel(suggestion.account)}
				<span
					class="ml-1 inline-block rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text"
					data-testid="tx-booking-source"
					data-source={suggestion.source}>{sourceText}</span
				>
			{:else}
				{t('booking.source.none')}
			{/if}
		</p>
		<p class="mt-1 text-xs text-danger" data-testid="tx-booking-open">
			{t('booking.notConfirmed')}
		</p>
	{/if}

	<form
		class="mt-2 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			confirm();
		}}
	>
		<label class="flex min-w-48 flex-1 flex-col text-sm">
			<span class="text-faint">{t('booking.account')}</span>
			<input
				class="{input} font-mono"
				list="skr03-accounts-{tx.id}"
				inputmode="numeric"
				autocomplete="off"
				bind:value={accountText}
				placeholder={t('booking.accountPlaceholder')}
				data-testid="tx-booking-account"
			/>
			<datalist id="skr03-accounts-{tx.id}">
				{#each catalogue as a (a.number)}
					<option value={a.number}>{a.number} {a.name}</option>
				{/each}
			</datalist>
			<span class="mt-1 min-h-4 text-xs text-faint" data-testid="tx-booking-account-name"
				>{known ? known.name : isAccountNumber(number) ? t('booking.ownNumber') : ''}</span
			>
		</label>
		<label class="flex w-28 flex-col text-sm">
			<span class="text-faint">{t('booking.taxKey')}</span>
			<input
				class="{input} font-mono"
				list="tax-keys-{tx.id}"
				inputmode="numeric"
				autocomplete="off"
				bind:value={keyText}
				placeholder={t('booking.taxKeyPlaceholder')}
				data-testid="tx-booking-key"
			/>
			<datalist id="tax-keys-{tx.id}">
				{#each [...new Set(Object.values(keys).filter(Boolean))] as k (k)}
					<option value={k}></option>
				{/each}
			</datalist>
			<span class="mt-1 min-h-4 text-xs text-faint">&nbsp;</span>
		</label>
		<button
			type="submit"
			class="mb-5 rounded-md bg-coral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
			disabled={busy || !valid || unchanged}
			data-testid="tx-booking-confirm"
			>{confirmed ? t('booking.confirmChange') : t('booking.confirm')}</button
		>
	</form>
	{#if !confirmed}
		<p class="text-xs text-faint" data-testid="tx-booking-tax-via">{taxText}</p>
	{/if}
	<p class="mt-1 text-xs text-faint">{t('booking.catalogueNote')}</p>
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="tx-booking-error">{error}</p>
	{/if}
	<TechnicalNote class="mt-2" testid="tx-booking-technical" lines={list('booking.technical')} />
</section>
