<script>
	// KI – Beleg-Auslesen (issue #152): which model the bridge uses, whether
	// its key is there, what was read so far. Moved from the Integrationen page.
	import { resolve } from '$app/paths';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { extractionTotals } from '$lib/activity/events.js';
	import { integer } from '$lib/receipts/how.js';
	import { describeMoment } from '$lib/moment.js';
	import { app } from '$lib/session.svelte.js';
	import { list, t } from '$lib/i18n/index.js';
	import { bridge, bridgeClient } from './bridge-state.svelte.js';

	/** @type {Awaited<ReturnType<ReturnType<typeof bridgeClient>['llmStatus']>> | null} */
	let llmStatus = $state(null);
	/** @type {string | null} */
	let llmError = $state(null);
	let totals = $derived(extractionTotals(app.events));
	let lastMoment = $derived(totals.lastAt ? describeMoment(totals.lastAt) : null);
	let token = $derived(bridge.token);

	async function loadLlmStatus() {
		llmError = null;
		try {
			llmStatus = await bridgeClient().llmStatus();
		} catch (error) {
			llmStatus = null;
			llmError = error instanceof Error ? error.message : String(error);
		}
	}
	$effect(() => {
		if (bridge.token && bridge.state === 'online') loadLlmStatus();
	});
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="ki-h"
	data-testid="ki-card"
>
	<h2 id="ki-h" class="text-lg font-semibold">{t('integrationen.ki.title')}</h2>
	<p class="mt-1 text-sm text-text" data-testid="ki-simple">{t('integrationen.ki.simple')}</p>
	<p class="mt-1 text-sm text-text" data-testid="ki-key-where">{t('integrationen.ki.keyWhere')}</p>
	{#if !token}
		<p class="mt-3 text-sm text-faint">{t('integrationen.ki.noBridge')}</p>
	{:else if llmError}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="ki-error">
			{t('integrationen.ki.unreachable', { error: llmError })}
		</p>
	{:else if llmStatus}
		<dl
			class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
			data-testid="ki-status"
		>
			<dt class="text-faint">{t('integrationen.ki.provider')}</dt>
			<dd class="font-mono text-xs break-all text-heading" data-testid="ki-provider">
				{llmStatus.provider ?? '—'}
				{#if !llmStatus.configured}
					<span class="font-sans text-danger">· {t('integrationen.ki.notSetUp')}</span>
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.models')}</dt>
			<dd class="text-heading" data-testid="ki-models">
				{llmStatus.models.fallback
					? t('integrationen.ki.modelsValue', {
							primary: llmStatus.models.primary ?? '—',
							fallback: llmStatus.models.fallback
						})
					: (llmStatus.models.primary ?? '—')}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.key')}</dt>
			<dd
				class={llmStatus.keyConfigured ? 'font-medium text-success' : 'font-medium text-danger'}
				data-testid="ki-key"
				data-configured={llmStatus.keyConfigured ? 'true' : 'false'}
			>
				{llmStatus.keyConfigured ? t('integrationen.ki.keyOk') : t('integrationen.ki.keyMissing')}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.terms')}</dt>
			<dd class="text-heading tabular-nums" data-testid="ki-terms">{llmStatus.redactTerms}</dd>
			<dt class="text-faint">{t('integrationen.ki.authServ')}</dt>
			<dd class="text-heading" data-testid="ki-authserv">
				{#if llmStatus.mail?.authServId}
					<span class="font-mono text-xs">{llmStatus.mail.authServId}</span>
				{:else}
					<span class="text-text">{t('integrationen.ki.authServNone')}</span>
					<span class="block text-xs text-faint">{t('integrationen.ki.authServNoneHint')}</span>
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.last')}</dt>
			<dd class="text-heading" data-testid="ki-last">
				{#if lastMoment}
					<time datetime={lastMoment.datetime} title={lastMoment.utc}>{lastMoment.local}</time>
					{#if totals.lastModel}· <span class="font-mono text-xs">{totals.lastModel}</span>{/if}
				{:else}
					{t('integrationen.ki.lastNone')}
				{/if}
			</dd>
			<dt class="text-faint">{t('integrationen.ki.totals')}</dt>
			<dd class="text-heading tabular-nums" data-testid="ki-totals">
				{t('integrationen.ki.totalsValue', {
					calls: integer(totals.calls),
					tokens: integer(totals.tokens)
				})}{totals.failed
					? t('integrationen.ki.totalsFailed', { count: totals.failed })
					: ''}{totals.fallbacks
					? t('integrationen.ki.totalsFallback', { count: totals.fallbacks })
					: ''}
			</dd>
		</dl>
		<a
			href={`${resolve('/verlauf')}?group=auslesen`}
			class="mt-3 inline-block text-sm text-text underline hover:text-heading"
			data-testid="ki-verlauf">{t('integrationen.ki.verlauf')}</a
		>
	{/if}
	<TechnicalNote class="mt-3" lines={list('integrationen.ki.technical')} />
</section>
