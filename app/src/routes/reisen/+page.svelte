<script>
	// "Reisen" (issue #213, step 3): a month's trips with what they come to,
	// the hospitality bills of the month, and what travel still asks. Reached
	// from Belege and from Home. Above them, the trips the receipts propose
	// (step 4b, travel/proposals.js), each a click away from a trip.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import MonthPicker from '$lib/MonthPicker.svelte';
	import { app, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptDate, receiptVendor } from '$lib/receipts/view.js';
	import { btn, card } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { ownerTraveller, saveTrip, tripFigures, tripMonth } from '$lib/travel/records.js';
	import { openTravelQuestions, tripProposals } from '$lib/travel/proposals.js';
	import { acceptProposal, dismissProposal } from '$lib/travel/proposal-actions.js';
	import {
		allTrips,
		hospitalityOf,
		receiptsOfTrip,
		travelKind,
		tripDays
	} from '$lib/travel/view.js';

	const thisMonth = new Date().toISOString().slice(0, 7);
	let month = $state(
		/^\d{4}-\d{2}$/.test(page.url.searchParams.get('month') ?? '')
			? String(page.url.searchParams.get('month'))
			: thisMonth
	);

	let trips = $derived(allTrips(app.travel));
	let shown = $derived(
		trips
			.filter((x) => tripMonth(x) === month)
			.map((trip) => ({
				trip,
				figures: tripFigures(
					trip,
					trips.filter((o) => o.travellerId === trip.travellerId)
				),
				receipts: receiptsOfTrip(app.receipts, trip.id).length
			}))
	);
	let untimed = $derived(trips.filter((x) => !tripMonth(x)));
	let hospitality = $derived(
		app.receipts
			.filter(
				(r) =>
					!r.deleted &&
					r.status !== 'ignoriert' &&
					r.hospitality &&
					(receiptDate(/** @type {any} */ (r)) ?? '').startsWith(month)
			)
			.map((r) => ({ r, split: hospitalityOf(r) }))
	);
	let questions = $derived(openTravelQuestions({ travel: app.travel, receipts: app.receipts }));
	let proposals = $derived(tripProposals({ travel: app.travel, receipts: app.receipts }));
	let proposalsHere = $derived(proposals.filter((p) => p.start.slice(0, 7) === month));
	let proposalsElsewhere = $derived(proposals.length - proposalsHere.length);

	/** @param {import('$lib/travel/proposals.js').Proposal} proposal */
	async function accept(proposal) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			const tripId = await acceptProposal({
				store,
				proposal,
				settings: cleanDatevSettings(app.datevSettings),
				books: app
			});
			await refreshNow();
			await goto(resolve('/reisen/[id]', { id: tripId }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** @param {import('$lib/travel/proposals.js').Proposal} proposal */
	async function dismiss(proposal) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		try {
			await dismissProposal(store, proposal.key);
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** `2026-04-08T07:12` → `08.04.2026 07:12`; a day's 08:00 / 18:00 as the day only. @param {string} v */
	const when = (v) =>
		/T(08:00|18:00|23:59)$/.test(v)
			? formatDate(v.slice(0, 10))
			: `${formatDate(v.slice(0, 10))} ${v.slice(11)}`;
	let tripById = $derived(new Map(trips.map((x) => [x.id, x])));
	let receiptById = $derived(new Map(app.receipts.map((r) => [r.id, r])));

	let totals = $derived({
		allowance: shown.reduce((s, x) => s + x.figures.allowanceCents, 0),
		mileage: shown.reduce((s, x) => s + x.figures.mileageCents, 0),
		hospitality: hospitality.reduce((s, x) => s + x.split.deductibleCents, 0)
	});

	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	async function newTrip() {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			const traveller = await ownerTraveller(store, cleanDatevSettings(app.datevSettings));
			const { trip } = await saveTrip(store, { travellerId: traveller.id });
			await refreshNow();
			await goto(resolve('/reisen/[id]', { id: trip.id }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** @param {Record<string, any>} trip */
	const tripLine = (trip) =>
		[trip.destination || t('reisen.untitled'), tripDays(trip, formatDate)]
			.filter(Boolean)
			.join(' · ');

	/** @param {import('$lib/travel/view.js').TravelQuestion} q */
	function questionText(q) {
		if (q.kind === 'receiptWithoutTrip' || q.kind === 'hospitalityIncomplete') {
			const r = receiptById.get(q.receiptId);
			const what = r
				? [
						receiptVendor(/** @type {any} */ (r)),
						formatDate(receiptDate(/** @type {any} */ (r)) ?? '')
					]
						.filter(Boolean)
						.join(' · ')
				: '—';
			return q.kind === 'receiptWithoutTrip'
				? t('reisen.questions.receiptWithoutTrip', { what })
				: t('reisen.questions.hospitalityIncomplete', {
						what,
						missing: q.missing.map((m) => t(`belege.travel.hospitality.${m}`)).join(', ')
					});
		}
		const trip = tripById.get(q.tripId);
		const what = trip ? tripLine(trip) : '—';
		return q.kind === 'tripWithoutTimes'
			? t('reisen.questions.tripWithoutTimes', { what })
			: t('reisen.questions.tripIncomplete', { what });
	}

	/** @param {import('$lib/travel/view.js').TravelQuestion} q */
	const questionHref = (q) =>
		'receiptId' in q
			? `${resolve('/belege')}?receipt=${encodeURIComponent(q.receiptId)}`
			: resolve('/reisen/[id]', { id: q.tripId });
</script>

<svelte:head><title>{t('reisen.title')} · Belege</title></svelte:head>

<h1 class="text-2xl font-bold text-heading">{t('reisen.title')}</h1>
<p class="mt-1 text-sm text-text">{t('reisen.what')}</p>
<p class="mt-1 text-xs text-faint" data-testid="reisen-adviser">{t('reisen.adviser')}</p>

<div class="mt-4 flex flex-wrap items-end justify-between gap-3">
	<MonthPicker bind:value={month} label={t('reisen.month')} testid="reisen-month" />
	<button
		type="button"
		class={btn.primary}
		onclick={newTrip}
		disabled={busy}
		data-testid="reisen-new">{t('reisen.new')}</button
	>
</div>
{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}

{#if proposalsHere.length}
	<section class={card} aria-labelledby="reisen-proposals-h" data-testid="reisen-proposals">
		<h2 id="reisen-proposals-h" class="text-sm font-semibold text-heading">
			{t('reisen.proposals.title', { count: proposalsHere.length })}
		</h2>
		<p class="mt-1 text-xs text-faint">{t('reisen.proposals.what')}</p>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each proposalsHere as p (p.key)}
				{@const trip = p.tripId ? tripById.get(p.tripId) : null}
				<li class="py-2" data-testid="reisen-proposal">
					<p class="font-medium text-heading" data-testid="reisen-proposal-title">
						{trip
							? t('reisen.proposals.addTo', { trip: tripLine(trip) })
							: t('reisen.proposals.new', {
									destination: p.destination || t('reisen.untitled'),
									from: when(p.start),
									to: when(p.end)
								})}
					</p>
					<ul class="mt-1 text-xs text-text">
						{#each p.receiptIds as id (id)}
							{@const r = receiptById.get(id)}
							{#if r}
								<li>
									<a
										class="underline"
										href={`${resolve('/belege')}?receipt=${encodeURIComponent(id)}`}
										>{t(`belege.travel.kind.${travelKind(r) ?? 'ticket'}`)} · {receiptVendor(
											/** @type {any} */ (r)
										)} · {formatDate(receiptDate(/** @type {any} */ (r)) ?? '')}</a
									>
								</li>
							{/if}
						{/each}
					</ul>
					<div class="mt-2 flex flex-wrap gap-2">
						<button
							type="button"
							class={btn.primary}
							onclick={() => accept(p)}
							disabled={busy}
							data-testid="reisen-proposal-accept"
							>{trip ? t('reisen.proposals.add') : t('reisen.proposals.make')}</button
						>
						<button
							type="button"
							class={btn.link}
							onclick={() => dismiss(p)}
							disabled={busy}
							data-testid="reisen-proposal-dismiss">{t('reisen.proposals.dismiss')}</button
						>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
{#if proposalsElsewhere > 0}
	<p class="mt-2 text-xs text-faint" data-testid="reisen-proposals-elsewhere">
		{t('reisen.proposals.elsewhere', { count: proposalsElsewhere })}
		<button
			type="button"
			class="ml-1 {btn.link}"
			onclick={() => {
				const next = proposals.find((p) => p.start.slice(0, 7) !== month);
				if (next) month = next.start.slice(0, 7);
			}}
			data-testid="reisen-proposals-go">{t('reisen.proposals.show')}</button
		>
	</p>
{/if}

{#if questions.length}
	<section class={card} aria-labelledby="reisen-questions-h" data-testid="reisen-questions">
		<h2 id="reisen-questions-h" class="text-sm font-semibold text-heading">
			{t('reisen.questions.title', { count: questions.length })}
		</h2>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each questions as q, i (i)}
				<li>
					<a
						class="flex min-h-11 items-center py-1 text-heading hover:underline"
						href={questionHref(q)}
						data-testid="reisen-question"
						data-kind={q.kind}>{questionText(q)}</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class={card} aria-labelledby="reisen-trips-h" data-testid="reisen-trips">
	<h2 id="reisen-trips-h" class="text-sm font-semibold text-heading">{t('reisen.trips')}</h2>
	{#if shown.length}
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each shown as x (x.trip.id)}
				<li>
					<a
						class="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-heading no-underline hover:underline"
						href={resolve('/reisen/[id]', { id: x.trip.id })}
						data-testid="reisen-trip"
					>
						<span class="min-w-0">
							<span class="block truncate">{tripLine(x.trip)}</span>
							<span class="block text-xs text-faint"
								>{x.trip.reason || '—'} · {t('reisen.receipts', { count: x.receipts })}</span
							>
						</span>
						<span class="font-mono tabular-nums" data-testid="reisen-trip-sum"
							>{formatMoney(x.figures.allowanceCents + x.figures.mileageCents, 'EUR')}</span
						>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-faint" data-testid="reisen-none">{t('reisen.none')}</p>
	{/if}
	{#if untimed.length}
		<h3 class="mt-4 text-xs font-semibold text-faint">{t('reisen.untimed')}</h3>
		<ul class="mt-1 text-sm">
			{#each untimed as trip (trip.id)}
				<li>
					<a
						class="flex min-h-11 items-center text-heading hover:underline"
						href={resolve('/reisen/[id]', { id: trip.id })}
						data-testid="reisen-untimed">{tripLine(trip)}</a
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if hospitality.length}
	<section class={card} aria-labelledby="reisen-hosp-h" data-testid="reisen-hospitality">
		<h2 id="reisen-hosp-h" class="text-sm font-semibold text-heading">
			{t('reisen.hospitality')}
		</h2>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each hospitality as x (x.r.id)}
				<li>
					<a
						class="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1 text-heading hover:underline"
						href={`${resolve('/belege')}?receipt=${encodeURIComponent(x.r.id)}`}
						data-testid="reisen-hospitality-item"
						><span class="min-w-0 truncate"
							>{formatDate(receiptDate(/** @type {any} */ (x.r)) ?? '')} · {x.r.hospitality.place ||
								receiptVendor(/** @type {any} */ (x.r))}</span
						><span class="font-mono text-xs tabular-nums"
							>{t('reisen.deductible', {
								amount: formatMoney(x.split.deductibleCents, 'EUR')
							})}</span
						></a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class={card} aria-labelledby="reisen-totals-h" data-testid="reisen-totals">
	<h2 id="reisen-totals-h" class="text-sm font-semibold text-heading">{t('reisen.totals')}</h2>
	<dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
		<dt class="text-text">{t('reisen.allowances')}</dt>
		<dd class="text-right font-mono tabular-nums" data-testid="reisen-total-allowance">
			{formatMoney(totals.allowance, 'EUR')}
		</dd>
		<dt class="text-text">{t('reisen.mileage')}</dt>
		<dd class="text-right font-mono tabular-nums" data-testid="reisen-total-mileage">
			{formatMoney(totals.mileage, 'EUR')}
		</dd>
		<dt class="text-text">{t('reisen.hospitalityDeductible')}</dt>
		<dd class="text-right font-mono tabular-nums" data-testid="reisen-total-hospitality">
			{formatMoney(totals.hospitality, 'EUR')}
		</dd>
	</dl>
</section>
