<script>
	// Asked once, in the backup card after a backup (#1049): keep the books'
	// vault sealed on Aleph, so that an empty device finds the books and these
	// backups with this passkey alone (keys/vault-offer.js). Yes publishes it
	// (index P and index M, session.svelte.js `publishBooksVault`), and every
	// later backup keeps index M current; no is kept in the sealed settings and
	// leaves today's way: the address typed on the empty device. Einstellungen →
	// Schlüssel offers it again for as long as it is off.
	import { app, declineVaultIndex, publishBooksVault } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { backupAsksVaultIndex } from './vault-offer.js';

	/** @type {{ backedUp: boolean }} */
	let { backedUp } = $props();

	let busy = $state('');
	/** @type {string | null} */
	let error = $state(null);
	let kept = $state(false);

	const shown = $derived(
		backupAsksVaultIndex({
			owner: !app.member && app.vault.slots.length > 0,
			indexOn: app.vault.indexOn,
			paused: app.network.paused,
			answered: app.vault.answered,
			backedUp
		})
	);

	/** @param {'yes' | 'no'} what @param {() => Promise<void>} fn */
	async function answer(what, fn) {
		busy = what;
		error = null;
		try {
			await fn();
			if (what === 'yes') kept = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}

	const button =
		'min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

{#if shown}
	<div
		class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
		role="group"
		aria-labelledby="vault-offer-h"
		data-testid="vault-offer"
	>
		<p id="vault-offer-h" class="font-semibold text-heading">{t('backup.vaultOffer.title')}</p>
		<p class="mt-1 text-text">{t('backup.vaultOffer.text')}</p>
		<div class="mt-2 flex flex-wrap gap-2">
			<button
				type="button"
				class={button}
				disabled={Boolean(busy)}
				onclick={() => answer('yes', () => publishBooksVault())}
				data-testid="vault-offer-yes"
				>{busy === 'yes' ? t('backup.vaultOffer.keeping') : t('backup.vaultOffer.yes')}</button
			>
			<button
				type="button"
				class={button}
				disabled={Boolean(busy)}
				onclick={() => answer('no', declineVaultIndex)}
				data-testid="vault-offer-no">{t('backup.vaultOffer.no')}</button
			>
		</div>
		{#if error}
			<p class="mt-2 text-danger" role="alert" data-testid="vault-offer-error">{error}</p>
		{/if}
	</div>
{:else if kept}
	<p class="mt-3 text-sm text-text" role="status" data-testid="vault-offer-kept">
		{t('backup.vaultOffer.kept')}
	</p>
{/if}
