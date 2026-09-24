<script>
	// Rückfragen: what the matching engine was not sure about. Every answer is
	// a record the next run respects (matching/actions.js, engine.js).
	import { resolve } from '$app/paths';
	import { app, currentStore, runMatchingNow } from '$lib/session.svelte.js';
	import { answerQuestion } from '$lib/matching/actions.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptDate, receiptVendor } from '$lib/receipts/view.js';
	import { t } from '$lib/i18n/index.js';

	let open = $derived(app.questions.filter((q) => q.state === 'open'));
	let answered = $derived(app.questions.filter((q) => q.state === 'answered'));
	let txById = $derived(new Map(app.transactions.map((x) => [x.id, x])));
	let receiptById = $derived(new Map(app.receipts.map((r) => [r.id, r])));

	/** @type {Record<string, string>} */
	let reasons = $state({});
	/** @type {string | null} */
	let asking = $state(null);
	/** @type {string | null} */
	let busy = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @param {string} id @param {import('$lib/matching/actions.js').Answer} answer */
	async function answer(id, answer) {
		const store = currentStore();
		if (!store) return;
		busy = id;
		error = null;
		try {
			await answerQuestion(/** @type {any} */ (store), id, answer);
			await runMatchingNow();
			asking = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	/** @param {Record<string, any>} q */
	function heading(q) {
		if (q.kind === 'missing-receipt' && (txById.get(q.transactionId)?.amountCents ?? 0) > 0) {
			return t('rueckfragen.kind.missing-income');
		}
		return t(`rueckfragen.kind.${q.kind}`);
	}

	/** @param {import('$lib/store/repository.js').StoredRecord | undefined} r */
	const receiptLine = (r) =>
		r
			? [
					typeof r.amountCents === 'number' ? formatMoney(r.amountCents, r.currency ?? 'EUR') : '',
					receiptDate(r) ? formatDate(/** @type {string} */ (receiptDate(r))) : '',
					r.invoiceNumber,
					r.fileName
				]
					.filter(Boolean)
					.join(' · ')
			: '—';
	/** @param {Record<string, any> | undefined} x */
	const txLine = (x) =>
		x ? `${formatDate(x.bookedOn)} · ${formatMoney(x.amountCents ?? 0, x.currency)}` : '—';
	/** @param {string[]} list */
	const reasonText = (list) => (list ?? []).map((x) => t(`matching.reason.${x}`)).join(' · ');

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<h1 class="text-2xl font-bold text-heading">{t('rueckfragen.title')}</h1>
	<a class="text-sm text-text underline" href={resolve('/')}>{t('rueckfragen.back')}</a>
</div>
<p class="mt-1 text-sm text-faint">{t('rueckfragen.intro')}</p>

{#if error}
	<p class="mt-3 text-sm text-danger" role="alert">{error}</p>
{/if}

{#each open as q (q.id)}
	{@const r = q.receiptId ? receiptById.get(q.receiptId) : undefined}
	{@const x = q.transactionId ? txById.get(q.transactionId) : undefined}
	<section class="mt-4 {card}" data-testid="question" data-kind={q.kind}>
		<h2 class="text-sm font-semibold text-cyan-800 dark:text-cyan">{heading(q)}</h2>
		{#if r}
			<p class="mt-1 font-medium text-heading" data-testid="question-receipt">
				{receiptVendor(r)}
			</p>
			<p class="text-sm text-faint">{receiptLine(r)}</p>
		{:else if x}
			<p class="mt-1 font-medium text-heading" data-testid="question-transaction">
				{x.counterparty || '—'}
			</p>
			<p class="text-sm text-faint">{txLine(x)}</p>
		{/if}

		{#if q.kind === 'unknown-sender'}
			<p class="mt-2 text-sm text-text">{t('rueckfragen.unknownSender')}</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					class={primary}
					disabled={busy !== null}
					onclick={() => answer(q.id, { choice: 'confirm-sender' })}
					data-testid="answer-confirm-sender">{t('rueckfragen.confirmSender')}</button
				>
				<button
					type="button"
					class={button}
					disabled={busy !== null}
					onclick={() => answer(q.id, { choice: 'ignore' })}
					data-testid="answer-ignore">{t('rueckfragen.ignore')}</button
				>
			</div>
		{:else}
			<h3 class="mt-3 text-xs font-semibold tracking-wide text-faint uppercase">
				{q.kind === 'unsure-match'
					? t('rueckfragen.candidates')
					: t('rueckfragen.receiptCandidates')}
			</h3>
			<ul class="mt-1 divide-y divide-border">
				{#each q.candidates ?? [] as c (c.transactionId ?? c.receiptId)}
					{@const ct = c.transactionId ? txById.get(c.transactionId) : undefined}
					{@const cr = c.receiptId ? receiptById.get(c.receiptId) : undefined}
					<li class="flex flex-wrap items-center gap-3 py-2" data-testid="candidate">
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-heading"
								>{ct ? ct.counterparty || '—' : cr ? receiptVendor(cr) : '—'}</span
							>
							<span class="block text-xs text-faint"
								>{ct ? txLine(ct) : receiptLine(cr)} · {t('matching.score', { score: c.score })} ({reasonText(
									c.reasons
								)})</span
							>
						</span>
						<button
							type="button"
							class={primary}
							disabled={busy !== null}
							onclick={() =>
								answer(q.id, {
									choice: 'candidate',
									transactionId: c.transactionId,
									receiptId: c.receiptId
								})}
							data-testid="answer-candidate">{t('rueckfragen.choose')}</button
						>
					</li>
				{:else}
					<li class="py-2 text-sm text-faint">{t('rueckfragen.noCandidates')}</li>
				{/each}
			</ul>
			<div class="mt-3 flex flex-wrap gap-2">
				{#if (q.candidates ?? []).length}
					<button
						type="button"
						class={button}
						disabled={busy !== null}
						onclick={() => answer(q.id, { choice: 'none' })}
						data-testid="answer-none">{t('rueckfragen.none')}</button
					>
				{/if}
				{#if q.transactionId}
					<button
						type="button"
						class={button}
						disabled={busy !== null}
						onclick={() => (asking = asking === q.id ? null : q.id)}
						aria-expanded={asking === q.id}
						data-testid="answer-no-receipt">{t('rueckfragen.noReceipt')}</button
					>
					<a
						class="{button} no-underline"
						href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(q.transactionId)}`}
						data-testid="answer-open-tx">{t('rueckfragen.openTx')}</a
					>
				{/if}
				<button
					type="button"
					class={button}
					disabled={busy !== null}
					onclick={() => answer(q.id, { choice: 'ignore' })}
					data-testid="answer-ignore">{t('rueckfragen.ignore')}</button
				>
			</div>
			{#if asking === q.id}
				<form
					class="mt-2 flex flex-wrap items-end gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						answer(q.id, { choice: 'no-receipt', reason: reasons[q.id] ?? '' });
					}}
				>
					<label class="flex min-w-48 flex-1 flex-col text-sm">
						<span class="text-faint">{t('rueckfragen.reason')}</span>
						<input
							class="mt-1 rounded-md border px-2 py-1.5 text-sm"
							bind:value={reasons[q.id]}
							placeholder={t('rueckfragen.reasonPlaceholder')}
							data-testid="answer-reason"
						/>
					</label>
					<button type="submit" class={primary} disabled={busy !== null}
						>{t('zahlungen.detail.save')}</button
					>
				</form>
			{/if}
		{/if}
	</section>
{:else}
	<p class="mt-4 {card} text-text" data-testid="questions-empty">{t('rueckfragen.empty')}</p>
{/each}

{#if answered.length}
	<details class="mt-6">
		<summary class="cursor-pointer text-sm text-text" data-testid="questions-answered"
			>{t('rueckfragen.answered', { count: answered.length })}</summary
		>
		<ul class="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-sm">
			{#each answered as q (q.id)}
				{@const r = q.receiptId ? receiptById.get(q.receiptId) : undefined}
				{@const x = q.transactionId ? txById.get(q.transactionId) : undefined}
				<li class="px-4 py-2 text-text">
					{heading(q)}: {r ? receiptVendor(r) : (x?.counterparty ?? '—')} –
					<span class="text-faint">{t(`rueckfragen.answer.${q.answer?.choice ?? 'auto'}`)}</span>
				</li>
			{/each}
		</ul>
	</details>
{/if}
