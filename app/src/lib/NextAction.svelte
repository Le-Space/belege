<script>
	// The one next step of a payment (issue #1037), in place of the two chips
	// "Beleg fehlt" / "Konto fehlt": what is open, why, and the button that
	// does it – or that nothing is open. Not tied to a kind of booking; a
	// Bitcoin booking uses it first.

	/**
	 * @type {{
	 *   done: boolean,
	 *   label: string,
	 *   hint?: string,
	 *   action?: { label: string, run: () => void, testid?: string } | null,
	 *   state?: string,
	 *   busy?: boolean
	 * }}
	 */
	let { done, label, hint = '', action = null, state = '', busy = false } = $props();
</script>

<div
	class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2.5 {done
		? 'border-success/40 bg-success/5'
		: 'border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/30'}"
	data-testid="tx-next-step"
	data-state={done ? 'done' : 'open'}
>
	<p class="min-w-0 flex-[1_1_12rem] text-sm text-heading" data-testid="tx-next-step-label">
		{label}
		{#if hint}<span class="block text-xs text-faint">{hint}</span>{/if}
	</p>
	{#if action}
		<button
			type="button"
			class="min-h-9 rounded-md px-3 py-1.5 text-sm font-semibold {done
				? 'border border-border text-heading hover:bg-surface-2'
				: 'bg-coral-700 text-white hover:bg-coral-800'} disabled:opacity-50"
			disabled={busy}
			onclick={action.run}
			data-testid={action.testid ?? 'tx-next-step-action'}>{action.label}</button
		>
	{:else if state}
		<span
			class="text-xs font-semibold {done ? 'text-success' : 'text-amber-900 dark:text-amber-200'}"
			>{state}</span
		>
	{/if}
</div>
