<script>
	// Integrationen → Eigene Geräte (#123): this device's id to type on the
	// other one or to show as a QR code, "Gerät hinzufügen" by id or by
	// scanning, and the devices the books know with their connection and
	// "Entfernen". Device sync itself is switched on in the consent screen.
	// In the mode "Ohne Relay, per QR" (#148) there is no id to type: one
	// device shows an invite, the other scans it and shows its answer, the
	// first scans that back (sync/qr-link.js).
	import { renderSVG } from 'uqr';
	import {
		app,
		addSyncDevice,
		qrInvite,
		qrScanned,
		removeSyncDevice
	} from '$lib/session.svelte.js';
	import { consent } from '$lib/consent.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import QrScan from './QrScan.svelte';
	import { deviceCode, deviceSyncOn, parseDeviceCode } from './device-sync.js';
	import { bridgeShareOn, setBridgeShare } from './remote-bridge.js';

	let other = $state('');
	let showQr = $state(false);
	let shareOn = $state(bridgeShareOn());
	/** @type {string | null} the device whose removal waits for a second click */
	let confirming = $state(null);

	/** @param {string} text */
	async function scanned(text) {
		const id = parseDeviceCode(text);
		if (!id) {
			error = t('devices.scanWrong');
			return;
		}
		other = id;
		await add();
	}

	/** @param {string} peerId */
	async function remove(peerId) {
		error = null;
		try {
			await removeSyncDevice(peerId);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			confirming = null;
		}
	}
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	let flagOn = $state(deviceSyncOn());

	async function add() {
		busy = true;
		error = null;
		try {
			await addSyncDevice(parseDeviceCode(other) ?? other);
			other = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// "Ohne Relay, per QR": what is on screen, and the code in it.
	/** @type {'idle' | 'invite' | 'answer' | 'connected'} */
	let qrPhase = $state('idle');
	let qrCode = $state('');
	let pasted = $state('');

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

	const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

{#snippet qrBlock()}
	<div class="mt-3 text-sm" data-testid="devices-qr-mode">
		<p class="text-text">{t('devices.qrMode.what')}</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<button
				type="button"
				class={button}
				disabled={busy}
				onclick={invite}
				data-testid="devices-qr-invite">{t('devices.qrMode.invite')}</button
			>
			<QrScan onscan={useCode} class={button} />
		</div>
		{#if (qrPhase === 'invite' || qrPhase === 'answer') && qrCode}
			<!-- A white plaque in both themes: a camera reads it, not the theme. -->
			<div
				class="mt-3 w-fit rounded-md bg-white p-2 [&_svg]:size-64"
				role="img"
				aria-label={t(`devices.qrMode.${qrPhase}Label`)}
				data-testid="devices-qr-code"
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
				testid="devices-qr-copy"
				valueClass="hidden">{qrCode}</CopyButton
			>
		{:else if qrPhase === 'connected'}
			<p class="mt-2 text-sm text-success" role="status" data-testid="devices-qr-connected">
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
			<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
				>{t('devices.qrMode.pasteLabel')}
				<input
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
					bind:value={pasted}
					autocomplete="off"
					spellcheck="false"
					data-testid="devices-qr-paste"
				/></label
			>
			<button
				type="submit"
				class={button}
				disabled={busy || !pasted.trim()}
				data-testid="devices-qr-use">{t('devices.qrMode.use')}</button
			>
		</form>
		<p class="mt-2 text-xs text-faint">{t('devices.qrMode.limits')}</p>
		<!-- In "Beides" the form below says it. -->
		{#if (error || app.sync.error) && app.network.mode === 'qr'}
			<p class="mt-2 text-sm text-danger" role="alert">{error ?? app.sync.error}</p>
		{/if}
	</div>
{/snippet}

{#snippet deviceList(/** @type {import('./device-sync.js').SyncState | null} */ state)}
	<h3 class="mt-4 text-sm font-semibold text-heading">{t('devices.list')}</h3>
	{#if state?.devices.length}
		<ul class="mt-1 divide-y divide-border text-sm" data-testid="devices-list">
			{#each state.devices as d (d.peerId)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-1.5"
					data-testid="devices-item"
				>
					<span class="min-w-0">
						<span class="block text-heading">{d.label || t('devices.unnamed')}</span>
						<span class="block font-mono text-xs break-all text-faint">{d.peerId}</span>
					</span>
					<span class="flex items-center gap-2">
						<span
							class="text-xs {d.connected ? 'text-success' : 'text-faint'}"
							data-testid="devices-item-state"
							>{d.connected
								? `${t('devices.connected')} · ${d.direct ? t('devices.direct') : t('devices.viaRelay')}`
								: t('devices.notConnected')}</span
						>
						{#if confirming === d.peerId}
							<button
								type="button"
								class="rounded-md border border-danger px-2 py-1 text-xs text-danger hover:bg-surface-2"
								onclick={() => remove(d.peerId)}
								data-testid="devices-remove-confirm">{t('devices.removeConfirm')}</button
							>
							<button
								type="button"
								class="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-2"
								onclick={() => (confirming = null)}>{t('devices.removeCancel')}</button
							>
						{:else}
							<button
								type="button"
								class="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-2"
								onclick={() => (confirming = d.peerId)}
								data-testid="devices-remove">{t('devices.remove')}</button
							>
						{/if}
					</span>
					{#if confirming === d.peerId}
						<p class="w-full text-xs text-faint">{t('devices.removeWhat')}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-1 text-sm text-faint">{t('devices.none')}</p>
	{/if}
{/snippet}

<section class={card} aria-labelledby="devices-h" data-testid="devices-card">
	<h2 id="devices-h" class="text-lg font-semibold text-heading">{t('devices.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('devices.what')}</p>
	{#if app.sync.removed}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="devices-removed">
			{t('devices.removed')}
		</p>
	{:else if !app.sync.online}
		<p class="mt-2 text-sm text-faint" data-testid="devices-off">
			{flagOn ? t('devices.pending') : t('devices.off')}
		</p>
		{#if !flagOn}
			<button
				type="button"
				class="mt-2 {button}"
				onclick={() => {
					consent.reopen();
					flagOn = deviceSyncOn();
				}}
				data-testid="devices-open-consent">{t('devices.openConsent')}</button
			>
		{/if}
	{:else if app.network.mode === 'qr'}
		{@render qrBlock()}
		{@render deviceList(app.sync.state)}
	{:else}
		{@const state = app.sync.state}
		{#if app.network.mode === 'both'}
			<!-- "Beides": a new device by QR, or by its id through the bridge's relay. -->
			<p class="mt-2 text-sm text-text" data-testid="devices-both">{t('devices.bothMode')}</p>
			{@render qrBlock()}
		{/if}
		<div class="mt-3 text-sm">
			<p class="text-faint">{t('devices.self')}</p>
			{#if state}
				<CopyButton
					text={state.self}
					label={t('devices.copy')}
					testid="devices-self"
					valueClass="font-mono text-xs break-all text-heading">{state.self}</CopyButton
				>
				<p class="mt-0.5 text-xs text-faint" data-testid="devices-reachable">
					{t('devices.selfHint')} · {state.reachable
						? t('devices.reachable')
						: t('devices.notReachable')}
				</p>
				<button
					type="button"
					class="mt-2 block {button}"
					aria-expanded={showQr}
					onclick={() => (showQr = !showQr)}
					data-testid="devices-qr-toggle"
					>{showQr ? t('devices.hideQr') : t('devices.showQr')}</button
				>
				{#if showQr}
					<!-- A white plaque in both themes: a camera reads it, not the theme. -->
					<div
						class="mt-2 w-fit rounded-md bg-white p-2 [&_svg]:size-48"
						role="img"
						aria-label={t('devices.qrLabel')}
						data-testid="devices-qr"
						data-code={deviceCode(state.self)}
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of a checked peer id -->
						{@html renderSVG(deviceCode(state.self), { border: 2 })}
					</div>
					<p class="mt-1 text-xs text-faint">{t('devices.qrHint')}</p>
				{/if}
			{/if}
		</div>
		<form
			class="mt-3 flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				add();
			}}
		>
			<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
				>{t('devices.addLabel')}
				<input
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
					bind:value={other}
					autocomplete="off"
					spellcheck="false"
					data-testid="devices-add-input"
				/></label
			>
			<button
				type="submit"
				class={button}
				disabled={busy || !other.trim()}
				data-testid="devices-add">{t('devices.addButton')}</button
			>
			<QrScan onscan={scanned} class={button} />
		</form>
		{#if error || app.sync.error}
			<p class="mt-2 text-sm text-danger" role="alert">{error ?? app.sync.error}</p>
		{/if}
		<label class="mt-4 flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				class="mt-0.5"
				checked={shareOn}
				onchange={(e) => {
					shareOn = e.currentTarget.checked;
					setBridgeShare(shareOn);
				}}
				data-testid="devices-bridge-share"
			/>
			<span>
				<span class="text-heading">{t('devices.bridgeShare')}</span>
				<span class="block text-xs text-faint">{t('devices.bridgeShareText')}</span>
				{#if app.sync.bridgeServed}
					<span class="block text-xs text-success" data-testid="devices-bridge-served"
						>{t('devices.bridgeServed')}</span
					>
				{:else if shareOn}
					<span class="block text-xs text-faint">{t('devices.bridgePending')}</span>
				{/if}
			</span>
		</label>
		{@render deviceList(state)}
	{/if}
</section>
