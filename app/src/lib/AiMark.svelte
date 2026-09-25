<script>
	// The mark on everything that asks a language model: a small sparkle, and
	// for screen readers the word. What happens goes in the control's own
	// `title` (hover) and text next to it; this only marks it.
	import { t } from './i18n/index.js';
</script>

<svg
	class="inline-block h-3.5 w-3.5 shrink-0 align-[-2px]"
	viewBox="0 0 16 16"
	fill="currentColor"
	aria-hidden="true"
	data-testid="ai-mark"
>
	<path d="M8 1.5l1.4 3.6L13 6.5 9.4 7.9 8 11.5 6.6 7.9 3 6.5l3.6-1.4z" />
	<path d="M12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
</svg><span class="sr-only">{t('ai.mark')}</span>
