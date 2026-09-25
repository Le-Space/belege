<script>
	// The review of a stopped recording ("Portal aufzeichnen", "Neues Portal
	// aufzeichnen"): the recorded steps as roles and labels, the pages as masked
	// paths, and the other hosts the way passed through – each one must be
	// ticked before the recipe can be saved; only those hosts are ever visited
	// by later fetches besides the portal's own site.
	import { t } from '../i18n/index.js';

	/**
	 * @type {{
	 *   review: import('./client.js').RecordingReview,
	 *   busy?: boolean,
	 *   onsave: (hosts: string[]) => void,
	 *   ondiscard: () => void
	 * }}
	 */
	let { review, busy = false, onsave, ondiscard } = $props();

	/** @type {Record<string, boolean>} */
	let confirmed = $state({});
	let hosts = $derived(review.hosts ?? []);
	let allConfirmed = $derived(hosts.every((h) => confirmed[h]));

	/** @param {import('./client.js').RecordedStep} step */
	function stepText(step) {
		const on = step.host ? t('portals.record.on', { host: step.host }) : '';
		if (step.kind === 'page') return t('portals.record.page', { path: step.path ?? '' }) + on;
		const role = t(`portals.record.role.${step.role ?? 'element'}`);
		return (
			(step.label ? `${role} ‚${step.label}‘` : role) +
			on +
			(step.download ? t('portals.record.download') : '') +
			(step.usable === false ? t('portals.record.unusable') : '')
		);
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div
	class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2"
	data-testid="portal-review"
>
	<p class="text-sm font-medium text-heading">{t('portals.record.reviewTitle')}</p>
	{#if review.steps.some((s) => s.kind === 'click')}
		<ol class="mt-1 list-decimal pl-5 text-sm text-text">
			{#each review.steps as step, i (i)}
				<li
					class={step.kind === 'page' ? 'list-none text-xs text-faint' : ''}
					data-testid={step.kind === 'click' ? 'portal-review-step' : null}
				>
					{stepText(step)}
				</li>
			{/each}
		</ol>
	{:else}
		<p class="mt-1 text-sm text-text">{t('portals.record.none')}</p>
	{/if}
	{#if review.pausedOnLogin > 0}
		<p class="mt-1 text-xs text-faint">
			{t('portals.record.paused', { count: review.pausedOnLogin })}
		</p>
	{/if}
	{#if !review.download}
		<p class="mt-1 text-sm text-danger" data-testid="portal-review-no-download">
			{t('portals.record.noDownload')}
		</p>
	{:else if review.invoice}
		<p class="mt-1 text-xs text-faint" data-testid="portal-review-invoice">
			{t('portals.record.invoiceKept')}
		</p>
	{/if}
	{#if hosts.length}
		<fieldset class="mt-2" data-testid="portal-review-hosts">
			<legend class="text-sm font-medium text-heading">{t('portals.record.hostsTitle')}</legend>
			<p class="text-xs text-faint">{t('portals.record.hostsHint')}</p>
			{#each hosts as host (host)}
				<label class="mt-1 flex items-center gap-2 text-sm text-text">
					<input
						type="checkbox"
						checked={Boolean(confirmed[host])}
						onchange={(e) =>
							(confirmed = {
								...confirmed,
								[host]: /** @type {HTMLInputElement} */ (e.currentTarget).checked
							})}
						data-testid="portal-review-host"
						data-host={host}
					/>
					<span>{t('portals.record.hostConfirm', { host })}</span>
				</label>
			{/each}
		</fieldset>
	{/if}
	<div class="mt-2 flex flex-wrap gap-3">
		<button
			type="button"
			class={primary}
			disabled={busy || !review.download || !allConfirmed}
			onclick={() => onsave(hosts.filter((h) => confirmed[h]))}
			data-testid="portal-record-save">{t('portals.record.save')}</button
		>
		<button
			type="button"
			class={button}
			disabled={busy}
			onclick={ondiscard}
			data-testid="portal-review-discard">{t('portals.record.discard')}</button
		>
	</div>
</div>
