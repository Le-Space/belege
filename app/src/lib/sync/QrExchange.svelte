<script>
	// "Ohne Relay, per QR" (#148): one device shows an invite, the other scans
	// it and shows its answer, the first scans that back (sync/qr-link.js). In
	// Integrationen → Eigene Geräte, and in the header's network menu, where it
	// is needed after every reload (`compact`: a smaller code, fewer words).
	// The QR session is the module's (qr-link.js): an invite made in one place
	// is answered wherever the answer is scanned.
	import { renderSVG } from 'uqr';
	import { app, qrInvite, qrScanned } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import QrScan from './QrScan.svelte';

	/** @type {{ compact?: boolean, prefix?: string, scanPrefix?: string }} */
	let { compact = false, prefix = 'devices-qr', scanPrefix = 'devices-scan' } = $props();

	/** @type {'idle' | 'invite' | 'answer' | 'connected'} */
	let qrPhase = $state('idle');
	let qrCode = $state('');
	let pasted = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	async function invite() {
		busy = true;
		error = null;
		try {
			qrCode = await qrInvite();
			qrPhase = 'invite';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** An invite or an answer, scanned or pasted. @param {string} text */
	async function useCode(text) {
		busy = true;
		error = null;
		try {
			const done = await qrScanned(text);
			if ('answer' in done) {
				qrCode = done.answer;
				qrPhase = 'answer';
			} else {
				qrCode = '';
				qrPhase = 'connected';
			}
			pasted = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button = compact
		? 'min-h-9 rounded-md border border-border px-2.5 text-xs font-medium text-heading hover:bg-surface-2 disabled:opacity-50'
		: 'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<div class={compact ? 'text-xs' : 'mt-3 text-sm'} data-testid="{prefix}-mode">
	{#if !compact}<p class="text-text">{t('devices.qrMode.what')}</p>{/if}
	<div class="mt-2 flex flex-wrap items-center gap-2">
		<button
			type="button"
			class={button}
			disabled={busy}
			onclick={invite}
			data-testid="{prefix}-invite">{t('devices.qrMode.invite')}</button
		>
		<QrScan onscan={useCode} class={button} prefix={scanPrefix} />
	</div>
	{#if (qrPhase === 'invite' || qrPhase === 'answer') && qrCode}
		<!-- A white plaque in both themes: a camera reads it, not the theme. -->
		<div
			class="mt-3 w-fit rounded-md bg-white p-2 {compact ? '[&_svg]:size-56' : '[&_svg]:size-64'}"
			role="img"
			aria-label={t(`devices.qrMode.${qrPhase}Label`)}
			data-testid="{prefix}-code"
			data-phase={qrPhase}
			data-code={qrCode}
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of a signed code -->
			{@html renderSVG(qrCode, { border: 2 })}
		</div>
		<p class="mt-1 text-xs text-faint">{t(`devices.qrMode.${qrPhase}Hint`)}</p>
		<CopyButton
			text={qrCode}
			label={t('devices.qrMode.copy')}
			testid="{prefix}-copy"
			valueClass="hidden">{qrCode}</CopyButton
		>
	{:else if qrPhase === 'connected'}
		<p class="mt-2 text-success" role="status" data-testid="{prefix}-connected">
			{t('devices.qrMode.connected')}
		</p>
	{/if}
	<form
		class="mt-3 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			useCode(pasted);
		}}
	>
		<label class="flex flex-1 flex-col text-faint {compact ? 'min-w-40' : 'min-w-64 text-sm'}"
			>{t('devices.qrMode.pasteLabel')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
				bind:value={pasted}
				autocomplete="off"
				spellcheck="false"
				data-testid="{prefix}-paste"
			/></label
		>
		<button
			type="submit"
			class={button}
			disabled={busy || !pasted.trim()}
			data-testid="{prefix}-use">{t('devices.qrMode.use')}</button
		>
	</form>
	{#if !compact}<p class="mt-2 text-xs text-faint">{t('devices.qrMode.limits')}</p>{/if}
	<!-- In "Beides" the devices card's form says it. -->
	{#if error || (compact && app.sync.error) || (!compact && app.sync.error && app.network.mode === 'qr')}
		<p class="mt-2 text-danger {compact ? '' : 'text-sm'}" role="alert">
			{error ?? app.sync.error}
		</p>
	{/if}
</div>
