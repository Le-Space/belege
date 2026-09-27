<script>
	// Integrationen → Eigene Geräte (#123): this device's id to type on the
	// other one, "Gerät hinzufügen", and the devices the books know with their
	// connection. Device sync itself is switched on in the consent screen.
	import { app, addSyncDevice } from '$lib/session.svelte.js';
	import { consent } from '$lib/consent.js';
	import { t } from '$lib/i18n/index.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import { deviceSyncOn } from './device-sync.js';

	let other = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	let flagOn = $state(deviceSyncOn());

	async function add() {
		busy = true;
		error = null;
		try {
			await addSyncDevice(other);
			other = '';
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

<section class={card} aria-labelledby="devices-h" data-testid="devices-card">
	<h2 id="devices-h" class="text-lg font-semibold text-heading">{t('devices.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('devices.what')}</p>
	{#if !app.sync.online}
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
	{:else}
		{@const state = app.sync.state}
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
		</form>
		{#if error || app.sync.error}
			<p class="mt-2 text-sm text-danger" role="alert">{error ?? app.sync.error}</p>
		{/if}
		<h3 class="mt-4 text-sm font-semibold text-heading">{t('devices.list')}</h3>
		{#if state?.devices.length}
			<ul class="mt-1 divide-y divide-border text-sm" data-testid="devices-list">
				{#each state.devices as d (d.peerId)}
					<li
						class="flex flex-wrap items-center justify-between gap-2 py-1.5"
						data-testid="devices-item"
					>
						<span class="font-mono text-xs break-all text-text">{d.peerId}</span>
						<span
							class="text-xs {d.connected ? 'text-success' : 'text-faint'}"
							data-testid="devices-item-state"
							>{d.connected
								? `${t('devices.connected')} · ${d.direct ? t('devices.direct') : t('devices.viaRelay')}`
								: t('devices.notConnected')}</span
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-faint">{t('devices.none')}</p>
		{/if}
	{/if}
</section>
