<script>
	// Beside an error (issue #200, step 4): what to do about it – a command to
	// copy, a page to open. Shows nothing for a message without a known way out.
	import { resolve } from '$app/paths';
	import CopyButton from '$lib/CopyButton.svelte';
	import { t } from '$lib/i18n/index.js';
	import { wayOutOf } from './way-out.js';

	/** @type {{ message: unknown, class?: string }} */
	let { message, class: className = 'mt-1' } = $props();

	let way = $derived(wayOutOf(message));
</script>

{#if way}
	<p class="text-sm text-text {className}" data-testid="way-out" data-kind={way.kind}>
		{t(`help.wayOut.${way.kind}`)}
		{#if way.command}
			<CopyButton
				text={way.command}
				label={t('help.copyCommand')}
				testid="way-out-command"
				valueClass="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-heading"
				>{way.command}</CopyButton
			>
		{/if}
		{#if way.href}
			<a class="underline hover:text-heading" href={resolve(/** @type {any} */ (way.href))}
				>{t(`help.wayOutLink.${way.kind}`)}</a
			>
		{/if}
	</p>
{/if}
