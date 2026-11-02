<script>
	// Between two passkey prompts: what the next touch is for, and "Weiter"
	// starts it (passkey-steps.svelte.js, #429). Escape cancels like "Abbrechen".
	import { passkeyStep, PasskeyStepCancelled } from './passkey-steps.svelte.js';
	import { t } from './i18n/index.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog = $state();
	let step = $derived(passkeyStep.step);

	$effect(() => {
		if (!dialog) return;
		if (step && !dialog.open) dialog.showModal();
		else if (!step && dialog.open) dialog.close();
	});

	const cancel = () => passkeyStep.reject?.(new PasskeyStepCancelled());
</script>

<dialog
	bind:this={dialog}
	oncancel={(e) => {
		e.preventDefault();
		cancel();
	}}
	aria-labelledby="passkey-step-h"
	class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-[14px] border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
	data-testid="passkey-step-dialog"
>
	{#if step}
		<p
			class="text-xs font-semibold tracking-wide text-faint uppercase"
			data-testid="passkey-step-count"
		>
			{t('onboarding.steps.count', { n: step.n, of: step.of })}
		</p>
		<h2 id="passkey-step-h" class="mt-1 text-lg font-semibold text-heading">
			{t(`onboarding.steps.${step.purpose}.title`)}
		</h2>
		<p class="mt-2 text-sm leading-relaxed">{t(`onboarding.steps.${step.purpose}.why`)}</p>
		<p class="mt-2 text-sm leading-relaxed text-faint">{t('onboarding.steps.notALoop')}</p>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading"
				onclick={cancel}
				data-testid="passkey-step-cancel">{t('onboarding.steps.cancel')}</button
			>
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800"
				onclick={() => passkeyStep.resolve?.()}
				autofocus
				data-testid="passkey-step-continue">{t('onboarding.steps.continue')}</button
			>
		</div>
	{/if}
</dialog>
