<script>
	// KI – Beleg-Auslesen (issue #152): which model the bridge uses, whether
	// its key is there, what was read so far. Moved from the Integrationen page.
	import { resolve } from '$app/paths';
	import WayOut from '$lib/help/WayOut.svelte';
	import CopyButton from '$lib/CopyButton.svelte';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { extractionTotals } from '$lib/activity/events.js';
	import { integer } from '$lib/receipts/how.js';
	import { describeMoment } from '$lib/moment.js';
	import { app } from '$lib/session.svelte.js';
	import { redactionFromStatus } from '$lib/llm-redaction.js';
	import { currentLocale, list, t } from '$lib/i18n/index.js';
	import { docUrl } from '$lib/help/integration-help.js';
	import { bridge, bridgeClient } from './bridge-state.svelte.js';

	/** @type {Awaited<ReturnType<ReturnType<typeof bridgeClient>['llmStatus']>> | null} */
	let llmStatus = $state(null);
	/** @type {string | null} */
	let llmError = $state(null);
	let totals = $derived(extractionTotals(app.events));
	// A model on this computer whose setup:llm answer is missing (a config from before #423).
	let unconfirmedLocal = $derived.by(() => {
		const status = /** @type {any} */ (llmStatus);
		return (
			status?.redaction?.mode === 'auto' &&
			/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(status?.provider ?? ''))
		);
	});
	let lastMoment = $derived(totals.lastAt ? describeMoment(totals.lastAt) : null);
	/** A confidential model's pin and last proof (#416), as /llm/status says. */
	let tee = $derived(/** @type {any} */ (llmStatus)?.tee ?? null);
	let token = $derived(bridge.token);

	async function loadLlmStatus() {
		llmError = null;
		try {
			llmStatus = await bridgeClient().llmStatus();
			// The AI hints elsewhere follow what the bridge says here (ai-text.js).
			app.llmRedaction = redactionFromStatus(llmStatus);
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
		<WayOut message={llmError} />
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
			{#if tee}
				<!-- A model in an attested enclave (#416): which one is pinned, and the last proof. -->
				<dt class="text-faint">{t('integrationen.ki.tee')}</dt>
				<dd
					class="text-heading"
					data-testid="ki-tee"
					data-state={tee.error ? 'failed' : tee.verifiedAt ? 'verified' : 'pinned'}
				>
					{tee.error
						? t('integrationen.ki.teeFailed', { error: tee.error })
						: tee.verifiedAt
							? t('integrationen.ki.teeVerified', {
									time: new Date(tee.verifiedAt).toLocaleString()
								})
							: t('integrationen.ki.teePinned')}
					<span class="mt-0.5 block font-mono text-xs break-all text-faint" data-testid="ki-tee-pin"
						>{t('integrationen.ki.teePin', {
							item: tee.itemHash,
							measurement: `${String(tee.measurement).slice(0, 16)}…`,
							commit: tee.sourceCommit ?? '—'
						})}</span
					>
				</dd>
			{/if}
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
			{#if llmStatus.redaction}
				<dt class="text-faint">{t('integrationen.ki.redaction')}</dt>
				<dd
					class="text-heading"
					data-testid="ki-redaction"
					data-active={llmStatus.redaction.active ? 'true' : 'false'}
				>
					{llmStatus.redaction.active
						? t('integrationen.ki.redactionOn')
						: /** @type {any} */ (llmStatus.redaction).enclave
							? t('integrationen.ki.redactionOffEnclave')
							: t('integrationen.ki.redactionOff')}
					{#if unconfirmedLocal}
						<!-- A model on this computer that setup:llm was not told about: blacked out until it is (#438). -->
						<span class="mt-1 block text-xs text-text" data-testid="ki-redaction-confirm">
							{t('integrationen.ki.redactionConfirm')}
							<CopyButton
								text="pnpm setup:llm"
								label={t('help.copyCommand')}
								testid="ki-redaction-command"
								valueClass="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-heading"
								>pnpm setup:llm</CopyButton
							>
						</span>
					{/if}
				</dd>
			{/if}
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
			<dd class="text-heading tabular-nums">
				<span data-testid="ki-totals"
					>{t('integrationen.ki.totalsValue', {
						calls: integer(totals.calls),
						tokens: integer(totals.tokens)
					})}{totals.failed
						? t('integrationen.ki.totalsFailed', { count: totals.failed })
						: ''}{totals.fallbacks
						? t('integrationen.ki.totalsFallback', { count: totals.fallbacks })
						: ''}</span
				>
				{#if totals.failed}
					<span class="mt-1 block text-xs text-text" data-testid="ki-failed">
						{t('integrationen.ki.failedRecent', { count: integer(totals.failedRecent) })}
					</span>
					<ul class="mt-0.5 text-xs text-faint" data-testid="ki-failed-reasons">
						{#each totals.failedReasons as r (r.reason)}
							<li>{integer(r.count)} × <span class="break-all">{r.reason}</span></li>
						{/each}
					</ul>
				{/if}
			</dd>
		</dl>
		<a
			href={`${resolve('/verlauf')}?group=auslesen`}
			class="mt-3 inline-block text-sm text-text underline hover:text-heading"
			data-testid="ki-verlauf">{t('integrationen.ki.verlauf')}</a
		>
	{/if}
	<!-- A model on this computer (docs/ollama.md): open while none is set up or one is local. -->
	<details
		class="mt-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm"
		open={!llmStatus?.configured || /:11434$/.test(String(llmStatus?.provider ?? ''))}
		data-testid="ki-ollama"
	>
		<!-- Not flex: that hides the disclosure triangle, and a closed guide read as a statement. -->
		<summary class="min-h-11 cursor-pointer py-2.5 font-medium text-heading">
			{t('integrationen.ki.ollama.title')}
		</summary>
		<p class="text-text">{t('integrationen.ki.ollama.intro')}</p>
		<ol class="mt-2 list-decimal space-y-1 pl-5 text-text">
			{#each list('integrationen.ki.ollama.steps') as step (step)}
				<li>{step}</li>
			{/each}
		</ol>
		<a
			class="mt-2 mb-2 inline-block text-text underline hover:text-heading"
			href={docUrl('docs/ollama{de}.md', currentLocale())}
			rel="noreferrer"
			data-testid="ki-ollama-doc">{t('integrationen.ki.ollama.doc')}</a
		>
	</details>
	<TechnicalNote class="mt-3" lines={list('integrationen.ki.technical')} />
</section>
