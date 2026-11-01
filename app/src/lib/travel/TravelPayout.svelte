<script>
	// Paying travel statements out (issue #213, step 7; payout.js), in a
	// payment's detail:
	// - on a payout: the statements it pays, each to be let go, and how far;
	// - on money out not covered otherwise, while statements are open:
	//   "Zahlt Reisekosten aus …", the open statements to tick, the likely
	//   ones ticked (the number in the purpose, else the amounts).
	import { resolve } from '$app/paths';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { isActive } from '$lib/matching/engine.js';
	import {
		linkPayout,
		mayPayOut,
		statementChains,
		statementSettlements,
		suggestStatements,
		unlinkPayout
	} from './payout.js';
	import { travellersOf } from './records.js';

	/** @type {{ tx: Record<string, any> }} */
	let { tx } = $props();

	let settlements = $derived(
		statementSettlements({
			travel: app.travel,
			matches: app.matches,
			transactions: app.transactions
		})
	);
	let chains = $derived(statementChains(app.travel));
	// The chains this payment pays, by its links to their receipts.
	let paying = $derived.by(() => {
		const receipts = new Set(
			app.matches
				.filter((m) => m.transactionId === tx.id && isActive(m))
				.map((m) => String(m.receiptId))
		);
		return chains
			.filter((c) => c.members.some((s) => receipts.has(String(s.receiptId))))
			.map((c) => ({
				chain: c,
				settlement: settlements.find((s) => s.head.id === c.head.id),
				share:
					settlements.find((s) => s.head.id === c.head.id)?.payouts.find((p) => p.tx.id === tx.id)
						?.cents ?? 0
			}));
	});
	let open = $derived(settlements.filter((s) => s.openCents > 0));
	let offered = $derived(
		!paying.length &&
			open.length > 0 &&
			tx.source !== 'travel' &&
			mayPayOut(tx, app.matches, app.classifications[tx.id] ?? null)
	);

	let choosing = $state(false);
	/** @type {string[]} */
	let picked = $state([]);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another payment: the list closed. Only then – the same payment comes back
	// as a new object after every refresh (a matching run), and closing on that
	// threw away what was being chosen.
	let shownFor = '';
	$effect(() => {
		const id = String(tx.id);
		if (id === shownFor) return;
		shownFor = id;
		choosing = false;
		error = null;
	});

	let pickedCents = $derived(
		open.filter((s) => picked.includes(String(s.head.id))).reduce((n, s) => n + s.openCents, 0)
	);

	function choose() {
		choosing = !choosing;
		if (choosing) picked = suggestStatements(tx, open, travellersOf(app.travel));
	}

	/**
	 * The link is written and shown before matching runs again: matching only
	 * refreshes the suggestions, and may wait behind another run – the buttons
	 * are free again meanwhile.
	 *
	 * @param {() => Promise<void>} fn
	 */
	async function act(fn) {
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

	const link = () =>
		act(async () => {
			await linkPayout(currentStore(), String(tx.id), picked);
			choosing = false;
		});

	/** @param {Record<string, any>} s */
	const label = (s) =>
		t('zahlungen.detail.travelPayout.item', {
			number: String(s.number),
			month: String(s.month),
			amount: formatMoney(Number(s.toPayBackCents ?? 0), 'EUR')
		});
</script>

{#if paying.length}
	<div class="mt-2 text-sm" data-testid="travel-payout">
		<p class="font-medium text-heading">{t('zahlungen.detail.travelPayout.title')}</p>
		{#each paying as p (p.chain.head.id)}
			<p
				class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text"
				data-testid="travel-payout-item"
			>
				<a class="underline" href={`${resolve('/reisen')}?month=${p.chain.head.month}`}
					>{label(p.chain.head)}</a
				>
				{#if p.share}
					<span class="font-mono tabular-nums"
						>{t('zahlungen.detail.travelPayout.share', {
							amount: formatMoney(p.share, 'EUR')
						})}</span
					>
				{/if}
				<button
					type="button"
					class="text-faint underline"
					onclick={() => act(() => unlinkPayout(currentStore(), String(tx.id), p.chain.members))}
					disabled={busy}
					data-testid="travel-payout-unlink">{t('zahlungen.detail.travelPayout.unlink')}</button
				>
			</p>
			{#if p.settlement}
				<p
					class="text-xs {p.settlement.openCents > 0
						? 'text-warning'
						: p.settlement.openCents < 0
							? 'text-warning'
							: 'text-success'}"
					data-testid="travel-payout-state"
				>
					{p.settlement.openCents > 0
						? t('zahlungen.detail.travelPayout.open', {
								amount: formatMoney(p.settlement.openCents, 'EUR')
							})
						: p.settlement.openCents < 0
							? t('zahlungen.detail.travelPayout.over', {
									amount: formatMoney(-p.settlement.openCents, 'EUR')
								})
							: t('zahlungen.detail.travelPayout.settled')}
				</p>
			{/if}
		{/each}
	</div>
{:else if offered}
	<div class="mt-2 text-sm" data-testid="travel-payout-offer">
		<button
			type="button"
			class={btn.secondary}
			onclick={choose}
			aria-expanded={choosing}
			data-testid="travel-payout-open">{t('zahlungen.detail.travelPayout.offer')}</button
		>
		{#if choosing}
			<ul class="mt-2 divide-y divide-border rounded-md border border-border">
				{#each open as s (s.head.id)}
					<li class="px-3 py-2">
						<label class="flex items-center gap-2 text-text" data-testid="travel-payout-choice">
							<input type="checkbox" value={String(s.head.id)} bind:group={picked} />
							<span class="flex-1">{label(s.head)}</span>
							<span class="font-mono tabular-nums"
								>{t('zahlungen.detail.travelPayout.openOf', {
									amount: formatMoney(s.openCents, 'EUR')
								})}</span
							>
						</label>
					</li>
				{/each}
			</ul>
			<p class="mt-1 text-xs text-faint" data-testid="travel-payout-sum">
				{t('zahlungen.detail.travelPayout.sum', {
					picked: formatMoney(pickedCents, 'EUR'),
					payout: formatMoney(Math.abs(Number(tx.amountCents ?? 0)), 'EUR')
				})}
			</p>
			<button
				type="button"
				class="mt-2 {btn.primary}"
				onclick={link}
				disabled={busy || !picked.length}
				data-testid="travel-payout-link">{t('zahlungen.detail.travelPayout.link')}</button
			>
		{/if}
	</div>
{/if}
{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
