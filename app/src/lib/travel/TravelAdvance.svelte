<script>
	// An advance before a trip (issue #381, advances.js), in a payment's detail:
	// - on money out not covered otherwise: "Vorschuss für Reisekosten …", for
	//   whom (by the IBAN's last digits where they match) and, if it is known,
	//   for which trip;
	// - on an advance: whose, which statements took it and what is still open,
	//   and "Kein Vorschuss" to take it back.
	import { resolve } from '$app/paths';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { advancesOf, markAdvance, unmarkAdvance } from './advances.js';
	import { mayPayOut, statementSettlements } from './payout.js';
	import { ownerTraveller, travellersOf } from './records.js';
	import { allTrips, tripDays } from './view.js';

	/** @type {{ tx: Record<string, any> }} */
	let { tx } = $props();

	const field = 'ml-2 max-w-full rounded-md border border-border bg-surface px-2 py-1 text-sm';

	let travellers = $derived(travellersOf(app.travel));
	let advance = $derived(tx.travelAdvance?.travellerId ? tx.travelAdvance : null);
	let whose = $derived(
		advance ? (travellers.find((p) => p.id === advance.travellerId) ?? null) : null
	);
	let advanceTrip = $derived(
		advance?.tripId ? (allTrips(app.travel).find((x) => x.id === advance.tripId) ?? null) : null
	);
	// Which statements took it, and what no statement has taken yet.
	let taken = $derived.by(() => {
		if (!advance) return { by: [], open: 0 };
		const by = statementSettlements({
			travel: app.travel,
			matches: app.matches,
			transactions: app.transactions
		}).flatMap((s) =>
			s.advances.filter((a) => a.tx.id === tx.id).map((a) => ({ head: s.head, cents: a.cents }))
		);
		const all = advancesOf(app.transactions).find((a) => a.tx.id === tx.id)?.cents ?? 0;
		return { by, open: all - by.reduce((n, b) => n + b.cents, 0) };
	});
	let offered = $derived(
		!advance &&
			tx.source !== 'travel' &&
			mayPayOut(tx, app.matches, app.classifications[tx.id] ?? null)
	);

	let choosing = $state(false);
	let who = $state('');
	let tripId = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	$effect(() => {
		void tx.id;
		choosing = false;
		error = null;
	});

	// The traveller's trips, those around the payment first.
	let trips = $derived(
		allTrips(app.travel)
			.filter((x) => x.travellerId === who)
			.sort(
				(a, b) =>
					Math.abs(Date.parse(String(a.start || '')) - Date.parse(String(tx.bookedOn))) -
					Math.abs(Date.parse(String(b.start || '')) - Date.parse(String(tx.bookedOn)))
			)
			.slice(0, 20)
	);

	function choose() {
		choosing = !choosing;
		if (!choosing) return;
		const iban = String(tx.counterpartyIban ?? '').replace(/\s+/g, '');
		const byIban = travellers.find((p) => p.ibanLast4 && iban.endsWith(p.ibanLast4));
		who = String((byIban ?? travellers.find((p) => p.role === 'owner') ?? travellers[0])?.id ?? '');
		tripId = '';
	}

	/** @param {() => Promise<void>} fn */
	async function act(fn) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await fn();
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
		} finally {
			busy = false;
		}
		runMatchingNow().catch((e) => (error = e instanceof Error ? e.message : String(e)));
	}

	const mark = () =>
		act(async () => {
			const store = /** @type {any} */ (currentStore());
			// No one listed yet: the owner, made now.
			const travellerId =
				who || String((await ownerTraveller(store, cleanDatevSettings(app.datevSettings))).id);
			await markAdvance(store, String(tx.id), { travellerId, tripId: tripId || null });
			choosing = false;
		});
	const unmark = () => act(() => unmarkAdvance(currentStore(), String(tx.id)));

	/** @param {Record<string, any>} p */
	const nameOf = (p) => p?.name || t(`travellers.role.${p?.role ?? 'owner'}`);
	/** @param {Record<string, any>} x */
	const tripLine = (x) =>
		[x.destination || t('reisen.untitled'), tripDays(x, formatDate)].filter(Boolean).join(' · ');
</script>

{#if advance}
	<div class="mt-2 text-sm" data-testid="travel-advance">
		<p class="font-medium text-heading">
			{t('zahlungen.detail.travelAdvance.title', { name: whose ? nameOf(whose) : '—' })}
		</p>
		{#if advanceTrip}
			<p class="text-xs text-text">
				<a class="underline" href={resolve('/reisen/[id]', { id: advanceTrip.id })}
					>{tripLine(advanceTrip)}</a
				>
			</p>
		{/if}
		{#each taken.by as b (b.head.id)}
			<p class="text-xs text-text" data-testid="travel-advance-taken">
				{t('zahlungen.detail.travelAdvance.taken', {
					number: String(b.head.number),
					amount: formatMoney(b.cents, 'EUR')
				})}
			</p>
		{/each}
		{#if taken.open > 0}
			<p class="text-xs text-warning" data-testid="travel-advance-unsettled">
				{t('zahlungen.detail.travelAdvance.open', { amount: formatMoney(taken.open, 'EUR') })}
			</p>
		{/if}
		<button
			type="button"
			class="text-xs text-faint underline"
			onclick={unmark}
			disabled={busy}
			data-testid="travel-advance-undo">{t('zahlungen.detail.travelAdvance.undo')}</button
		>
	</div>
{:else if offered}
	<div class="mt-2 text-sm" data-testid="travel-advance-offer">
		<button
			type="button"
			class={btn.secondary}
			onclick={choose}
			aria-expanded={choosing}
			data-testid="travel-advance-open">{t('zahlungen.detail.travelAdvance.offer')}</button
		>
		{#if choosing}
			<div class="mt-2 flex flex-col gap-2">
				<p class="text-xs text-faint">{t('zahlungen.detail.travelAdvance.hint')}</p>
				{#if travellers.length > 1}
					<label class="text-text"
						>{t('reisen.who')}
						<select class={field} bind:value={who} data-testid="travel-advance-who">
							{#each travellers as p (p.id)}
								<option value={p.id}>{nameOf(p)}</option>
							{/each}
						</select>
					</label>
				{/if}
				<label class="text-text"
					>{t('zahlungen.detail.travelAdvance.trip')}
					<select class={field} bind:value={tripId} data-testid="travel-advance-trip">
						<option value="">{t('zahlungen.detail.travelAdvance.noTrip')}</option>
						{#each trips as x (x.id)}
							<option value={x.id}>{tripLine(x)}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					class="self-start {btn.primary}"
					onclick={mark}
					disabled={busy}
					data-testid="travel-advance-mark">{t('zahlungen.detail.travelAdvance.mark')}</button
				>
			</div>
		{/if}
	</div>
{/if}
{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
