<script>
	// A restore found no books for its passkey (new-books-question.svelte.js,
	// #555): open the books this passkey makes, or nothing. Escape cancels.
	import { newBooksQuestion, NewBooksDeclined } from './new-books-question.svelte.js';
	import { t } from './i18n/index.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog = $state();
	let question = $derived(newBooksQuestion.question);

	$effect(() => {
		if (!dialog) return;
		if (question && !dialog.open) dialog.showModal();
		else if (!question && dialog.open) dialog.close();
	});

	const cancel = () => newBooksQuestion.reject?.(new NewBooksDeclined());
</script>

<dialog
	bind:this={dialog}
	oncancel={(e) => {
		e.preventDefault();
		cancel();
	}}
	aria-labelledby="new-books-h"
	class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-[14px] border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
	data-testid="new-books-dialog"
>
	{#if question}
		<h2 id="new-books-h" class="text-lg font-semibold text-heading">
			{t('onboarding.newBooks.title')}
		</h2>
		<p class="mt-2 text-sm leading-relaxed" data-testid="new-books-why">
			{question.looked ? t('onboarding.newBooks.looked') : t('onboarding.newBooks.paused')}
		</p>
		<p class="mt-2 text-sm leading-relaxed">{t('onboarding.newBooks.made')}</p>
		<p class="mt-2 text-sm leading-relaxed text-faint">{t('onboarding.newBooks.added')}</p>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading"
				onclick={cancel}
				autofocus
				data-testid="new-books-cancel">{t('onboarding.newBooks.cancel')}</button
			>
			<button
				type="button"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800"
				onclick={() => newBooksQuestion.resolve?.()}
				data-testid="new-books-open">{t('onboarding.newBooks.open')}</button
			>
		</div>
	{/if}
</dialog>
