<script>
	// A payment's account, in the list (Zahlungen → "Ohne Konto"): the field
	// holds what the books suggest by themselves (suggest.js) or, after
	// "✦ Konten vorschlagen", what the model named; "Übernehmen" confirms it
	// for this payment, with the BU key the books know for it. Nothing is
	// confirmed by itself. The payment's own page has the whole block
	// (BookingBlock.svelte): the key, the reason at length, what was sent.
	import { untrack } from 'svelte';
	import AiMark from '../AiMark.svelte';
	import { app, currentStore, refreshNow } from '../session.svelte.js';
	import { t } from '../i18n/index.js';
	import { confirmBooking } from './actions.js';
	import { listAssist, suggestFor } from './list-assist.svelte.js';
	import { catalogueAccount, isAccountNumber } from './skr03.js';
	import { accountRuleOf } from './suggest.js';

	/** @type {{ tx: Record<string, any> & { id: string }, listId: string }} `listId`: the page's datalist of accounts */
	let { tx, listId } = $props();

	let suggestion = $derived(suggestFor(tx, app));
	let pick = $derived(listAssist.picks[tx.id] ?? null);
	// The books' own suggestion first: it is what the person taught them.
	let offered = $derived(suggestion.account ?? pick?.account ?? '');
	let fromAi = $derived(!suggestion.account && Boolean(pick?.account));

	let text = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	// A new suggestion fills the field; what the person typed stays otherwise.
	let seed = $derived(`${tx.id}|${offered}`);
	$effect(() => {
		void seed;
		untrack(() => {
			if (offered) text = offered;
			error = null;
		});
	});

	let number = $derived(/^\s*(\d{4,8})(?:\s|$)/.exec(text)?.[1] ?? text.trim());
	let known = $derived(catalogueAccount(number, app.chart));
	// A share on the account that was typed for the expense cannot be: left out.
	let shareOk = $derived(
		Boolean(suggestion.privateShare) && suggestion.privateShare?.account !== number
	);
	let why = $derived(
		fromAi && number === pick?.account
			? `${t(`booking.ai.confidence.${pick?.confidence}`)} – ${pick?.reason}`
			: suggestion.account && number === suggestion.account
				? suggestion.source === 'learned' && suggestion.vendor
					? t('booking.source.learnedFrom', { vendor: suggestion.vendor })
					: suggestion.source
						? t(`booking.source.${suggestion.source}`)
						: ''
				: ''
	);

	async function take() {
		const store = currentStore();
		if (!store) return;
		if (!isAccountNumber(number)) {
			error = t('booking.invalidAccount');
			return;
		}
		busy = true;
		error = null;
		try {
			await confirmBooking(
				/** @type {any} */ (store),
				tx.id,
				{
					account: number,
					taxKey: suggestion.taxKey,
					// The suggested private share goes with it (private-share.js), as the
					// row says; without one nothing is said about shares – changing or
					// removing one is done on the payment's own page.
					...(shareOk ? { privateShare: suggestion.privateShare } : {})
				},
				{ rule: accountRuleOf(tx, app.classifications[tx.id] ?? null) }
			);
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 text-sm"
	data-testid="account-suggest"
	data-tx={tx.id}
	data-from={fromAi ? 'ai' : suggestion.account ? 'books' : 'none'}
>
	<label class="flex items-center gap-2">
		<span class="text-faint">{t('booking.account')}</span>
		<input
			class="w-28 rounded-md border px-2 py-1 font-mono text-sm"
			list={listId}
			inputmode="numeric"
			autocomplete="off"
			bind:value={text}
			placeholder={t('zahlungen.suggest.placeholder')}
			data-testid="account-suggest-input"
		/>
	</label>
	<button
		type="button"
		class="rounded-md border border-border px-2 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
		disabled={busy || !isAccountNumber(number)}
		onclick={take}
		data-testid="account-suggest-take">{t('zahlungen.suggest.take')}</button
	>
	<span class="min-w-0 flex-1 truncate text-xs text-faint" data-testid="account-suggest-why">
		{#if known}<span class="text-text">{known.name}</span>{/if}
		{#if why}
			{#if known}&nbsp;·&#32;{/if}{#if fromAi && number === pick?.account}<AiMark />{/if}{why}
		{:else if pick && !pick.account && !suggestion.account}
			{t('zahlungen.suggest.none')}
		{/if}
		{#if shareOk}
			<span data-testid="account-suggest-share"
				>&nbsp;·&#32;{t('zahlungen.suggest.share', {
					percent: suggestion.privateShare?.percent ?? 0,
					account: suggestion.privateShare?.account ?? ''
				})}</span
			>
		{/if}
	</span>
	{#if error}
		<span class="basis-full text-xs text-danger" role="alert" data-testid="account-suggest-error"
			>{error}</span
		>
	{/if}
</div>
