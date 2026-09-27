<script>
	// The PWA's two notes (issue #141): a new version waits ("Neu laden"), and
	// "Als App installieren" where the browser offers it. "Nicht jetzt" is
	// remembered in this browser.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/index.js';
	import { applyUpdate, installApp, pwa, startPwa } from './pwa.svelte.js';

	const DISMISSED = 'belege.pwa-install-dismissed';
	let dismissed = $state(false);

	onMount(() => {
		try {
			dismissed = localStorage.getItem(DISMISSED) === '1';
		} catch {
			// No storage: the offer shows each time.
		}
		startPwa();
	});

	function notNow() {
		dismissed = true;
		try {
			localStorage.setItem(DISMISSED, '1');
		} catch {
			// Not kept.
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading';
</script>

{#if pwa.updateReady}
	<div
		class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-cyan-500 bg-surface px-4 py-3 text-sm"
		role="status"
		data-testid="pwa-update"
	>
		<p class="flex-1 text-heading">{t('pwa.update')}</p>
		<button type="button" class={button} onclick={applyUpdate} data-testid="pwa-update-reload"
			>{t('pwa.reload')}</button
		>
	</div>
{:else if pwa.installable && !dismissed && !pwa.standalone}
	<div
		class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
		data-testid="pwa-install"
	>
		<p class="flex-1 text-text">{t('pwa.installWhat')}</p>
		<button type="button" class={button} onclick={installApp} data-testid="pwa-install-button"
			>{t('pwa.install')}</button
		>
		<button type="button" class={button} onclick={notNow} data-testid="pwa-install-later"
			>{t('pwa.later')}</button
		>
	</div>
{/if}
