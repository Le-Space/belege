<script>
	// Integrationen → Rechnungs-App: pair Belege with the invoicing app over
	// UCEP (ucep/consumer.js), by an invitation it shows or by a code both
	// screens show, so it can make Eigenbelege for bookings without a receipt.
	import { app, currentStore, currentUcep, refreshUcep, startUcep } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { pairByCode, pairByInvitation, unpair } from './consumer.js';

	let invitation = $state('');
	let peerId = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let code = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @param {() => Promise<unknown>} work */
	async function run(work) {
		const store = currentStore();
		const ucep = currentUcep();
		if (!store || !ucep) return;
		busy = true;
		error = null;
		try {
			await work();
			await refreshUcep();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			code = null;
		}
	}

	const withInvitation = () =>
		run(async () => {
			const ucep = /** @type {any} */ (currentUcep());
			await pairByInvitation({
				consumer: ucep.consumer,
				settings: /** @type {any} */ (currentStore()).settings,
				uri: invitation
			});
			invitation = '';
		});

	const withCode = () =>
		run(async () => {
			const ucep = /** @type {any} */ (currentUcep());
			await pairByCode({
				consumer: ucep.consumer,
				settings: /** @type {any} */ (currentStore()).settings,
				peerId,
				relays: ucep.relays,
				onCode: (/** @type {string} */ shown) => (code = shown)
			});
			peerId = '';
		});

	const disconnect = () =>
		run(async () => {
			const ucep = /** @type {any} */ (currentUcep());
			await unpair({
				consumer: ucep.consumer,
				settings: /** @type {any} */ (currentStore()).settings
			});
		});

	const button =
		'rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-heading hover:bg-surface-2 disabled:opacity-50';
	const field = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm';
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="invoice-app-h"
	data-testid="invoice-app-card"
>
	<h2 id="invoice-app-h" class="text-lg font-semibold">{t('integrationen.invoiceApp.title')}</h2>
	<p class="mt-2 text-sm text-text">{t('integrationen.invoiceApp.intro')}</p>

	{#if app.ucep.status === 'off'}
		<p class="mt-2 text-xs text-faint">{t('integrationen.invoiceApp.offHint')}</p>
		<button type="button" class="mt-2 {button}" onclick={startUcep} data-testid="invoice-app-start"
			>{t('integrationen.invoiceApp.start')}</button
		>
	{:else if app.ucep.status === 'failed'}
		<p class="mt-2 text-sm text-danger" role="alert">
			{t('integrationen.invoiceApp.failed')}
			{app.ucep.error}
		</p>
	{:else if app.ucep.status !== 'running'}
		<p class="mt-2 text-sm text-faint">{t('integrationen.invoiceApp.starting')}</p>
	{:else if app.ucep.app}
		<p class="mt-3 text-sm" data-testid="invoice-app-paired">
			{t('integrationen.invoiceApp.paired', {
				since: new Date(app.ucep.app.pairedAt).toLocaleString('de-DE')
			})}
		</p>
		<p class="font-mono text-xs break-all text-faint">{app.ucep.app.peerId}</p>
		<button
			type="button"
			class="mt-2 {button}"
			disabled={busy}
			onclick={disconnect}
			data-testid="invoice-app-unpair">{t('integrationen.invoiceApp.unpair')}</button
		>
	{:else}
		<div class="mt-3 space-y-2">
			<label class="block text-sm"
				><span class="block text-xs text-faint">{t('integrationen.invoiceApp.invitation')}</span>
				<textarea
					class="{field} font-mono text-xs"
					rows="3"
					bind:value={invitation}
					data-testid="invoice-app-invitation"
				></textarea></label
			>
			<button
				type="button"
				class={button}
				disabled={busy || !invitation.trim()}
				onclick={withInvitation}
				data-testid="invoice-app-pair">{t('integrationen.invoiceApp.pair')}</button
			>
		</div>
		<div class="mt-4 space-y-2 border-t border-border pt-3">
			<label class="block text-sm"
				><span class="block text-xs text-faint">{t('integrationen.invoiceApp.peerId')}</span>
				<input
					class="{field} font-mono text-xs"
					bind:value={peerId}
					spellcheck="false"
					data-testid="invoice-app-peer-id"
				/></label
			>
			<button
				type="button"
				class={button}
				disabled={busy || !peerId.trim()}
				onclick={withCode}
				data-testid="invoice-app-pair-code">{t('integrationen.invoiceApp.pairByCode')}</button
			>
			{#if code}
				<p class="text-sm" role="status">
					{t('integrationen.invoiceApp.showCode')}
					<strong class="ml-1 font-mono text-2xl tracking-widest" data-testid="invoice-app-code"
						>{code}</strong
					>
				</p>
			{/if}
		</div>
	{/if}
	{#if busy && !code}<p class="mt-2 text-sm text-faint" role="status">
			{t('integrationen.invoiceApp.busy')}
		</p>{/if}
	{#if error}<p class="mt-2 text-sm text-danger" role="alert" data-testid="invoice-app-error">
			{error}
		</p>{/if}
	{#if app.ucep.peerId}
		<p class="mt-3 text-xs text-faint">
			{t('integrationen.invoiceApp.ownPeerId')}
			<span class="font-mono break-all">{app.ucep.peerId}</span>
		</p>
	{/if}
</section>
