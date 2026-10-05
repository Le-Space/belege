<script>
	// "Privat ausgelegt …" on a receipt (issue #293): the receipt paid
	// privately – in cash, with a private card – booked on the outlay account
	// and linked to it (outlays.js). Another currency needs a rate: the ECB's
	// of the day where the bridge has one, else one from a document (the card
	// statement, an exchange receipt), entered here. Once booked: what was
	// booked, and the way back.
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { matchOfReceipt } from '$lib/matching/view.js';
	import { needsConfirmation } from '$lib/receipts/import.js';
	import { receiptDate } from '$lib/receipts/view.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { HOW, bookOutlay, euroCents, isOutlay, outlayAmount, undoOutlay } from './outlays.js';

	/** @type {{ receipt: Record<string, any>, client: { rate: (asset: string, date: string) => Promise<any> } | null }} */
	let { receipt, client } = $props();

	let booked = $derived(
		app.transactions.find(
			(tx) => isOutlay(tx) && !tx.deleted && tx.outlay?.receiptId === receipt.id
		) ?? null
	);
	let amount = $derived(outlayAmount(receipt));
	let offered = $derived(
		!booked &&
			Boolean(amount) &&
			!matchOfReceipt(receipt.id, app.matches) &&
			!needsConfirmation(receipt) &&
			receipt.status !== 'ignoriert'
	);

	let open = $state(false);
	/** @type {'cash' | 'card' | 'other'} */
	let how = $state('cash');
	let day = $state('');
	let rate = $state('');
	/** @type {'ecb' | 'manual'} */
	let rateSource = $state('manual');
	let rateAt = $state('');
	let rateNote = $state('');
	let note = $state('');
	let asking = $state(false);
	let noEcb = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// A new receipt: the form closed and empty.
	$effect(() => {
		void receipt.id;
		open = false;
		error = null;
	});

	let foreign = $derived(Boolean(amount && amount.currency !== 'EUR'));
	let rateValue = $derived(rate.trim().replace(',', '.'));
	let euros = $derived.by(() => {
		if (!amount) return null;
		if (!foreign) return amount.amountCents;
		try {
			return euroCents(amount.amountCents, rateValue);
		} catch {
			return null;
		}
	});

	async function start() {
		open = true;
		error = null;
		day = receiptDate(/** @type {any} */ (receipt)) ?? '';
		rate = '';
		rateSource = 'manual';
		rateAt = '';
		noEcb = false;
		if (foreign) await askEcb();
	}

	async function askEcb() {
		if (!client || !amount || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
			noEcb = true;
			return;
		}
		asking = true;
		try {
			const r = await client.rate(amount.currency, day);
			if (r?.source === 'ecb' && Number(r.rate) > 0) {
				rate = String(r.rate);
				rateSource = 'ecb';
				rateAt = String(r.at ?? '');
				noEcb = false;
			} else noEcb = true;
		} catch {
			noEcb = true;
		} finally {
			asking = false;
		}
	}

	async function book() {
		/** @type {any} */
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await bookOutlay({
				store,
				settings: cleanDatevSettings(app.datevSettings),
				receipt: $state.snapshot(receipt),
				how,
				day,
				rate: foreign
					? {
							rate: rateValue,
							source: rateSource,
							...(rateSource === 'ecb' && rateAt ? { at: rateAt } : {}),
							...(rateSource === 'manual' && rateNote.trim() ? { note: rateNote.trim() } : {})
						}
					: null,
				note
			});
			open = false;
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function undo() {
		/** @type {any} */
		const store = currentStore();
		if (!store || !booked) return;
		busy = true;
		error = null;
		try {
			await undoOutlay(store, booked.id);
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';
</script>

{#if booked}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="outlay-booked">
		<p class="text-heading">
			{t('belege.outlay.booked', {
				date: formatDate(booked.bookedOn),
				how: t(`belege.outlay.how.${booked.outlay?.how ?? 'other'}`),
				amount: formatMoney(Math.abs(booked.amountCents ?? 0), 'EUR')
			})}
		</p>
		{#if booked.original}
			<p class="text-xs text-faint" data-testid="outlay-booked-rate">
				{t('belege.outlay.bookedRate', {
					original: booked.original.amount.replace('-', ''),
					currency: booked.original.currency,
					rate: booked.original.rate,
					source: t(`belege.outlay.rateSource.${booked.outlay?.rateSource ?? 'manual'}`)
				})}{booked.outlay?.rateNote ? ` · ${booked.outlay.rateNote}` : ''}
			</p>
		{/if}
		<button
			type="button"
			class="mt-1 {btn.link}"
			onclick={undo}
			disabled={busy}
			data-testid="outlay-undo">{t('belege.outlay.undo')}</button
		>
		{#if error}<p class="text-danger" role="alert">{error}</p>{/if}
	</div>
{:else if offered}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="outlay">
		{#if !open}
			<button type="button" class={btn.secondary} onclick={start} data-testid="outlay-open"
				>{t('belege.outlay.open')}</button
			>
			<p class="mt-1 text-xs text-faint">{t('belege.outlay.hint')}</p>
		{:else}
			<form
				class="flex flex-col gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void book();
				}}
				data-testid="outlay-form"
			>
				<label class="text-text"
					>{t('belege.outlay.howLabel')}
					<select class="ml-2 {field}" bind:value={how} data-testid="outlay-how">
						{#each HOW as h (h)}
							<option value={h}>{t(`belege.outlay.how.${h}`)}</option>
						{/each}
					</select>
				</label>
				<label class="text-text"
					>{t('belege.outlay.day')}
					<input
						type="date"
						class="ml-2 {field}"
						bind:value={day}
						onchange={() => foreign && rateSource === 'ecb' && askEcb()}
						data-testid="outlay-day"
					/>
				</label>
				{#if amount}
					<p class="text-text" data-testid="outlay-amount">
						{t('belege.outlay.amount', {
							amount: formatMoney(amount.amountCents, amount.currency)
						})}
					</p>
				{/if}
				{#if foreign && amount}
					<label class="text-text"
						>{t('belege.outlay.rate', { currency: amount.currency })}
						<input
							class="ml-2 w-28 {field}"
							inputmode="decimal"
							bind:value={rate}
							oninput={() => (rateSource = 'manual')}
							placeholder="0,0105"
							data-testid="outlay-rate"
						/>
					</label>
					{#if asking}
						<p class="text-xs text-faint">{t('belege.outlay.asking')}</p>
					{:else if rateSource === 'ecb'}
						<p class="text-xs text-faint" data-testid="outlay-rate-ecb">
							{t('belege.outlay.ecb', { date: formatDate(String(rateAt || day).slice(0, 10)) })}
						</p>
					{:else}
						{#if noEcb}
							<p class="text-xs text-text" data-testid="outlay-no-ecb">
								{t('belege.outlay.noEcb', { currency: amount.currency })}
							</p>
						{/if}
						<label class="text-xs text-text"
							>{t('belege.outlay.rateNote')}
							<input
								class="mt-1 block w-full {field}"
								bind:value={rateNote}
								placeholder={t('belege.outlay.rateNotePlaceholder')}
								data-testid="outlay-rate-note"
							/>
						</label>
					{/if}
				{/if}
				<label class="text-xs text-text"
					>{t('belege.outlay.note')}
					<input class="mt-1 block w-full {field}" bind:value={note} data-testid="outlay-note" />
				</label>
				<p class="text-heading" data-testid="outlay-euros">
					{euros === null
						? t('belege.outlay.needsRate')
						: t('belege.outlay.euros', { amount: formatMoney(euros, 'EUR') })}
				</p>
				<div class="flex gap-2">
					<button
						type="submit"
						class={btn.primary}
						disabled={busy || euros === null || !day}
						data-testid="outlay-book">{t('belege.outlay.book')}</button
					>
					<button type="button" class={btn.link} onclick={() => (open = false)}
						>{t('belege.outlay.cancel')}</button
					>
				</div>
				{#if error}<p class="text-danger" role="alert" data-testid="outlay-error">{error}</p>{/if}
			</form>
		{/if}
	</div>
{/if}
