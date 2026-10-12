<script>
	// "Reisen" (issue #213, step 3): a month's trips with what they come to,
	// the hospitality bills of the month, and what travel still asks. Reached
	// from Belege and from Home. Above them, the trips the receipts propose
	// (step 4b, travel/proposals.js), each a click away from a trip.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import MonthPicker from '$lib/MonthPicker.svelte';
	import ReceiptPeek from '$lib/ReceiptPeek.svelte';
	import PeekLink from '$lib/receipts/PeekLink.svelte';
	import { createPeek } from '$lib/receipts/peek.js';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { statementOf } from '$lib/travel/statement.js';
	import { closedStatements, createTravelStatement } from '$lib/travel/statement-actions.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptDate, receiptVendor } from '$lib/receipts/view.js';
	import { btn, card } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { ownerTraveller, saveTrip, tripFigures, tripMonth } from '$lib/travel/records.js';
	import { openTravelQuestions, tripProposals } from '$lib/travel/proposals.js';
	import { acceptProposal, dismissProposal } from '$lib/travel/proposal-actions.js';
	import {
		allAppointments,
		appointmentDays,
		isOnSite,
		tripFromAppointment
	} from '$lib/travel/appointments.js';
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
			.map((r) => ({ r, split: hospitalityOf(r, app) }))
	);
	let questions = $derived(openTravelQuestions({ travel: app.travel, receipts: app.receipts }));
	let proposals = $derived(tripProposals({ travel: app.travel, receipts: app.receipts }));
	let proposalsHere = $derived(proposals.filter((p) => p.start.slice(0, 7) === month));
	let proposalsElsewhere = $derived(proposals.length - proposalsHere.length);

	// Appointments somewhere else this month that no trip or proposal takes in yet (step 4c).
	let dismissedKeys = $derived(
		new Set(
			app.travel.filter((r) => r.kind === 'dismissed' && !r.deleted).map((r) => String(r.key))
		)
	);
	let appointments = $derived(
		allAppointments(app.travel).filter((a) => {
			if (!isOnSite(a) || String(a.start).slice(0, 7) !== month) return false;
			if (dismissedKeys.has(`appointment:${a.id}`)) return false;
			const { fromDay, toDay } = appointmentDays(a);
			const overlaps = (/** @type {string} */ from, /** @type {string} */ to) =>
				from.slice(0, 10) <= toDay && fromDay <= to.slice(0, 10);
			return (
				!trips.some((x) => x.start && x.end && overlaps(x.start, x.end)) &&
				!proposals.some((p) => overlaps(p.start, p.end))
			);
		})
	);

	/** @param {Record<string, any>} a */
	async function tripForAppointment(a) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			const traveller = await ownerTraveller(store, cleanDatevSettings(app.datevSettings));
			const { trip } = await saveTrip(store, {
				travellerId: traveller.id,
				...tripFromAppointment(a)
			});
			await refreshNow();
			await goto(resolve('/reisen/[id]', { id: trip.id }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** @param {Record<string, any>} a */
	async function noTrip(a) {
		const store = currentStore();
		if (!store) return;
		await dismissProposal(store, `appointment:${a.id}`);
		await refreshNow();
	}

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

	// The month's statement (step 5): for the owner, the one traveller for now.
	let owner = $derived(
		app.travel.find((r) => r.kind === 'traveller' && r.role === 'owner' && !r.deleted) ?? null
	);
	let closed = $derived(owner ? closedStatements(app.travel, owner.id, month) : []);
	let preview = $derived(
		owner
			? statementOf({
					travellerId: owner.id,
					month,
					travel: app.travel,
					receipts: app.receipts,
					transactions: app.transactions,
					matches: app.matches
				})
			: null
	);
	let showPreview = $derived(Boolean(preview && !preview.checks.some((c) => c.code === 'nothing')));
	// What the newest closed statement booked (step 6), and how much is still to be confirmed.
	let bookedNow = $derived.by(() => {
		const id = closed[0]?.id;
		const lines = id
			? app.transactions.filter(
					(tx) => tx.source === 'travel' && !tx.deleted && tx.travelLine?.statementId === id
				)
			: [];
		const account = lines.length ? app.accounts.find((a) => a.id === lines[0].accountId) : null;
		return {
			count: lines.length,
			open: lines.filter((tx) => !tx.booking?.confirmedAt).length,
			account: account
				? `${account.name}${account.ledgerAccount ? ` (${account.ledgerAccount})` : ''}`
				: ''
		};
	});
	let correcting = $state(false);
	let travellerName = $state('');
	let nameTouched = $state(false);
	$effect(() => {
		if (!nameTouched) travellerName = String(owner?.name ?? '');
	});

	async function makeStatement() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !owner) return;
		busy = true;
		error = null;
		try {
			const name = travellerName.trim();
			const traveller =
				name !== owner.name ? await store.travel.put({ ...$state.snapshot(owner), name }) : owner;
			await createTravelStatement({
				store,
				blobs,
				traveller,
				settings: cleanDatevSettings(app.datevSettings),
				month,
				issuer: app.matchingSettings?.companyNames?.[0] ?? '',
				createdBy: app.did ?? '',
				corrects: correcting ? (closed[0]?.id ?? null) : null
			});
			correcting = false;
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** @param {import('$lib/travel/statement.js').Check} c */
	function checkText(c) {
		const trip = c.tripId ? tripById.get(c.tripId) : null;
		const r = c.receiptId ? receiptById.get(c.receiptId) : null;
		const what = trip
			? tripLine(trip)
			: r
				? receiptVendor(/** @type {any} */ (r))
				: c.date
					? formatDate(c.date)
					: '';
		return t(`reisen.statement.check.${c.code}`, { what });
	}
	/** @param {import('$lib/travel/statement.js').Check} c */
	const checkHref = (c) =>
		c.tripId
			? resolve('/reisen/[id]', { id: c.tripId })
			: c.receiptId
				? `${resolve('/belege')}?receipt=${encodeURIComponent(c.receiptId)}`
				: null;

	// The hover preview of a receipt named on this page (#273, receipts/peek.js).
	/** @type {{ receipt: Record<string, any>, anchor: HTMLElement } | null} */
	let peeked = $state(null);
	const peek = createPeek({
		onchange: (v) =>
			(peeked = /** @type {{ receipt: Record<string, any>, anchor: HTMLElement } | null} */ (v))
	});
	/** @param {string} id */
	const receiptHref = (id) => `${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;

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
									<PeekLink
										receipt={r}
										href={receiptHref(id)}
										{peek}
										open={peeked?.receipt.id === id}
										class="underline"
										testid="reisen-proposal-receipt"
										>{t(`belege.travel.kind.${travelKind(r) ?? 'ticket'}`)} · {receiptVendor(
											/** @type {any} */ (r)
										)} · {formatDate(receiptDate(/** @type {any} */ (r)) ?? '')}</PeekLink
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

{#if appointments.length}
	<section class={card} aria-labelledby="reisen-appointments-h" data-testid="reisen-appointments">
		<h2 id="reisen-appointments-h" class="text-sm font-semibold text-heading">
			{t('reisen.appointments.title', { count: appointments.length })}
		</h2>
		<p class="mt-1 text-xs text-faint">{t('reisen.appointments.what')}</p>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each appointments as a (a.id)}
				<li class="py-2" data-testid="reisen-appointment">
					<p class="font-medium text-heading">{a.summary || '—'}</p>
					<p class="text-xs text-text">
						{a.location} · {a.allDay
							? [appointmentDays(a).fromDay, appointmentDays(a).toDay]
									.filter((d, i, all) => i === 0 || d !== all[0])
									.map((d) => formatDate(d))
									.join(' – ')
							: `${when(a.start)} – ${when(a.end)}`}
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<button
							type="button"
							class={btn.secondary}
							onclick={() => tripForAppointment(a)}
							disabled={busy}
							data-testid="reisen-appointment-trip">{t('reisen.appointments.make')}</button
						>
						<button
							type="button"
							class={btn.link}
							onclick={() => noTrip(a)}
							disabled={busy}
							data-testid="reisen-appointment-dismiss">{t('reisen.appointments.dismiss')}</button
						>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if questions.length}
	<section class={card} aria-labelledby="reisen-questions-h" data-testid="reisen-questions">
		<h2 id="reisen-questions-h" class="text-sm font-semibold text-heading">
			{t('reisen.questions.title', { count: questions.length })}
		</h2>
		<ul class="mt-2 divide-y divide-border text-sm">
			{#each questions as q, i (i)}
				<li>
					<PeekLink
						receipt={'receiptId' in q ? receiptById.get(q.receiptId) : null}
						href={questionHref(q)}
						{peek}
						open={'receiptId' in q && peeked?.receipt.id === q.receiptId}
						class="flex min-h-11 items-center py-1 text-heading hover:underline"
						testid="reisen-question"
						kind={q.kind}>{questionText(q)}</PeekLink
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
					<PeekLink
						receipt={x.r}
						href={receiptHref(x.r.id)}
						{peek}
						open={peeked?.receipt.id === x.r.id}
						class="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-1 text-heading hover:underline"
						testid="reisen-hospitality-item"
						><span class="min-w-0 truncate"
							>{formatDate(receiptDate(/** @type {any} */ (x.r)) ?? '')} · {x.r.hospitality.place ||
								receiptVendor(/** @type {any} */ (x.r))}</span
						><span class="font-mono text-xs tabular-nums"
							>{t('reisen.deductible', {
								amount: formatMoney(x.split.deductibleCents, 'EUR')
							})}</span
						></PeekLink
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if closed.length && !correcting}
	<section class={card} aria-labelledby="reisen-statement-h" data-testid="reisen-statement-made">
		<h2 id="reisen-statement-h" class="text-sm font-semibold text-heading">
			{t('reisen.statement.title', { month })}
		</h2>
		<ul class="mt-2 text-sm">
			{#each closed as c, i (c.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-1"
					data-testid="reisen-statement-closed"
				>
					<PeekLink
						receipt={receiptById.get(c.receiptId)}
						href={receiptHref(c.receiptId)}
						{peek}
						open={peeked?.receipt.id === c.receiptId}
						class="underline"
						>{t(i === 0 ? 'reisen.statement.made' : 'reisen.statement.replaced', {
							number: c.number,
							date: formatDate(String(c.closedAt).slice(0, 10))
						})}</PeekLink
					>
					<span class="font-mono tabular-nums">{formatMoney(c.toPayBackCents, 'EUR')}</span>
				</li>
			{/each}
		</ul>
		{#if bookedNow.count}
			<p class="mt-2 text-sm text-text" data-testid="reisen-statement-booked">
				{t('reisen.statement.booked', { count: bookedNow.count, account: bookedNow.account })}
				{#if bookedNow.open}
					<a class="underline" href={resolve('/export')}
						>{t('reisen.statement.toConfirm', { count: bookedNow.open })}</a
					>
				{/if}
			</p>
		{/if}
		<p class="mt-1 text-xs text-faint">{t('reisen.statement.closedHint')}</p>
		<button
			type="button"
			class="mt-2 {btn.link}"
			onclick={() => (correcting = true)}
			data-testid="reisen-statement-correct">{t('reisen.statement.correct')}</button
		>
	</section>
{:else if showPreview && preview}
	<section class={card} aria-labelledby="reisen-statement-h" data-testid="reisen-statement">
		<h2 id="reisen-statement-h" class="text-sm font-semibold text-heading">
			{correcting
				? t('reisen.statement.correctionTitle', { number: closed[0]?.number ?? '' })
				: t('reisen.statement.title', { month })}
		</h2>
		<p class="mt-1 text-xs text-faint">{t('reisen.statement.what')}</p>
		<label class="mt-3 flex flex-col text-sm text-text"
			>{t('reisen.statement.traveller')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
				bind:value={travellerName}
				oninput={() => (nameTouched = true)}
				data-testid="reisen-statement-name"
			/>
		</label>
		<dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
			<dt class="text-text">{t('reisen.allowances')}</dt>
			<dd class="text-right font-mono tabular-nums">
				{formatMoney(preview.totals.allowanceCents, 'EUR')}
			</dd>
			<dt class="text-text">{t('reisen.mileage')}</dt>
			<dd class="text-right font-mono tabular-nums">
				{formatMoney(preview.totals.mileageCents, 'EUR')}
			</dd>
			<dt class="text-text">{t('reisen.statement.private')}</dt>
			<dd class="text-right font-mono tabular-nums">
				{formatMoney(preview.totals.privateCents, 'EUR')}
			</dd>
			{#if preview.totals.outlayCents}
				<dt class="text-text">{t('reisen.statement.outlay')}</dt>
				<dd class="text-right font-mono text-faint tabular-nums">
					{formatMoney(preview.totals.outlayCents, 'EUR')}
				</dd>
			{/if}
			<dt class="text-text">{t('reisen.statement.company')}</dt>
			<dd class="text-right font-mono text-faint tabular-nums">
				{formatMoney(preview.totals.companyCents, 'EUR')}
			</dd>
			<dt class="font-medium text-heading">{t('reise.toPayBack')}</dt>
			<dd
				class="text-right font-mono font-medium tabular-nums"
				data-testid="reisen-statement-amount"
			>
				{formatMoney(preview.totals.toPayBackCents, 'EUR')}
			</dd>
		</dl>
		{#if preview.checks.length}
			<ul class="mt-3 space-y-1 text-sm" data-testid="reisen-statement-checks">
				{#each preview.checks as c, i (i)}
					{@const href = checkHref(c)}
					<li
						class={c.level === 'error' ? 'text-danger' : 'text-faint'}
						data-testid="reisen-statement-check"
						data-level={c.level}
						data-code={c.code}
					>
						{#if href && c.receiptId}<PeekLink
								receipt={receiptById.get(c.receiptId)}
								{href}
								{peek}
								open={peeked?.receipt.id === c.receiptId}
								class="underline">{checkText(c)}</PeekLink
							>{:else if href}<a class="underline" {href}>{checkText(c)}</a>{:else}{checkText(
								c
							)}{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if !travellerName.trim()}
			<p class="mt-2 text-xs text-danger" data-testid="reisen-statement-noname">
				{t('reisen.statement.noName')}
			</p>
		{/if}
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class={btn.primary}
				onclick={makeStatement}
				disabled={busy || !preview.ready || !travellerName.trim()}
				data-testid="reisen-statement-make">{t('reisen.statement.make')}</button
			>
			{#if correcting}
				<button type="button" class={btn.link} onclick={() => (correcting = false)}
					>{t('belege.travel.cancel')}</button
				>
			{/if}
		</div>
		<p class="mt-2 text-xs text-faint">{t('reisen.statement.makeHint')}</p>
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
