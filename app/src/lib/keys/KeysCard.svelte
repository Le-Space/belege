<script>
	// Einstellungen → Schlüssel (#406): the books' passkeys, one slot each in
	// the vault (books-vault.js). Add one – a security key for the safe, say –
	// so a lost passkey no longer means lost books; take one out, plainly or
	// with a renewed vault for a passkey that may be in other hands; and keep
	// the vault on Aleph, so an empty device finds it with any of them
	// (backup/vault-index.js).
	import {
		addBooksPasskey,
		app,
		publishBooksVault,
		removeBooksPasskey
	} from '$lib/session.svelte.js';
	import { currentLocale, intlLocale, list, t } from '$lib/i18n/index.js';
	import { docUrl } from '$lib/help/integration-help.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';

	let label = $state('');
	let publish = $state(true);
	let busy = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);
	/** Which slot asks how to remove it. */
	let removing = $state('');

	const paused = $derived(app.network.paused);
	const single = $derived(app.vault.slots.length < 2);

	/** @param {string} iso */
	const when = (iso) =>
		iso ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(iso)) : '';

	/** @param {string} what @param {() => Promise<void>} fn @param {string} ok */
	async function act(what, fn, ok) {
		busy = what;
		error = null;
		done = null;
		try {
			await fn();
			done = ok;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}

	const add = () =>
		act(
			'add',
			async () => {
				await addBooksPasskey(label, { publish: publish && !paused });
				label = '';
			},
			t('settings.keys.added')
		);
	/** @param {string} kid @param {boolean} renew */
	const remove = (kid, renew) =>
		act(
			'remove',
			async () => {
				await removeBooksPasskey(kid, { renew });
				removing = '';
			},
			renew ? t('settings.keys.renewed') : t('settings.keys.removed')
		);
	const publishNow = () => act('publish', () => publishBooksVault(), t('settings.keys.published'));

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<section
	class="rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="keys-h"
	data-testid="keys-card"
>
	<h2 id="keys-h" class="text-lg font-semibold">{t('settings.keys.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('settings.keys.intro')}</p>

	{#if single}
		<p
			class="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-heading"
			role="alert"
			data-testid="keys-single"
		>
			<strong class="text-danger">{t('settings.keys.singleHeading')}</strong>
			{t('settings.keys.single')}
		</p>
	{/if}

	<ul class="mt-3 divide-y divide-border text-sm" data-testid="keys-list">
		{#each app.vault.slots as slot (slot.kid)}
			<li class="flex flex-wrap items-baseline gap-2 py-2" data-testid="keys-slot">
				<span class="text-heading">{slot.label || t('settings.keys.unnamed')}</span>
				<span class="text-xs text-faint"
					>{slot.addedAt ? t('settings.keys.since', { date: when(slot.addedAt) }) : ''}</span
				>
				{#if slot.mine}
					<span
						class="rounded-full border border-border px-2 py-0.5 text-xs text-text"
						data-testid="keys-slot-mine">{t('settings.keys.mine')}</span
					>
				{:else if removing === slot.kid}
					<span class="flex w-full flex-wrap items-center gap-2" role="alert">
						<span class="w-full text-xs text-text">{t('settings.keys.removeHow')}</span>
						<button
							type="button"
							class={button}
							disabled={Boolean(busy)}
							onclick={() => remove(slot.kid, false)}
							data-testid="keys-remove-plain">{t('settings.keys.removePlain')}</button
						>
						<button
							type="button"
							class={button}
							disabled={Boolean(busy)}
							onclick={() => remove(slot.kid, true)}
							data-testid="keys-remove-renew">{t('settings.keys.removeRenew')}</button
						>
						<button
							type="button"
							class={button}
							onclick={() => (removing = '')}
							data-testid="keys-remove-cancel">{t('backup.cancel')}</button
						>
					</span>
				{:else}
					<button
						type="button"
						class="ml-auto text-xs text-link underline disabled:opacity-50"
						disabled={Boolean(busy)}
						onclick={() => (removing = slot.kid)}
						data-testid="keys-remove">{t('settings.keys.remove')}</button
					>
				{/if}
			</li>
		{/each}
	</ul>

	<form
		class="mt-4 flex flex-col gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			add();
		}}
	>
		<label class="text-sm font-medium text-heading" for="keys-label"
			>{t('settings.keys.addLabel')}</label
		>
		<div class="flex flex-wrap gap-2">
			<input
				id="keys-label"
				class="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm"
				bind:value={label}
				placeholder={t('settings.keys.addPlaceholder')}
				data-testid="keys-add-label"
			/>
			<button type="submit" class={button} disabled={Boolean(busy)} data-testid="keys-add"
				>{busy === 'add' ? t('settings.keys.adding') : t('settings.keys.add')}</button
			>
		</div>
		<label class="flex items-start gap-2 text-sm text-text">
			<input
				type="checkbox"
				class="mt-1"
				bind:checked={publish}
				disabled={paused}
				data-testid="keys-publish"
			/>
			<span>{paused ? t('settings.keys.publishPaused') : t('settings.keys.publish')}</span>
		</label>
		<p class="text-xs text-faint">{t('settings.keys.addHint')}</p>
	</form>

	{#if !app.vault.indexOn && !single && !paused}
		<p class="mt-3 text-sm text-text" data-testid="keys-not-published">
			{t('settings.keys.notPublished')}
			<button
				type="button"
				class="text-link underline disabled:opacity-50"
				disabled={Boolean(busy)}
				onclick={publishNow}
				data-testid="keys-publish-now">{t('settings.keys.publishNow')}</button
			>
		</p>
	{/if}

	{#if done}
		<p class="mt-3 text-sm text-text" role="status" data-testid="keys-done">{done}</p>
	{/if}
	{#if error}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="keys-error">{error}</p>
	{/if}

	<p class="mt-3 text-xs text-faint">{t('settings.keys.removeLimit')}</p>
	<a
		class="mt-1 inline-block text-sm text-text underline hover:text-heading"
		href={docUrl('docs/keys{de}.md', currentLocale())}
		target="_blank"
		rel="noopener noreferrer"
		data-testid="keys-doc">{t('consent.storage.keysDoc')}</a
	>
	<TechnicalNote class="mt-3" lines={list('settings.keys.technical')} />
</section>
