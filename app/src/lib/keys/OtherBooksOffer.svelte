<script>
	// The other books of this passkey (#524, other-vault.js): a device that
	// founded books of its own learns here that its passkey has a slot in a
	// vault kept on Aleph, and may open those books instead. Shown where the
	// person runs into it – under a refused backup, under Settings → Keys –
	// and, as `banner`, on every page: there it only leads to the keys page.
	// After the switch it says what happened.
	import { resolve } from '$app/paths';
	import { app, openOtherBooks } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';

	/** @type {{ banner?: boolean }} */
	let { banner = false } = $props();

	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** "Später" on the banner: for this session. */
	let later = $state(false);

	const other = $derived(app.otherBooks);
	const since = $derived(
		other?.since
			? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(other.since))
			: ''
	);

	async function open() {
		busy = true;
		error = null;
		try {
			await openOtherBooks();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}

	const box =
		'rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100';
	const action =
		'inline-flex min-h-11 items-center rounded-md border border-amber-400 px-3 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:hover:bg-amber-900';
</script>

{#if banner}
	{#if app.otherBooksOpened && !later}
		<div
			class="mb-4 flex flex-wrap items-center justify-between gap-3 {box}"
			role="status"
			data-testid="other-books-result"
			data-result={app.otherBooksOpened}
		>
			<span
				>{app.otherBooksOpened === 'opened'
					? t('settings.keys.other.opened')
					: t('settings.keys.other.notOpened')}</span
			>
			<button
				type="button"
				class="min-h-11 rounded-md px-3 underline"
				onclick={() => (later = true)}
				data-testid="other-books-result-close">{t('settings.keys.other.close')}</button
			>
		</div>
	{:else if other && !later}
		<div
			class="mb-4 flex flex-wrap items-center justify-between gap-3 {box}"
			role="note"
			data-testid="other-books-banner"
		>
			<span>{t('settings.keys.other.banner')}</span>
			<span class="flex flex-wrap gap-2">
				<a
					class={action}
					href={resolve('/einstellungen/schluessel')}
					onclick={() => (later = true)}
					data-testid="other-books-banner-go">{t('settings.keys.other.bannerGo')}</a
				>
				<button
					type="button"
					class="min-h-11 rounded-md px-3 underline"
					onclick={() => (later = true)}
					data-testid="other-books-banner-later">{t('settings.keys.other.later')}</button
				>
			</span>
		</div>
	{/if}
{:else if other}
	<div class="mt-3 {box}" role="note" data-testid="other-books-offer">
		<p>
			<span class="font-semibold">{t('settings.keys.other.foundHeading')}</span>
			{t('settings.keys.other.found', { passkeys: other.passkeys })}
			{#if since}{t('settings.keys.other.foundSince', { date: since })}{/if}
			{#if other.words}{t('settings.keys.other.foundWords')}{/if}
		</p>
		<p class="mt-1">{t('settings.keys.other.openNote')}</p>
		<button
			type="button"
			class="mt-2 {action}"
			disabled={busy || app.network.paused}
			onclick={open}
			data-testid="other-books-open"
			>{busy ? t('settings.keys.other.opening') : t('settings.keys.other.open')}</button
		>
		{#if error}
			<p class="mt-2 text-danger" role="alert" data-testid="other-books-error">{error}</p>
		{/if}
	</div>
{/if}
