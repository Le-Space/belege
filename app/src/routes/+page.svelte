<script>
	import { resolve } from '$app/paths';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { list, t } from '$lib/i18n/index.js';
	import { app, runMatchingNow } from '$lib/session.svelte.js';
	import { isTxCovered, questionProgress } from '$lib/matching/view.js';

	const hour = new Date().getHours();
	const greeting = t(hour < 11 ? 'home.morning' : hour < 18 ? 'home.day' : 'home.evening');

	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';

	let progress = $derived(questionProgress(app.questions));
	let covered = $derived(app.transactions.filter((tx) => isTxCovered(tx, app.classifications)));
	let percent = $derived(
		app.transactions.length ? Math.round((covered.length / app.transactions.length) * 100) : 0
	);

	/** @type {string | null} */
	let result = $state(null);

	async function run() {
		result = null;
		const r = await runMatchingNow();
		result = r
			? t('home.matchResult', {
					sure: r.sure,
					questions:
						r.open === 0
							? t('home.agentNone')
							: r.open === 1
								? t('home.agentOpenOne')
								: t('home.agentOpenMany', { count: r.open })
				})
			: t('home.matchFailed');
	}
</script>

<h1 class="text-2xl font-bold text-heading">{greeting}!</h1>
<p class="mt-1 text-sm text-faint">{t('home.intro')}</p>

<section
	class="mt-6 overflow-hidden rounded-lg border border-cyan-800/40 bg-surface shadow-sm dark:border-cyan/40"
	aria-labelledby="agent-h"
	data-testid="agent-card"
>
	<div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
		<div class="min-w-0">
			<p class="text-xs font-semibold tracking-wide text-cyan-800 uppercase dark:text-cyan">
				{t('home.agentKind')}
			</p>
			<h2 id="agent-h" class="text-lg font-semibold text-heading">{t('home.agentTitle')}</h2>
			<p class="mt-1 text-sm text-text" data-testid="agent-open">
				{progress.open === 0
					? t('home.agentNone')
					: progress.open === 1
						? t('home.agentOpenOne')
						: t('home.agentOpenMany', { count: progress.open })}
			</p>
		</div>
		{#if progress.open > 0}
			<a
				href={resolve('/rueckfragen')}
				class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white no-underline hover:bg-coral-800"
				data-testid="agent-answer">{t('home.agentAnswer')}</a
			>
		{/if}
	</div>
	{#if progress.total > 0}
		<div class="border-t border-border px-5 py-3">
			<p class="text-xs text-faint" data-testid="agent-progress">
				{t('home.agentProgress', { done: progress.done, total: progress.total })}
			</p>
			<span
				class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border"
				role="progressbar"
				aria-label={t('home.agentProgress', { done: progress.done, total: progress.total })}
				aria-valuemin="0"
				aria-valuemax={progress.total}
				aria-valuenow={progress.done}
			>
				<span
					class="block h-full bg-identity"
					style="width: {Math.round((progress.done / progress.total) * 100)}%"
				></span>
			</span>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
		<button
			type="button"
			class="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50"
			onclick={run}
			disabled={app.matching}
			data-testid="match-run">{app.matching ? t('home.matchRunning') : t('home.matchRun')}</button
		>
		{#if result}
			<p class="text-sm text-heading" role="status" data-testid="match-result">{result}</p>
		{/if}
	</div>
</section>

<dl class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.transactions')}</dt>
		<dd
			class="mt-1 text-3xl font-semibold text-heading tabular-nums"
			data-testid="count-transactions"
		>
			{app.transactions.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.coverage')}</dt>
		<dd
			class="mt-1 text-3xl font-semibold text-heading tabular-nums"
			data-testid="coverage-percent"
		>
			{percent} %
		</dd>
		<dd class="text-xs text-faint">
			{t('home.coverageText', {
				covered: covered.length,
				count: app.transactions.length,
				percent
			})}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.receipts')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-receipts">
			{app.receipts.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.partners')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-partners">
			{app.partners.length}
		</dd>
	</div>
</dl>

{#if app.did}
	<section class="mt-6 {card}" data-testid="home-identity">
		<h2 class="text-sm font-medium text-faint">{t('home.identity')}</h2>
		<p class="mt-2 font-mono text-xs break-all text-heading">{app.did}</p>
		<p class="mt-2 text-xs text-faint">{t('home.identityHint')}</p>
		<TechnicalNote class="mt-3" lines={list('home.technical')} />
	</section>
{/if}
