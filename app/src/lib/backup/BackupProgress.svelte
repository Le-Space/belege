<script>
	// How far "Jetzt sichern" is (run.svelte.js): the step out of three, a bar,
	// and the step in words. A bar that cannot be told – sealing, an upload
	// the host does not let be counted, Aleph being asked – moves without a
	// number, and the words say how long it has been.
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n/index.js';
	import { backupRun, stepFraction, stepText } from './run.svelte.js';

	/** @type {{ compact?: boolean }} */
	let { compact = false } = $props();

	const STEPS = ['packing', 'uploading', 'keeping'];
	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	const index = $derived(STEPS.indexOf(backupRun.step) + 1);
	const fraction = $derived(stepFraction());
	const text = $derived(stepText(now));
</script>

{#if index > 0}
	<div class={compact ? 'w-16 shrink-0' : 'w-full max-w-md'} data-testid="backup-progress">
		{#if !compact}
			<p class="text-xs text-faint">
				{t('backup.progress.step', { index, total: STEPS.length })}
			</p>
		{/if}
		<div
			class="{compact ? '' : 'mt-1'} h-1.5 overflow-hidden rounded-full bg-surface-2"
			role="progressbar"
			aria-label={text}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
			data-testid="backup-progress-bar"
			data-percent={fraction === null ? '' : Math.round(fraction * 100)}
		>
			{#if fraction === null}
				<div class="indeterminate h-full w-1/3 rounded-full bg-cyan-700 dark:bg-cyan"></div>
			{:else}
				<div
					class="h-full rounded-full bg-cyan-700 transition-[width] dark:bg-cyan"
					style:width={`${Math.round(fraction * 100)}%`}
				></div>
			{/if}
		</div>
		{#if !compact}
			<p class="mt-1 text-sm text-faint" role="status" data-testid="backup-step">{text}</p>
		{/if}
	</div>
{/if}

<style>
	.indeterminate {
		animation: slide 1.4s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.indeterminate {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
