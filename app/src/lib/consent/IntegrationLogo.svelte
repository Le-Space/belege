<script>
	// One integration's mark on the consent screen: an embedded logo path
	// (integrations.js), or a neutral badge with its initials. Decorative: the
	// name next to it says what it is.
	import { LOGOS } from './integrations.js';

	/** @type {{ logo?: string, initials?: string }} */
	let { logo, initials = '?' } = $props();
	let mark = $derived(logo ? LOGOS[logo] : null);
</script>

{#if mark}
	<svg
		viewBox="0 0 24 24"
		class="h-5 w-5 shrink-0 {mark.color ? '' : 'text-heading'}"
		aria-hidden="true"
		data-testid="integration-logo"><path d={mark.path} fill={mark.color ?? 'currentColor'} /></svg
	>
{:else}
	<span
		class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-[9px] font-semibold text-heading"
		aria-hidden="true"
		data-testid="integration-initials">{initials}</span
	>
{/if}
