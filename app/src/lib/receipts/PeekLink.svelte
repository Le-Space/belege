<script>
	// A link to a receipt with its hover preview (#273, receipts/peek.js), for
	// pages that name receipts in lists – the travel pages' open points,
	// proposals, hospitality bills, checks and a trip's receipts, the export's
	// check list. `before`: text in the same row, which shows the preview too.
	// The page holds one preview (`peek`) and shows it with ReceiptPeek; on a
	// touch screen a "Vorschau" button opens it.
	import { canPeek, peekHandlers } from './peek.js';
	import { t } from '../i18n/index.js';

	/**
	 * @type {{
	 *   receipt: Record<string, any> | null | undefined,
	 *   href: string,
	 *   peek: ReturnType<typeof import('./peek.js').createPeek<HTMLElement>>,
	 *   open?: boolean,
	 *   class?: string,
	 *   testid?: string,
	 *   kind?: string,
	 *   before?: import('svelte').Snippet,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let {
		receipt,
		href,
		peek,
		open = false,
		class: cls = '',
		testid,
		kind,
		before,
		children
	} = $props();

	/** @type {HTMLElement | undefined} */
	let row = $state();
	let can = $derived(Boolean(receipt && canPeek(receipt)));
</script>

<span
	bind:this={row}
	class="flex min-w-0 items-center gap-2"
	{...can && receipt ? peekHandlers(peek, receipt) : {}}
>
	{#if before}{@render before()}{/if}
	<a class={cls} {href} data-testid={testid} data-kind={kind}>{@render children()}</a>
	{#if can && receipt}
		<!-- No hover on a touch screen: the preview on a tap. -->
		<button
			type="button"
			class="hidden shrink-0 text-xs text-text underline pointer-coarse:inline"
			aria-expanded={open}
			onclick={() => row && peek.toggle(receipt, row)}
			data-testid="peek-open">{t('zahlungen.detail.peek.open')}</button
		>
	{/if}
</span>
