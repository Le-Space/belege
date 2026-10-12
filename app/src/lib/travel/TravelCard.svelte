<script>
	// A receipt and travel (issue #213, step 3): "Zu einer Reise …" assigns it
	// to a trip with who paid it, or starts a new trip from it; a restaurant
	// bill takes its hospitality details, with or without a trip. Nothing is
	// assigned by itself: a ticket only says that it looks like travel.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import {
		PAID_BY,
		assignReceipt,
		ownerTraveller,
		saveTrip,
		setHospitality,
		unassignReceipt
	} from './records.js';
	import {
		allTrips,
		euroCents,
		hospitalityOf,
		travelHint,
		travelKind,
		tripFromReceipt,
		paidByGuess,
		suggestTrips,
		tripDays
	} from './view.js';

	/** @type {{ receipt: Record<string, any> }} */
	let { receipt } = $props();

	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';

	let trips = $derived(allTrips(app.travel));
	let trip = $derived(trips.find((x) => x.id === receipt.travel?.tripId) ?? null);
	let suggested = $derived(suggestTrips(receipt, trips));
	let others = $derived(trips.filter((x) => !suggested.includes(x)).reverse());

	let open = $state(false);
	let tripId = $state('');
	/** @type {'private' | 'company'} */
	let paidBy = $state('private');
	let editHospitality = $state(false);
	let place = $state('');
	let participants = $state('');
	let occasion = $state('');
	let tip = $state('');
	let tipTo = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another receipt: the forms closed. By its id only, not on every rewrite of the same one.
	let receiptId = $derived(String(receipt.id));
	$effect(() => {
		void receiptId;
		open = false;
		editHospitality = false;
		error = null;
	});

	/** @param {Record<string, any>} x */
	const tripLine = (x) =>
		[x.destination || t('reisen.untitled'), tripDays(x, formatDate)].filter(Boolean).join(' · ');

	function start() {
		open = true;
		error = null;
		tripId = suggested[0]?.id ?? others[0]?.id ?? '';
		paidBy = paidByGuess(receipt, app);
	}

	/** @param {() => Promise<unknown>} work */
	async function run(work) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await work();
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const assign = () =>
		run(async () => {
			await assignReceipt(/** @type {any} */ (currentStore()), {
				receiptId: receipt.id,
				tripId,
				paidBy
			});
			open = false;
		});

	/** A new trip from this receipt: its times and destination as read, the rest to fill in on the trip's page. */
	const newTrip = () =>
		run(async () => {
			const store = /** @type {any} */ (currentStore());
			const traveller = await ownerTraveller(store, cleanDatevSettings(app.datevSettings));
			const { trip: made } = await saveTrip(store, {
				travellerId: traveller.id,
				...tripFromReceipt(receipt)
			});
			await assignReceipt(store, { receiptId: receipt.id, tripId: made.id, paidBy });
			await goto(`${resolve('/reisen/[id]', { id: made.id })}`);
		});

	/** @param {'private' | 'company'} value */
	const changePaidBy = (value) =>
		run(() =>
			assignReceipt(/** @type {any} */ (currentStore()), {
				receiptId: receipt.id,
				tripId: receipt.travel.tripId,
				paidBy: value
			})
		);

	const unassign = () =>
		run(() => unassignReceipt(/** @type {any} */ (currentStore()), receipt.id));

	function startHospitality() {
		const h = receipt.hospitality ?? {};
		place = h.place ?? '';
		participants = (h.participants ?? []).join('\n');
		occasion = h.occasion ?? '';
		tip = h.tipCents ? (h.tipCents / 100).toFixed(2).replace('.', ',') : '';
		tipTo = h.tipTo ?? '';
		editHospitality = true;
		error = null;
	}

	function saveHospitality() {
		const tipCents = tip.trim() ? euroCents(tip) : 0;
		if (tipCents === null) {
			error = t('belege.travel.hospitality.badTip');
			return;
		}
		return run(async () => {
			await setHospitality(/** @type {any} */ (currentStore()), receipt.id, {
				place,
				participants: participants.split('\n'),
				occasion,
				tipCents,
				tipTo
			});
			editHospitality = false;
		});
	}

	const dropHospitality = () =>
		run(() => setHospitality(/** @type {any} */ (currentStore()), receipt.id, null));

	let split = $derived(receipt.hospitality ? hospitalityOf(receipt) : null);
	let hint = $derived(travelHint(receipt));
	let kind = $derived(travelKind(receipt));

	/** `2026-03-04T07:12` → `04.03.2026 07:12`. @param {string | null | undefined} v */
	const when = (v) => (v ? `${formatDate(v.slice(0, 10))} ${v.slice(11, 16)}` : '');
	/** What was read about the journey or the stay, in one line. */
	let readLine = $derived.by(() => {
		const r = receipt.extraction?.travel;
		if (!r || !kind || kind === 'ticket') return '';
		const route = r.from || r.to ? `${r.from ?? '…'} → ${r.to ?? '…'}` : '';
		const out = [r.departure, r.arrival].filter(Boolean).map(when).join(' – ');
		const back = [r.return_departure, r.return_arrival].filter(Boolean).map(when).join(' – ');
		const stay =
			r.check_in && r.check_out
				? `${formatDate(r.check_in)} – ${formatDate(r.check_out)}`
				: r.check_in
					? formatDate(r.check_in)
					: '';
		return [
			t(`belege.travel.kind.${kind}`),
			route,
			out,
			back ? t('belege.travel.readBack', { when: back }) : '',
			r.place && !route ? r.place : '',
			stay,
			r.nights ? t('belege.travel.readNights', { count: r.nights }) : '',
			r.breakfast_included === true ? t('belege.travel.readBreakfast') : ''
		]
			.filter(Boolean)
			.join(' · ');
	});
	let offered = $derived(!receipt.deleted && receipt.status !== 'ignoriert');
</script>

{#if offered}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="travel">
		{#if readLine}
			<p class="mb-2 text-xs text-faint" data-testid="travel-read">{readLine}</p>
		{/if}
		{#if trip}
			<p class="text-heading" data-testid="travel-assigned">
				{t('belege.travel.assigned')}
				<a
					class="underline"
					href={resolve('/reisen/[id]', { id: trip.id })}
					data-testid="travel-trip-link">{tripLine(trip)}</a
				>
			</p>
			<label class="mt-1 block text-text"
				>{t('belege.travel.paidBy')}
				<select
					class="ml-2 {field}"
					value={receipt.travel.paidBy}
					onchange={(e) => changePaidBy(/** @type {any} */ (e.currentTarget.value))}
					disabled={busy}
					data-testid="travel-paid-by"
				>
					{#each PAID_BY as p (p)}
						<option value={p}>{t(`belege.travel.paid.${p}`)}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class={btn.link}
				onclick={unassign}
				disabled={busy}
				data-testid="travel-unassign">{t('belege.travel.unassign')}</button
			>
		{:else if !open}
			<button type="button" class={btn.secondary} onclick={start} data-testid="travel-open"
				>{t('belege.travel.open')}</button
			>
			{#if hint === 'trip' || hint === 'event'}
				<p class="mt-1 text-xs text-faint" data-testid="travel-looks-like">
					{t(hint === 'event' ? 'belege.travel.looksLikeEvent' : 'belege.travel.looksLikeTrip', {
						kind: t(`belege.travel.kind.${kind}`)
					})}
				</p>
			{/if}
		{:else}
			<form
				class="flex flex-col gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void assign();
				}}
				data-testid="travel-form"
			>
				{#if trips.length}
					<label class="text-text"
						>{t('belege.travel.trip')}
						<select class="ml-2 max-w-full {field}" bind:value={tripId} data-testid="travel-trip">
							{#if suggested.length}
								<optgroup label={t('belege.travel.suggested')}>
									{#each suggested as x (x.id)}
										<option value={x.id}>{tripLine(x)}</option>
									{/each}
								</optgroup>
							{/if}
							{#if others.length}
								<optgroup label={t('belege.travel.otherTrips')}>
									{#each others as x (x.id)}
										<option value={x.id}>{tripLine(x)}</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					</label>
				{/if}
				<label class="text-text"
					>{t('belege.travel.paidBy')}
					<select class="ml-2 {field}" bind:value={paidBy} data-testid="travel-form-paid-by">
						{#each PAID_BY as p (p)}
							<option value={p}>{t(`belege.travel.paid.${p}`)}</option>
						{/each}
					</select>
				</label>
				<div class="flex flex-wrap gap-2">
					{#if trips.length}
						<button
							type="submit"
							class={btn.primary}
							disabled={busy || !tripId}
							data-testid="travel-assign">{t('belege.travel.assign')}</button
						>
					{/if}
					<button
						type="button"
						class={btn.secondary}
						onclick={newTrip}
						disabled={busy}
						data-testid="travel-new-trip">{t('belege.travel.newTrip')}</button
					>
					<button type="button" class={btn.link} onclick={() => (open = false)}
						>{t('belege.travel.cancel')}</button
					>
				</div>
			</form>
		{/if}

		<div class="mt-3" data-testid="hospitality">
			{#if editHospitality}
				<form
					class="flex flex-col gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						void saveHospitality();
					}}
					data-testid="hospitality-form"
				>
					<p class="text-xs text-faint">{t('belege.travel.hospitality.what')}</p>
					<label class="flex flex-col text-text"
						>{t('belege.travel.hospitality.place')}
						<input class={field} bind:value={place} data-testid="hospitality-place" />
					</label>
					<label class="flex flex-col text-text"
						>{t('belege.travel.hospitality.participants')}
						<textarea
							class={field}
							rows="3"
							bind:value={participants}
							data-testid="hospitality-participants"
						></textarea>
					</label>
					<label class="flex flex-col text-text"
						>{t('belege.travel.hospitality.occasion')}
						<input class={field} bind:value={occasion} data-testid="hospitality-occasion" />
					</label>
					<div class="flex flex-wrap gap-2">
						<label class="flex flex-col text-text"
							>{t('belege.travel.hospitality.tip')}
							<input
								class="w-28 {field}"
								inputmode="decimal"
								bind:value={tip}
								data-testid="hospitality-tip"
							/>
						</label>
						<label class="flex flex-col text-text"
							>{t('belege.travel.hospitality.tipTo')}
							<input class={field} bind:value={tipTo} data-testid="hospitality-tip-to" />
						</label>
					</div>
					<div class="flex flex-wrap gap-2">
						<button type="submit" class={btn.primary} disabled={busy} data-testid="hospitality-save"
							>{t('belege.travel.hospitality.save')}</button
						>
						<button type="button" class={btn.link} onclick={() => (editHospitality = false)}
							>{t('belege.travel.cancel')}</button
						>
					</div>
				</form>
			{:else if receipt.hospitality && split}
				<p class="font-medium text-heading">{t('belege.travel.hospitality.title')}</p>
				<p class="text-text" data-testid="hospitality-summary">
					{[receipt.hospitality.place, receipt.hospitality.occasion].filter(Boolean).join(' · ') ||
						'—'}
				</p>
				<p class="text-xs text-faint" data-testid="hospitality-split">
					{t('belege.travel.hospitality.split', {
						deductible: formatMoney(split.deductibleCents, 'EUR'),
						rest: formatMoney(split.nonDeductibleCents, 'EUR'),
						vat: formatMoney(split.inputVatCents, 'EUR')
					})}
				</p>
				{#if split.missing.length}
					<p class="text-xs text-danger" data-testid="hospitality-missing">
						{t('belege.travel.hospitality.missing', {
							what: split.missing.map((m) => t(`belege.travel.hospitality.${m}`)).join(', ')
						})}
					</p>
				{/if}
				<div class="flex flex-wrap gap-3">
					<button
						type="button"
						class={btn.link}
						onclick={startHospitality}
						data-testid="hospitality-edit">{t('belege.travel.hospitality.edit')}</button
					>
					<button
						type="button"
						class={btn.link}
						onclick={dropHospitality}
						disabled={busy}
						data-testid="hospitality-remove">{t('belege.travel.hospitality.remove')}</button
					>
				</div>
			{:else}
				<button
					type="button"
					class={hint === 'hospitality' ? btn.secondary : btn.link}
					onclick={startHospitality}
					data-testid="hospitality-open">{t('belege.travel.hospitality.open')}</button
				>
				{#if hint === 'hospitality'}
					<p class="mt-1 text-xs text-faint" data-testid="hospitality-looks-like">
						{t('belege.travel.hospitality.looksLike')}
					</p>
				{/if}
			{/if}
		</div>
		{#if error}<p class="text-danger" role="alert">{error}</p>{/if}
	</div>
{/if}
