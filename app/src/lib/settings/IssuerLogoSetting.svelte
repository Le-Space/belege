<script>
	// The company's own logo (#906), set beside the company's name: kept in the
	// sealed settings at once (settings/issuer-logo.js), drawn on every document
	// the app makes for these books while "on the documents" is ticked.
	import { onDestroy, onMount } from 'svelte';
	import { currentStore } from '../session.svelte.js';
	import { getSetting } from '../store/settings.js';
	import { t } from '../i18n/index.js';
	import {
		cleanIssuerLogo,
		ISSUER_LOGO_KEY,
		ISSUER_LOGO_MAX_BYTES,
		issuerLogoFrom,
		issuerLogoUrl,
		saveIssuerLogo
	} from './issuer-logo.js';

	/** @type {import('./issuer-logo.js').IssuerLogo | null} */
	let logo = $state(null);
	let url = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);
	let busy = $state(false);
	/** @type {HTMLInputElement | undefined} */
	let input = $state();

	/** @param {import('./issuer-logo.js').IssuerLogo | null} next */
	function show(next) {
		if (url) URL.revokeObjectURL(url);
		logo = next;
		url = next ? issuerLogoUrl(next) : '';
	}

	onMount(async () => {
		const store = currentStore();
		if (store) show(cleanIssuerLogo(await getSetting(store.settings, ISSUER_LOGO_KEY)));
	});
	onDestroy(() => {
		if (url) URL.revokeObjectURL(url);
	});

	/** @param {import('./issuer-logo.js').IssuerLogo | null} next @param {string} said */
	async function keep(next, said) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		try {
			await saveIssuerLogo(store.settings, next);
			show(next);
			done = said;
		} finally {
			busy = false;
		}
	}

	async function choose() {
		error = null;
		done = null;
		const file = input?.files?.[0];
		if (!file) return;
		try {
			// The size first: a photo chosen by mistake is not read.
			if (file.size > ISSUER_LOGO_MAX_BYTES) {
				error = t('anweisungen.issuerLogo.bad', {
					error: t('anweisungen.issuerLogo.tooLarge', { kb: Math.ceil(file.size / 1024) })
				});
				return;
			}
			let next;
			try {
				next = issuerLogoFrom(new Uint8Array(await file.arrayBuffer()));
			} catch (e) {
				if (/** @type {Error} */ (e)?.name !== 'ImageError') throw e;
				error = t('anweisungen.issuerLogo.bad', { error: /** @type {Error} */ (e).message });
				return;
			}
			await keep(next, t('anweisungen.issuerLogo.saved'));
		} finally {
			if (input) input.value = '';
		}
	}
</script>

<div class="flex flex-col text-sm" data-testid="issuer-logo">
	<span class="font-medium text-heading">{t('anweisungen.issuerLogo.label')}</span>
	{#if logo}
		<div class="mt-1 flex flex-wrap items-center gap-3">
			<img
				src={url}
				alt={t('anweisungen.issuerLogo.alt')}
				class="max-h-12 max-w-40 rounded border border-border bg-white p-1"
				data-testid="issuer-logo-preview"
			/>
			<span class="text-xs text-faint"
				>{t('anweisungen.issuerLogo.size', { width: logo.width, height: logo.height })}</span
			>
			<button
				type="button"
				class="text-xs text-faint underline hover:text-heading"
				disabled={busy}
				onclick={() => keep(null, t('anweisungen.issuerLogo.removed'))}
				data-testid="issuer-logo-remove">{t('anweisungen.issuerLogo.remove')}</button
			>
		</div>
		<label class="mt-2 inline-flex items-center gap-2">
			<input
				type="checkbox"
				checked={logo.on}
				disabled={busy}
				onchange={(e) =>
					logo &&
					keep(
						{ ...logo, on: /** @type {HTMLInputElement} */ (e.currentTarget).checked },
						t('anweisungen.issuerLogo.saved')
					)}
				data-testid="issuer-logo-on"
			/>
			<span>{t('anweisungen.issuerLogo.on')}</span>
		</label>
	{/if}
	<input
		bind:this={input}
		type="file"
		accept="image/png,image/jpeg"
		class="mt-2 text-sm"
		disabled={busy}
		onchange={choose}
		aria-label={t(logo ? 'anweisungen.issuerLogo.replace' : 'anweisungen.issuerLogo.choose')}
		data-testid="issuer-logo-file"
	/>
	<span class="mt-1 text-xs text-faint">{t('anweisungen.issuerLogo.hint')}</span>
	{#if error}
		<span class="mt-1 text-xs text-danger" role="alert" data-testid="issuer-logo-error"
			>{error}</span
		>
	{/if}
	{#if done}
		<span class="mt-1 text-xs text-faint" role="status">{done}</span>
	{/if}
</div>
