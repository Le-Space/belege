<script>
	// Rückfragen: what the matching engine was not sure about. Every answer is
	// a record the next run respects (matching/actions.js, engine.js).
	import { resolve } from '$app/paths';
	import { addressBook, payeeName } from '$lib/bank/payee.js';
	import { app, currentStore, runMatchingNow } from '$lib/session.svelte.js';
	import { answerQuestion, linkTransfer } from '$lib/matching/actions.js';
	import { loadTransferFirst, saveTransferFirst } from '$lib/jobs/workers.js';
	import { displayPurpose, formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptDate, receiptVendor } from '$lib/receipts/view.js';
	import { t } from '$lib/i18n/index.js';
	import { onMount } from 'svelte';
	import AiMark from '$lib/AiMark.svelte';
	import { getSetting } from '$lib/store/settings.js';
	import { refreshNow } from '$lib/session.svelte.js';
	import {
		aiEligible,
		aiEstimate,
		aiRun,
		cancelSuggestAll,
		dismissSuggestion,
		suggestAll,
		transferAsks
	} from '$lib/matching/ai-suggest.svelte.js';
	import { booksByYear, shownYear } from '$lib/year/year.svelte.js';

	// Only the questions of the year shown (year/year.js); the bulk buttons
	// count and act on those alone.
	let questions = $derived.by(() => {
		const index = booksByYear();
		const year = shownYear();
		return app.questions.filter((q) => index.questionYears(q).has(year));
	});
	let open = $derived(questions.filter((q) => q.state === 'open'));
	let answered = $derived(questions.filter((q) => q.state === 'answered'));
	let openElsewhere = $derived(
		app.questions.filter((q) => q.state === 'open').length - open.length
	);
	let txById = $derived(new Map(app.transactions.map((x) => [x.id, x])));
	let receiptById = $derived(new Map(app.receipts.map((r) => [r.id, r])));
	// A payment's name, never a bare dash (bank/payee.js).
	let book = $derived(addressBook(app));

	/** @type {{ matchAssist: (body: any) => Promise<any>, transferAssist: (body: any) => Promise<any> } | null} */
	let client = $state(null);
	/** "Zuerst prüfen, ob es eine eigene Umbuchung ist" (issue #109), kept in the settings. */
	let transferFirst = $state(false);
	onMount(async () => {
		const store = currentStore();
		if (store) transferFirst = await loadTransferFirst(store.settings);
		const saved = store ? await getSetting(store.settings, 'bridge') : null;
		if (!saved?.token) return;
		const { createBridgeClient } = await import('$lib/bridge/client.js');
		client = createBridgeClient({ url: saved.url, token: saved.token });
	});

	// "✦ KI-Vorschläge für alle offenen Rückfragen" (matching/ai-suggest.svelte.js).
	let eligible = $derived(aiEligible(questions));
	let extraAsks = $derived(transferFirst ? transferAsks(eligible, app.transactions) : 0);
	let estimate = $derived(aiEstimate(app.events, eligible.length + extraAsks));

	/** @param {boolean} on */
	async function setTransferFirst(on) {
		transferFirst = on;
		const store = currentStore();
		if (store) await saveTransferFirst(store.settings, on);
	}

	/** "Als Gegenbuchung verknüpfen" from a suggestion. @param {Record<string, any>} q */
	async function takeTransfer(q) {
		const store = currentStore();
		if (!store) return;
		busy = q.id;
		error = null;
		try {
			await linkTransfer(/** @type {any} */ (store), q.transactionId, q.aiSuggestion.transactionId);
			await runMatchingNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}
	let aiAsk = $state(false);
	/** Suggestions a person may take all at once: the model was sure, and not dismissed. */
	let sureOnes = $derived(
		open.filter(
			(q) =>
				q.aiSuggestion?.receiptId &&
				q.aiSuggestion.confidence === 'high' &&
				!q.aiSuggestion.dismissed &&
				receiptById.has(q.aiSuggestion.receiptId)
		)
	);

	async function startAi() {
		const store = currentStore();
		if (!client || !store) return;
		aiAsk = false;
		const c = client;
		await suggestAll(
			{
				client: c,
				store: () => /** @type {any} */ (currentStore()),
				refresh: refreshNow,
				transferFirst
			},
			eligible.map((q) => q.id)
		);
		await refreshNow();
	}

	/** @param {string} id */
	async function dismiss(id) {
		const store = currentStore();
		if (!store) return;
		await dismissSuggestion(/** @type {any} */ (store), id);
		await refreshNow();
	}

	async function takeAllSure() {
		const store = currentStore();
		if (!store) return;
		busy = 'all';
		error = null;
		try {
			for (const q of sureOnes) {
				await answerQuestion(/** @type {any} */ (store), q.id, {
					choice: 'candidate',
					receiptId: q.aiSuggestion.receiptId,
					transactionId: q.transactionId
				});
			}
			await runMatchingNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

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
{#if openElsewhere > 0}
	<p class="mt-1 text-sm text-faint" data-testid="questions-elsewhere">
		{t('year.hidden', { count: openElsewhere })}
	</p>
{/if}

{#if error}
	<p class="mt-3 text-sm text-danger" role="alert">{error}</p>
{/if}

{#if client && (eligible.length || aiRun.progress || sureOnes.length)}
	<section class="mt-4 {card}" data-testid="ai-all">
		<div class="flex flex-wrap items-center gap-3">
			{#if aiRun.progress}
				<p class="flex-1 text-sm text-heading" role="status" data-testid="ai-all-progress">
					<AiMark />
					{t('rueckfragen.ai.progress', {
						done: aiRun.progress.done,
						count: aiRun.progress.count
					})}
				</p>
				<button
					type="button"
					class={button}
					onclick={cancelSuggestAll}
					disabled={aiRun.cancelling}
					data-testid="ai-all-cancel"
					>{aiRun.cancelling ? t('rueckfragen.ai.cancelling') : t('rueckfragen.ai.cancel')}</button
				>
			{:else if eligible.length}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 {button}"
					onclick={() => (aiAsk = !aiAsk)}
					aria-expanded={aiAsk}
					data-testid="ai-all-open"
					><AiMark />{t('rueckfragen.ai.button', { count: eligible.length })}</button
				>
			{/if}
			{#if sureOnes.length && !aiRun.progress}
				<button
					type="button"
					class={primary}
					onclick={takeAllSure}
					disabled={busy !== null}
					data-testid="ai-take-sure"
					>{t('rueckfragen.ai.takeSure', { count: sureOnes.length })}</button
				>
			{/if}
		</div>
		{#if aiAsk && !aiRun.progress}
			<div class="mt-3 text-sm text-text" data-testid="ai-all-confirm">
				<p>
					{t('rueckfragen.ai.what', { count: estimate.requests })}
					{estimate.tokens
						? t('rueckfragen.ai.tokens', { tokens: estimate.tokens.toLocaleString('de-DE') })
						: t('rueckfragen.ai.tokensUnknown')}
				</p>
				<label class="mt-2 flex items-start gap-2">
					<input
						type="checkbox"
						class="mt-0.5"
						checked={transferFirst}
						onchange={(e) => setTransferFirst(e.currentTarget.checked)}
						data-testid="ai-all-transfer-first"
					/>
					<span>
						{t('rueckfragen.ai.transferFirst')}
						{#if transferFirst}
							<span class="block text-xs text-faint" data-testid="ai-all-transfer-what"
								>{t('rueckfragen.ai.transferFirstWhat', { count: extraAsks })}</span
							>
						{/if}
					</span>
				</label>
				<p class="mt-1 text-xs text-faint">{t('rueckfragen.ai.only')}</p>
				<div class="mt-2 flex gap-3">
					<button type="button" class={primary} onclick={startAi} data-testid="ai-all-start"
						>{t('rueckfragen.ai.start')}</button
					>
					<button type="button" class={button} onclick={() => (aiAsk = false)}
						>{t('rueckfragen.ai.no')}</button
					>
				</div>
			</div>
		{/if}
		{#if aiRun.failed && !aiRun.progress}
			<p class="mt-2 text-sm text-danger" data-testid="ai-all-failed">
				{t('rueckfragen.ai.failed', { count: aiRun.failed })}
			</p>
		{/if}
	</section>
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
				{payeeName(x, book).name}
			</p>
			{#if x.purpose}
				<p class="truncate text-sm text-faint" title={x.purpose} data-testid="question-purpose">
					{displayPurpose(x.purpose)}
				</p>
			{/if}
			<p class="text-sm text-faint">{txLine(x)}</p>
		{/if}

		{#if q.aiSuggestion?.kind === 'transfer' && !q.aiSuggestion.dismissed}
			{@const other = txById.get(q.aiSuggestion.transactionId)}
			<div
				class="mt-3 rounded-md border border-cyan-500 px-3 py-2 text-sm"
				data-testid="ai-suggestion"
				data-kind="transfer"
				data-confidence={q.aiSuggestion.confidence ?? 'none'}
			>
				<p class="flex items-center gap-1 text-xs font-medium text-cyan-800 dark:text-cyan-200">
					<AiMark />{t('rueckfragen.ai.transferPick', {
						confidence: t(`zahlungen.detail.aiConfidence.${q.aiSuggestion.confidence}`),
						reason: q.aiSuggestion.reason || '—'
					})}
				</p>
				{#if other}
					<p class="mt-1 font-medium text-heading">{payeeName(other, book).name}</p>
					<p class="text-xs text-faint">{txLine(other)}</p>
				{/if}
				<div class="mt-2 flex flex-wrap gap-2">
					{#if other}
						<button
							type="button"
							class={primary}
							disabled={busy !== null}
							onclick={() => takeTransfer(q)}
							data-testid="ai-suggestion-take-transfer">{t('rueckfragen.ai.transferTake')}</button
						>
					{/if}
					<button
						type="button"
						class={button}
						disabled={busy !== null}
						onclick={() => dismiss(q.id)}
						data-testid="ai-suggestion-dismiss">{t('rueckfragen.ai.dismiss')}</button
					>
				</div>
			</div>
		{:else if q.aiSuggestion && !q.aiSuggestion.dismissed}
			{@const pick = q.aiSuggestion.receiptId
				? receiptById.get(q.aiSuggestion.receiptId)
				: undefined}
			<div
				class="mt-3 rounded-md border border-cyan-500 px-3 py-2 text-sm"
				data-testid="ai-suggestion"
				data-confidence={q.aiSuggestion.confidence ?? 'none'}
			>
				<p class="flex items-center gap-1 text-xs font-medium text-cyan-800 dark:text-cyan-200">
					<AiMark />{pick
						? t('rueckfragen.ai.pick', {
								confidence: t(`zahlungen.detail.aiConfidence.${q.aiSuggestion.confidence}`),
								reason: q.aiSuggestion.reason || '—'
							})
						: t('rueckfragen.ai.nonePick')}
				</p>
				{#if pick}
					<p class="mt-1 font-medium text-heading">{receiptVendor(pick)}</p>
					<p class="text-xs text-faint">{receiptLine(pick)}</p>
				{/if}
				<div class="mt-2 flex flex-wrap gap-2">
					{#if pick}
						<button
							type="button"
							class={primary}
							disabled={busy !== null}
							onclick={() =>
								answer(q.id, {
									choice: 'candidate',
									receiptId: pick.id,
									transactionId: q.transactionId
								})}
							data-testid="ai-suggestion-take">{t('rueckfragen.ai.take')}</button
						>
					{/if}
					<button
						type="button"
						class={button}
						disabled={busy !== null}
						onclick={() => dismiss(q.id)}
						data-testid="ai-suggestion-dismiss">{t('rueckfragen.ai.dismiss')}</button
					>
				</div>
			</div>
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
								>{ct ? payeeName(ct, book).name : cr ? receiptVendor(cr) : '—'}</span
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
					{heading(q)}: {r ? receiptVendor(r) : x ? payeeName(x, book).name : '—'} –
					<span class="text-faint">{t(`rueckfragen.answer.${q.answer?.choice ?? 'auto'}`)}</span>
				</li>
			{/each}
		</ul>
	</details>
{/if}
