<script>
	// Deutsch / English in the header (issue #192): at once, kept in this
	// browser, offline (both catalogues are in the bundle). Shown only once the
	// English catalogue has every key, so nobody switches into half a language.
	import { LOCALES, currentLocale, englishReady, setLocale, t } from './i18n/index.js';

	const ready = englishReady();
</script>

{#if ready}
	<div
		role="group"
		aria-label={t('language.label')}
		class="inline-flex rounded-full border border-border p-0.5 text-xs"
		data-testid="language-switch"
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
				data-testid="language-{code}">{code.toUpperCase()}</button
			>
		{/each}
	</div>
{/if}
