<script>
	// One value a person copies elsewhere – an address, a transaction hash, an
	// IBAN (issue #114) – with a copy button next to it. Clicking the value
	// itself copies too; the button is the way for the keyboard. A short
	// "Kopiert" confirms it for about two seconds, read out by screen readers.
	// Where the clipboard is refused, the value is selected instead (copy.js),
	// and the confirmation says so.
	import { onDestroy } from 'svelte';
	import { copyText } from './copy.js';
	import { t } from './i18n/index.js';

	/**
	 * @type {{
	 *   text: string,
	 *   label: string,
	 *   testid?: string,
	 *   class?: string,
	 *   valueClass?: string,
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let { text, label, testid = 'copy', class: className = '', valueClass = '', children } = $props();

	/** @type {HTMLElement | undefined} */
	let valueEl = $state();
	/** @type {import('./copy.js').CopyResult | ''} */
	let status = $state('');
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	async function copy() {
		status = await copyText(text, { element: valueEl });
		clearTimeout(timer);
		timer = setTimeout(() => (status = ''), 2000);
	}

	onDestroy(() => clearTimeout(timer));
</script>

<!-- Clicking the value is a mouse shortcut; the button next to it is the keyboard's way. -->
<span class={className} data-testid={testid}
	>{#if children}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><span
			bind:this={valueEl}
			class="cursor-copy {valueClass}"
			title={t('copy.clickToCopy')}
			onclick={copy}
			data-testid={`${testid}-value`}>{@render children()}</span
		>{/if}
	<button
		type="button"
		class="inline-flex translate-y-0.5 items-center rounded p-0.5 align-baseline text-faint hover:bg-surface-2 hover:text-heading"
		aria-label={label}
		title={label}
		onclick={copy}
		data-testid={`${testid}-button`}
		><svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			class="h-3.5 w-3.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path
				d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"
			/></svg
		></button
	><span
		class="ml-1 text-xs {status === 'copied'
			? 'text-emerald-700 dark:text-emerald-400'
			: 'text-faint'}"
		aria-live="polite"
		data-testid={`${testid}-status`}>{status ? t(`copy.${status}`) : ''}</span
	></span
>
