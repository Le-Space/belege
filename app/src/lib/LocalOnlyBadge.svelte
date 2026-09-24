<script>
	// Where escrow01 has its network dot (src/lib/NetworkStatusDot.svelte): the
	// network's state in the header, on every page. Here the state is always the
	// same, off, and the badge says so; it opens the consent screen, where the
	// network section says what that means and what is planned.
	import { consent } from './consent.js';
	import { t } from './i18n/index.js';
</script>

<button
	type="button"
	onclick={() => consent.reopen()}
	title={t('header.localOnlyTitle')}
	data-testid="local-only"
	class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
>
	<!-- Hollow: nothing connected, by design rather than by failure. -->
	<span class="h-2 w-2 shrink-0 rounded-full border-2 border-faint" aria-hidden="true"></span>
	<span>{t('header.localOnly')}</span>
</button>
