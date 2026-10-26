<script>
	// Recovery words for the books (#406, stage 2), under Einstellungen →
	// Schlüssel: 24 words made here, shown once to be written on paper, three
	// of them asked back, then a slot in the vault (recovery-words.js,
	// books-vault.js). The words are never stored: closing this before the
	// last step leaves nothing behind. With them an empty device opens the
	// books without any passkey (the lock screen's "Mit Wiederherstellungswörtern
	// öffnen").
	import { addBooksRecoveryWords, app, removeBooksRecoveryWords } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';

	/** @type {'idle' | 'show' | 'ask'} */
	let step = $state('idle');
	/** @type {string[]} */
	let words = $state([]);
	/** @type {number[]} */
	let positions = $state([]);
	/** @type {Record<number, string>} */
	let answers = $state({});
	let written = $state(false);
	/** Keep the vault on Aleph, so an empty device finds it with the words alone. */
	let publish = $state(true);
	let busy = $state(false);
	let confirmRemove = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);

	const paused = $derived(app.network.paused);

	/** @param {string} iso */
	const when = (iso) =>
		iso ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(iso)) : '';

	/** Forget the words on screen: they live nowhere else. */
	function forget() {
		words = [];
		answers = {};
		positions = [];
		written = false;
		step = 'idle';
	}

	async function start() {
		error = null;
		done = null;
		const { newRecoveryWords, positionsToAsk } = await import('$lib/recovery-words.js');
		words = await newRecoveryWords();
		positions = positionsToAsk(3);
		answers = {};
		written = false;
		step = 'show';
	}

	async function confirm() {
		error = null;
		const wrong = positions.filter((p) => (answers[p] ?? '').trim().toLowerCase() !== words[p - 1]);
		if (wrong.length) {
			error = t('settings.keys.words.wrongBack', { positions: wrong.join(', ') });
			return;
		}
		busy = true;
		try {
			await addBooksRecoveryWords($state.snapshot(words), { publish: publish && !paused });
			done = t('settings.keys.words.added');
			forget();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		error = null;
		done = null;
		busy = true;
		try {
			await removeBooksRecoveryWords();
			done = t('settings.keys.words.removed');
			confirmRemove = false;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<div class="mt-5 border-t border-border pt-4" data-testid="words-section">
	<h3 class="text-base font-semibold text-heading">{t('settings.keys.words.title')}</h3>
	<p class="mt-1 text-sm text-text">{t('settings.keys.words.what')}</p>

	{#if app.vault.words && step === 'idle'}
		<p class="mt-2 text-sm text-heading" data-testid="words-has">
			{t('settings.keys.words.has', { date: when(app.vault.words.addedAt) })}
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<button type="button" class={button} disabled={busy} onclick={start} data-testid="words-new"
				>{t('settings.keys.words.new')}</button
			>
			{#if confirmRemove}
				<span class="text-xs text-text">{t('settings.keys.words.removeSure')}</span>
				<button
					type="button"
					class={button}
					disabled={busy}
					onclick={remove}
					data-testid="words-remove-yes">{t('settings.keys.words.removeYes')}</button
				>
				<button type="button" class={button} onclick={() => (confirmRemove = false)}
					>{t('backup.cancel')}</button
				>
			{:else}
				<button
					type="button"
					class="text-xs text-link underline disabled:opacity-50"
					disabled={busy}
					onclick={() => (confirmRemove = true)}
					data-testid="words-remove">{t('settings.keys.words.remove')}</button
				>
			{/if}
		</div>
	{:else if step === 'idle'}
		<p
			class="mt-2 rounded-md border border-warning/50 px-3 py-2 text-sm text-heading"
			role="note"
			data-testid="words-none"
		>
			{t('settings.keys.words.none')}
		</p>
		<button
			type="button"
			class="mt-2 {button}"
			disabled={busy}
			onclick={start}
			data-testid="words-start">{t('settings.keys.words.start')}</button
		>
	{/if}

	{#if step === 'show'}
		<div class="mt-3" data-testid="words-show">
			<p class="text-sm text-heading">{t('settings.keys.words.writeDown')}</p>
			<ol
				class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-3 font-mono text-sm sm:grid-cols-3"
				data-testid="words-grid"
			>
				{#each words as word, i (i)}
					<li class="flex gap-2">
						<span class="w-6 text-right text-faint">{i + 1}.</span>
						<span class="text-heading" data-testid="words-word">{word}</span>
					</li>
				{/each}
			</ol>
			<p class="mt-2 text-xs text-faint">{t('settings.keys.words.paper')}</p>
			<label class="mt-2 flex items-start gap-2 text-sm text-text">
				<input type="checkbox" class="mt-1" bind:checked={written} data-testid="words-written" />
				<span>{t('settings.keys.words.written')}</span>
			</label>
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class={button}
					disabled={!written}
					onclick={() => (step = 'ask')}
					data-testid="words-next">{t('settings.keys.words.next')}</button
				>
				<button type="button" class={button} onclick={forget} data-testid="words-cancel"
					>{t('backup.cancel')}</button
				>
			</div>
		</div>
	{:else if step === 'ask'}
		<form
			class="mt-3 flex flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				confirm();
			}}
			data-testid="words-ask"
		>
			<p class="text-sm text-heading">{t('settings.keys.words.askBack')}</p>
			<div class="flex flex-wrap gap-2">
				{#each positions as p (p)}
					<label class="flex items-center gap-1 text-sm text-text">
						<span class="w-8 text-right text-faint">{p}.</span>
						<input
							class="w-32 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							bind:value={answers[p]}
							data-testid="words-ask-input"
							data-position={p}
						/>
					</label>
				{/each}
			</div>
			<label class="flex items-start gap-2 text-sm text-text">
				<input
					type="checkbox"
					class="mt-1"
					bind:checked={publish}
					disabled={paused}
					data-testid="words-publish"
				/>
				<span>{paused ? t('settings.keys.publishPaused') : t('settings.keys.words.publish')}</span>
			</label>
			<div class="flex flex-wrap gap-2">
				<button type="submit" class={button} disabled={busy} data-testid="words-confirm"
					>{busy ? t('settings.keys.words.saving') : t('settings.keys.words.confirm')}</button
				>
				<button type="button" class={button} onclick={() => (step = 'show')}
					>{t('settings.keys.words.back')}</button
				>
			</div>
		</form>
	{/if}

	{#if done}
		<p class="mt-2 text-sm text-text" role="status" data-testid="words-done">{done}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="words-error">{error}</p>
	{/if}
	<p class="mt-2 text-xs text-faint">{t('settings.keys.words.equivalent')}</p>
</div>
