<script>
	// One trip (issue #213, step 3): its head, the countries it crossed, the
	// meals provided, its mileage lines, the receipts assigned to it, and what
	// it comes to by the rules (travel/allowance.js, mileage.js). What it still
	// lacks is named; it is saved all the same.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptDate, receiptVendor } from '$lib/receipts/view.js';
	import { btn, card } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import {
		VEHICLES,
		VEHICLE_TYPES,
		cleanTrip,
		deleteTrip,
		saveTrip,
		tripDates,
		tripFigures
	} from '$lib/travel/records.js';
	import { allTrips, breakfastProposals, euroOf, receiptsOfTrip } from '$lib/travel/view.js';
	import { appointmentsOn } from '$lib/travel/appointments.js';
	import ReceiptPeek from '$lib/ReceiptPeek.svelte';
	import PeekLink from '$lib/receipts/PeekLink.svelte';
	import { createPeek } from '$lib/receipts/peek.js';

	const MEALS = /** @type {const} */ (['breakfast', 'lunch', 'dinner']);
	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';

	let id = $derived(String(page.params.id));
	let stored = $derived(app.travel.find((r) => r.id === id && r.kind === 'trip' && !r.deleted));

	/** @type {Record<string, any> | null} */
	let draft = $state(null);
	let dirty = $state(false);
	// Another trip, or this one first loaded: the form from the books. Not on
	// every refresh, so what is being typed stays.
	$effect(() => {
		void id;
		dirty = false;
	});
	$effect(() => {
		if (stored && !dirty) draft = structuredClone($state.snapshot(stored));
	});

	const touch = () => (dirty = true);

	let problems = $derived(draft ? cleanTrip(draft).problems : []);
	let figures = $derived(
		draft
			? tripFigures(
					cleanTrip(draft).trip,
					allTrips(app.travel).filter((x) => x.travellerId === draft?.travellerId)
				)
			: null
	);
	let receipts = $derived(receiptsOfTrip(app.receipts, id));
	// In euros (euroOf): a receipt in another currency by its payment, its outlay or a rate.
	let euros = $derived(new Map(receipts.map((r) => [r.id, euroOf(r, app)])));
	let paid = $derived({
		// Booked as outlays (#293): paid back through the outlay account, not here.
		private: receipts
			.filter((r) => r.travel?.paidBy === 'private' && euros.get(r.id)?.via !== 'outlay')
			.reduce((s, r) => s + (euros.get(r.id)?.cents ?? 0), 0),
		company: receipts
			.filter((r) => r.travel?.paidBy === 'company')
			.reduce((s, r) => s + (euros.get(r.id)?.cents ?? 0), 0),
		withoutRate: receipts.filter((r) => euros.get(r.id)?.cents === null).length
	});

	/** The trip's dates, for the meals provided; three months at most. */
	let dates = $derived(draft ? tripDates(draft).slice(0, 92) : []);

	/** Appointments from invitations on the trip's days (step 4c): its occasion, a click away. */
	let appointments = $derived.by(() => {
		const d = /** @type {Record<string, any> | null} */ (draft);
		if (!d?.start || !d?.end || d.end <= d.start) return [];
		return appointmentsOn(app.travel, d.start.slice(0, 10), d.end.slice(0, 10));
	});
	/** @param {Record<string, any>} a */
	function takeReason(a) {
		if (!draft) return;
		draft.reason = String(a.summary ?? '');
		touch();
	}

	/** Breakfasts a hotel invoice of the trip includes, not marked yet. */
	let breakfasts = $derived(draft ? breakfastProposals(draft, receipts) : []);
	function takeBreakfasts() {
		for (const date of breakfasts) setMeal(date, 'breakfast', true);
	}

	/** @param {string} date @param {'breakfast' | 'lunch' | 'dinner'} meal @param {boolean} on */
	function setMeal(date, meal, on) {
		if (!draft) return;
		const m = { breakfast: false, lunch: false, dinner: false, ...(draft.meals?.[date] ?? {}) };
		m[meal] = on;
		draft.meals = { ...(draft.meals ?? {}), [date]: m };
		touch();
	}

	function addStop() {
		if (!draft) return;
		draft.stops = [...(draft.stops ?? []), { at: draft.start || '', country: '' }];
		touch();
	}
	/** @param {number} i */
	function removeStop(i) {
		if (!draft) return;
		draft.stops = draft.stops.filter((/** @type {any} */ _, /** @type {number} */ j) => j !== i);
		touch();
	}

	function addLine() {
		if (!draft) return;
		draft.mileage = [
			...(draft.mileage ?? []),
			{
				id: crypto.randomUUID(),
				date: draft.start ? draft.start.slice(0, 10) : '',
				from: '',
				to: draft.destination ?? '',
				reason: '',
				km: 0,
				roundTrip: true,
				vehicle: 'own',
				type: 'car'
			}
		];
		touch();
	}
	/** @param {string} lineId */
	function removeLine(lineId) {
		if (!draft) return;
		draft.mileage = draft.mileage.filter((/** @type {any} */ l) => l.id !== lineId);
		touch();
	}

	// The hover preview of the trip's receipts (#273, receipts/peek.js).
	/** @type {{ receipt: Record<string, any>, anchor: HTMLElement } | null} */
	let peeked = $state(null);
	const peek = createPeek({
		onchange: (v) =>
			(peeked = /** @type {{ receipt: Record<string, any>, anchor: HTMLElement } | null} */ (v))
	});

	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	let saved = $state(false);

	async function save() {
		const store = currentStore();
		if (!store || !draft) return;
		busy = true;
		error = null;
		try {
			const stops = (draft.stops ?? []).map((/** @type {any} */ s) => ({
				...s,
				country: String(s.country ?? '')
					.trim()
					.toUpperCase()
			}));
			await saveTrip(store, { ...$state.snapshot(draft), stops });
			await refreshNow();
			dirty = false;
			saved = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		const store = currentStore();
		if (!store || !confirm(t('reise.deleteConfirm'))) return;
		busy = true;
		try {
			await deleteTrip(store, id);
			await refreshNow();
			await goto(resolve('/reisen'));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}

	/** @param {string} p */
	function problemText(p) {
		const m = /^mileage:[^:]+:(\w+)$/.exec(p);
		return m ? t(`reise.problems.mileage.${m[1]}`) : t(`reise.problems.${p}`);
	}
	let shownProblems = $derived([
		...new Set(problems.filter((p) => p !== 'noTraveller').map(problemText))
	]);
</script>

<svelte:head><title>{t('reise.title')} · Belege</title></svelte:head>

{#if peeked}
	<ReceiptPeek
		receipt={peeked.receipt}
		anchor={peeked.anchor}
		title={receiptVendor(/** @type {any} */ (peeked.receipt))}
		detail={[
			peeked.receipt.amountCents != null
				? formatMoney(Math.abs(peeked.receipt.amountCents), peeked.receipt.currency ?? 'EUR')
				: '',
			((d) => (d ? formatDate(d) : ''))(receiptDate(/** @type {any} */ (peeked.receipt)))
		]
			.filter(Boolean)
			.join(' · ')}
		onenter={() => peek.stay()}
		onleave={() => peek.leave()}
		onscrolled={() => peek.scrolled()}
		onclose={() => peek.close()}
	/>
{/if}

<p class="text-sm"><a class="underline" href={resolve('/reisen')}>{t('reise.back')}</a></p>

{#if !draft}
	<p class="mt-4 text-sm text-faint" data-testid="reise-missing">{t('reise.missing')}</p>
{:else}
	<h1 class="mt-2 text-2xl font-bold break-words text-heading" data-testid="reise-title">
		{draft.destination || t('reisen.untitled')}
	</h1>
	<p class="mt-1 text-xs text-faint">{t('reisen.adviser')}</p>

	<form
		class="flex flex-col"
		oninput={touch}
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
		data-testid="reise-form"
	>
		<section class={card} aria-labelledby="reise-head-h">
			<h2 id="reise-head-h" class="text-sm font-semibold text-heading">{t('reise.head')}</h2>
			<div class="mt-2 grid gap-3 sm:grid-cols-2">
				<label class="flex flex-col text-sm text-text"
					>{t('reise.destination')}
					<input class={field} bind:value={draft.destination} data-testid="reise-destination" />
				</label>
				<label class="flex flex-col text-sm text-text"
					>{t('reise.reason')}
					<input class={field} bind:value={draft.reason} data-testid="reise-reason" />
				</label>
				<label class="flex flex-col text-sm text-text"
					>{t('reise.start')}
					<input
						type="datetime-local"
						class={field}
						bind:value={draft.start}
						data-testid="reise-start"
					/>
				</label>
				<label class="flex flex-col text-sm text-text"
					>{t('reise.end')}
					<input
						type="datetime-local"
						class={field}
						bind:value={draft.end}
						data-testid="reise-end"
					/>
				</label>
				<label class="flex flex-col text-sm text-text"
					>{t('reise.place')}
					<input class={field} bind:value={draft.place} data-testid="reise-place" />
					<span class="mt-1 text-xs text-faint">{t('reise.placeHint')}</span>
				</label>
				<label class="flex flex-col text-sm text-text"
					>{t('reise.overnight')}
					<select
						class={field}
						value={draft.overnight === null || draft.overnight === undefined
							? 'auto'
							: draft.overnight
								? 'yes'
								: 'no'}
						onchange={(e) => {
							if (!draft) return;
							const v = e.currentTarget.value;
							draft.overnight = v === 'auto' ? null : v === 'yes';
							touch();
						}}
						data-testid="reise-overnight"
					>
						<option value="auto">{t('reise.overnightAuto')}</option>
						<option value="yes">{t('reise.overnightYes')}</option>
						<option value="no">{t('reise.overnightNo')}</option>
					</select>
				</label>
			</div>
			{#if appointments.length}
				<div class="mt-3 text-sm" data-testid="reise-appointments">
					<p class="text-xs text-faint">{t('reise.appointments')}</p>
					<ul>
						{#each appointments as a (a.id)}
							<li class="flex flex-wrap items-center gap-2" data-testid="reise-appointment">
								<span class="text-heading">{a.summary || '—'}</span>
								<span class="text-xs text-faint">{a.location}</span>
								{#if a.summary && draft.reason !== a.summary}
									<button
										type="button"
										class={btn.link}
										onclick={() => takeReason(a)}
										data-testid="reise-appointment-take">{t('reise.appointmentTake')}</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<label class="mt-3 flex flex-col text-sm text-text"
				>{t('reise.note')}
				<textarea class={field} rows="2" bind:value={draft.note} data-testid="reise-note"
				></textarea>
			</label>
		</section>

		<section class={card} aria-labelledby="reise-abroad-h">
			<h2 id="reise-abroad-h" class="text-sm font-semibold text-heading">{t('reise.abroad')}</h2>
			<p class="mt-1 text-xs text-faint">{t('reise.abroadHint')}</p>
			{#each draft.stops ?? [] as stop, i (i)}
				<div class="mt-2 flex flex-wrap items-end gap-2" data-testid="reise-stop">
					<label class="flex flex-col text-sm text-text"
						>{t('reise.stopAt')}
						<input type="datetime-local" class={field} bind:value={stop.at} />
					</label>
					<label class="flex flex-col text-sm text-text"
						>{t('reise.stopCountry')}
						<input
							class="w-20 uppercase {field}"
							maxlength="2"
							bind:value={stop.country}
							data-testid="reise-stop-country"
						/>
					</label>
					<button type="button" class={btn.link} onclick={() => removeStop(i)}
						>{t('reise.remove')}</button
					>
				</div>
			{/each}
			<button
				type="button"
				class="mt-2 {btn.secondary}"
				onclick={addStop}
				data-testid="reise-add-stop">{t('reise.addStop')}</button
			>
		</section>

		{#if dates.length}
			<section class={card} aria-labelledby="reise-meals-h" data-testid="reise-meals">
				<h2 id="reise-meals-h" class="text-sm font-semibold text-heading">{t('reise.meals')}</h2>
				<p class="mt-1 text-xs text-faint">{t('reise.mealsHint')}</p>
				{#if breakfasts.length}
					<p class="mt-2 text-sm text-heading" data-testid="reise-breakfast-proposal">
						{t('reise.breakfastProposal', {
							days: breakfasts.map((d) => formatDate(d)).join(', ')
						})}
						<button
							type="button"
							class="ml-1 {btn.link}"
							onclick={takeBreakfasts}
							data-testid="reise-breakfast-take">{t('reise.breakfastTake')}</button
						>
					</p>
				{/if}
				<div class="mt-2 overflow-x-auto">
					<table class="text-sm">
						<thead>
							<tr class="text-left text-xs text-faint">
								<th class="py-1 pr-2 font-normal sm:pr-4">{t('reise.day')}</th>
								{#each MEALS as meal (meal)}
									<th class="px-1 py-1 font-normal sm:px-2">{t(`reise.meal.${meal}`)}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each dates as date (date)}
								<tr>
									<td class="py-1 pr-2 text-text sm:pr-4">{formatDate(date)}</td>
									{#each MEALS as meal (meal)}
										<td class="px-1 py-1 text-center sm:px-2">
											<input
												type="checkbox"
												class="size-5"
												aria-label={`${formatDate(date)}: ${t(`reise.meal.${meal}`)}`}
												checked={draft.meals?.[date]?.[meal] === true}
												onchange={(e) => setMeal(date, meal, e.currentTarget.checked)}
												data-testid={`reise-meal-${date}-${meal}`}
											/>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<section class={card} aria-labelledby="reise-mileage-h" data-testid="reise-mileage">
			<h2 id="reise-mileage-h" class="text-sm font-semibold text-heading">{t('reise.mileage')}</h2>
			<p class="mt-1 text-xs text-faint">{t('reise.mileageHint')}</p>
			{#each draft.mileage ?? [] as line (line.id)}
				{@const result = figures?.mileage.find((/** @type {any} */ l) => l.id === line.id)}
				<fieldset class="mt-3 rounded-md border border-border p-3" data-testid="reise-line">
					<legend class="px-1 text-xs text-faint">{t('reise.line')}</legend>
					<div class="grid gap-2 sm:grid-cols-3">
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineDate')}
							<input type="date" class={field} bind:value={line.date} />
						</label>
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineFrom')}
							<input class={field} bind:value={line.from} />
						</label>
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineTo')}
							<input class={field} bind:value={line.to} />
						</label>
						<label class="flex flex-col text-sm text-text sm:col-span-2"
							>{t('reise.lineReason')}
							<input class={field} bind:value={line.reason} />
						</label>
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineKm')}
							<input
								type="number"
								min="0"
								step="0.1"
								class={field}
								bind:value={line.km}
								data-testid="reise-line-km"
							/>
						</label>
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineVehicle')}
							<select class={field} bind:value={line.vehicle} data-testid="reise-line-vehicle">
								{#each VEHICLES as v (v)}
									<option value={v}>{t(`reise.vehicle.${v}`)}</option>
								{/each}
							</select>
						</label>
						<label class="flex flex-col text-sm text-text"
							>{t('reise.lineType')}
							<select class={field} bind:value={line.type}>
								{#each VEHICLE_TYPES as v (v)}
									<option value={v}>{t(`reise.vehicleType.${v}`)}</option>
								{/each}
							</select>
						</label>
						<label class="flex min-h-11 items-center gap-2 text-sm text-text">
							<input type="checkbox" class="size-5" bind:checked={line.roundTrip} />
							{t('reise.lineRoundTrip')}
						</label>
						{#if line.vehicle === 'family'}
							<label class="flex flex-col text-sm text-text"
								>{t('reise.lineOwner')}
								<input
									class={field}
									bind:value={line.owner}
									placeholder={t('reise.lineOwnerPlaceholder')}
									data-testid="reise-line-owner"
								/>
							</label>
							<label class="flex flex-col text-sm text-text"
								>{t('reise.lineCostBearer')}
								<input class={field} bind:value={line.costBearer} />
							</label>
						{/if}
					</div>
					{#if result}
						<p class="mt-2 text-sm text-heading" data-testid="reise-line-result">
							{#if result.refused}
								{t(`reise.refused.${result.refused}`)}
							{:else}
								{t('reise.lineResult', {
									km: String(result.km).replace('.', ','),
									rate: formatMoney(result.rate?.perKm ?? 0, 'EUR'),
									amount: formatMoney(result.cents, 'EUR')
								})}
							{/if}
						</p>
						{#if result.flag === 'familyCar'}
							<p class="text-xs text-danger" data-testid="reise-line-family-flag">
								{t('reise.familyCarFlag')}
							</p>
						{/if}
					{/if}
					<button type="button" class={btn.link} onclick={() => removeLine(line.id)}
						>{t('reise.remove')}</button
					>
				</fieldset>
			{/each}
			<button
				type="button"
				class="mt-3 {btn.secondary}"
				onclick={addLine}
				data-testid="reise-add-line">{t('reise.addLine')}</button
			>
		</section>

		{#if shownProblems.length}
			<ul class="list-disc pl-5 text-sm text-danger" data-testid="reise-problems">
				{#each shownProblems as p (p)}<li>{p}</li>{/each}
			</ul>
		{/if}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button type="submit" class={btn.primary} disabled={busy || !dirty} data-testid="reise-save"
				>{t('reise.save')}</button
			>
			{#if saved && !dirty}<span class="text-sm text-faint" data-testid="reise-saved"
					>{t('reise.saved')}</span
				>{/if}
			{#if error}<span class="text-sm text-danger" role="alert">{error}</span>{/if}
		</div>
	</form>

	{#if figures?.allowance}
		<section class={card} aria-labelledby="reise-allowance-h" data-testid="reise-allowance">
			<h2 id="reise-allowance-h" class="text-sm font-semibold text-heading">
				{t('reise.allowance')}
			</h2>
			<ul class="mt-2 text-sm">
				{#each figures.allowance.days as day (day.date)}
					<li
						class="flex items-start justify-between gap-3 border-t border-border py-1.5"
						data-testid="reise-allowance-day"
					>
						<span class="min-w-0">
							<span class="text-text">{formatDate(day.date)} · {day.country}</span>
							<span class="block text-xs text-faint"
								>{t(`reise.dayKind.${day.kind}`)}{#if day.reason}
									· {t(`reise.dayReason.${day.reason}`)}{/if}{#if day.cutCents}
									· {t('reise.cut', { amount: formatMoney(day.cutCents, 'EUR') })}{/if}</span
							>
						</span>
						<span class="shrink-0 font-mono tabular-nums"
							>{day.cents === null ? '—' : formatMoney(day.cents, 'EUR')}</span
						>
					</li>
				{/each}
			</ul>
			{#if figures.allowance.missing.length}
				<p class="mt-2 text-xs text-danger" data-testid="reise-allowance-missing">
					{t('reise.noRateAbroad')}
				</p>
			{/if}
		</section>
	{/if}

	<section class={card} aria-labelledby="reise-receipts-h" data-testid="reise-receipts">
		<h2 id="reise-receipts-h" class="text-sm font-semibold text-heading">{t('reise.receipts')}</h2>
		{#if receipts.length}
			<ul class="mt-2 divide-y divide-border text-sm">
				{#each receipts as r (r.id)}
					{@const e = euros.get(r.id)}
					<li>
						<PeekLink
							receipt={r}
							href={`${resolve('/belege')}?receipt=${encodeURIComponent(r.id)}`}
							{peek}
							open={peeked?.receipt.id === r.id}
							class="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-1 text-heading hover:underline"
							testid="reise-receipt"
							><span class="min-w-0 truncate"
								>{formatDate(receiptDate(/** @type {any} */ (r)) ?? '')} · {receiptVendor(
									/** @type {any} */ (r)
								)} · {t(`belege.travel.paid.${r.travel.paidBy}`)}</span
							><span class="font-mono tabular-nums" data-testid="reise-receipt-amount"
								>{#if e && e.currency !== 'EUR'}<span class="text-xs text-faint"
										>{`${formatMoney(e.originalCents ?? 0, e.currency)} → `}</span
									>{/if}{e?.cents === null || e?.cents === undefined
									? t('reise.noRate')
									: formatMoney(e.cents, 'EUR')}</span
							></PeekLink
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-faint">{t('reise.noReceipts')}</p>
		{/if}
	</section>

	<section class={card} aria-labelledby="reise-sum-h" data-testid="reise-sum">
		<h2 id="reise-sum-h" class="text-sm font-semibold text-heading">{t('reise.sum')}</h2>
		<dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
			<dt class="text-text">{t('reisen.allowances')}</dt>
			<dd class="text-right font-mono tabular-nums" data-testid="reise-sum-allowance">
				{formatMoney(figures?.allowanceCents ?? 0, 'EUR')}
			</dd>
			<dt class="text-text">{t('reisen.mileage')}</dt>
			<dd class="text-right font-mono tabular-nums" data-testid="reise-sum-mileage">
				{formatMoney(figures?.mileageCents ?? 0, 'EUR')}
			</dd>
			<dt class="text-text">{t('reise.paidPrivately')}</dt>
			<dd class="text-right font-mono tabular-nums" data-testid="reise-sum-private">
				{formatMoney(paid.private, 'EUR')}
			</dd>
			<dt class="text-text">{t('reise.paidByCompany')}</dt>
			<dd class="text-right font-mono tabular-nums" data-testid="reise-sum-company">
				{formatMoney(paid.company, 'EUR')}
			</dd>
			<dt class="font-medium text-heading">{t('reise.toPayBack')}</dt>
			<dd class="text-right font-mono font-medium tabular-nums" data-testid="reise-sum-back">
				{formatMoney(
					(figures?.allowanceCents ?? 0) + (figures?.mileageCents ?? 0) + paid.private,
					'EUR'
				)}
			</dd>
		</dl>
		<p class="mt-2 text-xs text-faint">{t('reise.sumHint')}</p>
		{#if paid.withoutRate}
			<p class="mt-1 text-xs text-danger" data-testid="reise-sum-norate">
				{t('reise.ratesMissing', { count: paid.withoutRate })}
			</p>
		{/if}
	</section>

	<button
		type="button"
		class="mt-6 {btn.link}"
		onclick={remove}
		disabled={busy}
		data-testid="reise-delete">{t('reise.delete')}</button
	>
{/if}
