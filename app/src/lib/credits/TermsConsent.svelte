<script>
	// The terms (AGB) of Le Space for Belege's paid offers: agree to the version
	// in force before a purchase, and to an announced one before it takes
	// effect. Shows nothing while the service has published none. The version,
	// the changes and the link are the service's word: shown as text, the link
	// only to the service's own origin (credits.js, publishedTerms).
	import { formatDate } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { locale } from '$lib/i18n/locale.svelte.js';

	/**
	 * @type {{
	 *   client: { acceptTerms: (version: string) => Promise<unknown> },
	 *   terms: ReturnType<typeof import('./credits.js').termsOf> | null,
	 *   published: import('./credits.js').PublishedTerms | null,
	 *   onaccepted?: () => void
	 * }}
	 */
	let { client, terms, published, onaccepted = () => {} } = $props();

	let read = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	const target = $derived(
		terms?.due ? published?.current : terms?.announced ? published?.pending : null
	);

	async function agree() {
		if (!target) return;
		busy = true;
		error = null;
		try {
			await client.acceptTerms(target.version);
			read = false;
			onaccepted();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if target}
	<div
		class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
		role="region"
		aria-label={t('credits.terms.label')}
		data-testid="credits-terms"
		data-due={terms?.due ? 'true' : 'false'}
	>
		<p class="font-medium text-heading">
			{terms?.due
				? t('credits.terms.due')
				: t('credits.terms.announced', {
						date: target.effectiveAt ? formatDate(target.effectiveAt.slice(0, 10)) : '—'
					})}
		</p>
		{#if locale.current !== 'de'}
			<p class="mt-1 text-xs text-faint">{t('credits.terms.germanNote')}</p>
		{/if}
		{#if target.changes.length}
			<ul class="mt-1 list-disc pl-5 text-text" lang="de" data-testid="credits-terms-changes">
				{#each target.changes as change (change)}
					<li>{change}</li>
				{/each}
			</ul>
		{/if}
		{#if target.url}
			<p class="mt-1">
				<a
					href={target.url}
					target="_blank"
					rel="noopener noreferrer"
					class="text-heading underline"
					data-testid="credits-terms-link">{t('credits.terms.read', { version: target.version })}</a
				>
			</p>
		{/if}
		<label class="mt-2 flex items-start gap-2">
			<input type="checkbox" class="mt-0.5" bind:checked={read} data-testid="credits-terms-read" />
			<span class="text-text">{t('credits.terms.consent', { version: target.version })}</span>
		</label>
		<button
			type="button"
			class="mt-2 rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
			disabled={!read || busy}
			onclick={agree}
			data-testid="credits-terms-accept">{t('credits.terms.agree')}</button
		>
		{#if error}
			<p class="mt-2 text-danger" role="alert">{error}</p>
		{/if}
	</div>
{:else if terms?.accepted}
	<p class="mt-2 text-xs text-faint" data-testid="credits-terms-accepted">
		{t('credits.terms.accepted', { version: terms.accepted })}
	</p>
{/if}
