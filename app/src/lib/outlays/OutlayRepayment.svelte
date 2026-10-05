<script>
	// Paying outlays back (issue #293, repayment.js), in a payment's detail:
	// - on an outlay: how far it is paid back, and by which payouts;
	// - on a payout: the outlays it pays back, each to be let go;
	// - on money out not covered otherwise, while outlays are open:
	//   "Erstattet Auslagen …", the open outlays to tick, the likely ones ticked.
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { isOutlay } from './outlays.js';
	import {
		linkOutlayRepayment,
		mayRepayOutlays,
		openOutlays,
		outlaySettlement,
		suggestOutlays,
		unlinkOutlayRepayment
	} from './repayment.js';

	/** @type {{ tx: Record<string, any>, onopen: (id: string) => void }} */
	let { tx, onopen } = $props();

	let outlay = $derived(isOutlay(tx) && tx.outlay ? tx : null);
	let payout = $derived(tx.outlayRepaymentOf?.length ? tx : null);
	let settlement = $derived(
		outlay || payout ? outlaySettlement(tx, /** @type {any[]} */ (app.transactions)) : null
	);
	let open = $derived(openOutlays(/** @type {any[]} */ (app.transactions)));
	let offered = $derived(
		!payout &&
			open.length > 0 &&
			mayRepayOutlays(tx, app.matches, app.classifications[tx.id] ?? null)
	);

	let choosing = $state(false);
	/** @type {string[]} */
	let picked = $state([]);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another payment: the list closed.
	$effect(() => {
		void tx.id;
		choosing = false;
		error = null;
	});

	let pickedCents = $derived(
		open.filter((o) => picked.includes(String(o.tx.id))).reduce((n, o) => n + o.openCents, 0)
	);

	function choose() {
		choosing = !choosing;
		if (choosing) picked = suggestOutlays(Math.abs(Number(tx.amountCents ?? 0)), open);
	}

	/** @param {() => Promise<void>} fn */
	async function act(fn) {
		busy = true;
		error = null;
		try {
			await fn();
			await refreshNow();
			await runMatchingNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const link = () =>
		act(async () => {
			await linkOutlayRepayment(currentStore(), String(tx.id), picked);
			choosing = false;
		});
	/** @param {string} payoutId @param {string} outlayId */
	const unlink = (payoutId, outlayId) =>
		act(() => unlinkOutlayRepayment(currentStore(), payoutId, outlayId));

	/** @param {Record<string, any>} t */
	const line = (t) => ({
		date: formatDate(String(t.bookedOn ?? '')),
		amount: formatMoney(Math.abs(Number(t.amountCents ?? 0)), 'EUR'),
		name: String(t.counterparty ?? '')
	});
</script>

{#if outlay && settlement}
	<div class="mt-2 text-sm" data-testid="outlay-repayment-state">
		<p class={settlement.openCents ? 'text-warning' : 'text-success'}>
			{settlement.openCents
				? settlement.repaidCents
					? t('zahlungen.detail.outlayRepay.partly', {
							open: formatMoney(settlement.openOf.get(String(outlay.id)) ?? 0, 'EUR')
						})
					: t('zahlungen.detail.outlayRepay.open')
				: t('zahlungen.detail.outlayRepay.settled')}
		</p>
		{#each settlement.payouts as p (p.id)}
			<p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text">
				<button type="button" class="underline" onclick={() => onopen(String(p.id))}
					>{t('zahlungen.detail.outlayRepay.repaidBy', line(p))}</button
				>
				{#if p.outlayRepaymentOf?.includes(String(outlay.id))}
					<button
						type="button"
						class="text-faint underline"
						onclick={() => unlink(String(p.id), String(outlay.id))}
						disabled={busy}>{t('zahlungen.detail.outlayRepay.unlink')}</button
					>
				{/if}
			</p>
		{/each}
	</div>
{:else if payout && settlement}
	<div class="mt-2 text-sm" data-testid="outlay-payout">
		<p class="font-medium text-heading">{t('zahlungen.detail.outlayRepay.payoutTitle')}</p>
		{#each settlement.outlays.filter( (o) => payout.outlayRepaymentOf.includes(String(o.id)) ) as o (o.id)}
			<p
				class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text"
				data-testid="outlay-payout-item"
			>
				<button type="button" class="underline" onclick={() => onopen(String(o.id))}
					>{t('zahlungen.detail.outlayRepay.item', line(o))}</button
				>
				<button
					type="button"
					class="text-faint underline"
					onclick={() => unlink(String(payout.id), String(o.id))}
					disabled={busy}
					data-testid="outlay-payout-unlink">{t('zahlungen.detail.outlayRepay.unlink')}</button
				>
			</p>
		{/each}
		<p
			class="mt-1 text-xs {settlement.openCents ? 'text-warning' : 'text-success'}"
			data-testid="outlay-payout-state"
		>
			{settlement.openCents
				? t('zahlungen.detail.outlayRepay.groupOpen', {
						amount: formatMoney(settlement.openCents, 'EUR')
					})
				: settlement.repaidCents > settlement.owedCents
					? t('zahlungen.detail.outlayRepay.over', {
							amount: formatMoney(settlement.repaidCents - settlement.owedCents, 'EUR')
						})
					: t('zahlungen.detail.outlayRepay.settled')}
		</p>
	</div>
{:else if offered}
	<div class="mt-2 text-sm" data-testid="outlay-repay">
		<button
			type="button"
			class={btn.secondary}
			onclick={choose}
			aria-expanded={choosing}
			title={t('zahlungen.detail.outlayRepay.offerTitle')}
			data-testid="outlay-repay-open">{t('zahlungen.detail.outlayRepay.offer')}</button
		>
		{#if choosing}
			<ul class="mt-2 divide-y divide-border rounded-md border border-border">
				{#each open as o (o.tx.id)}
					<li class="px-3 py-2">
						<label class="flex items-center gap-2 text-text" data-testid="outlay-repay-item">
							<input type="checkbox" value={String(o.tx.id)} bind:group={picked} />
							<span class="flex-1">{line(o.tx).date} · {line(o.tx).name}</span>
							<span class="font-mono tabular-nums"
								>{formatMoney(o.openCents, 'EUR')}{o.openCents !==
								Math.abs(Number(o.tx.amountCents ?? 0))
									? ` ${t('zahlungen.detail.outlayRepay.ofOpen')}`
									: ''}</span
							>
						</label>
					</li>
				{/each}
			</ul>
			<p class="mt-1 text-xs text-faint" data-testid="outlay-repay-sum">
				{t('zahlungen.detail.outlayRepay.sum', {
					picked: formatMoney(pickedCents, 'EUR'),
					payout: formatMoney(Math.abs(Number(tx.amountCents ?? 0)), 'EUR')
				})}
			</p>
			<button
				type="button"
				class="mt-2 {btn.primary}"
				onclick={link}
				disabled={busy || !picked.length}
				data-testid="outlay-repay-link">{t('zahlungen.detail.outlayRepay.link')}</button
			>
		{/if}
	</div>
{/if}
{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
