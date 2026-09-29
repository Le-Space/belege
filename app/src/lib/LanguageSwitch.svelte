<script>
	// Deutsch / English in the header (issue #192): at once, kept in this
	// browser, offline (both catalogues are in the bundle). Shown only once the
	// English catalogue has every key, so nobody switches into half a language.
	// Also in the consent screen, which covers the header on the first visit.
	import { LOCALES, currentLocale, englishReady, setLocale, t } from './i18n/index.js';

	/** @type {{ testid?: string }} */
	let { testid = 'language' } = $props();

	const ready = englishReady();
</script>

{#if ready}
	<div
		role="group"
		aria-label={t('language.label')}
		class="inline-flex rounded-full border border-border p-0.5 text-xs"
		data-testid="{testid}-switch"
	>
		{#each LOCALES as code (code)}
			<button
				type="button"
				class="rounded-full px-2 py-1 font-medium {currentLocale() === code
					? 'bg-surface-2 text-heading'
					: 'text-text hover:text-heading'}"
				aria-pressed={currentLocale() === code}
				lang={code}
				title={t(`language.${code}`)}
				onclick={() => setLocale(code)}
				data-testid="{testid}-{code}">{code.toUpperCase()}</button
			>
		{/each}
	</div>
{/if}
