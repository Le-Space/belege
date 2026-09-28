<script>
	// The bridge: whether it answers and whether this device is paired, pairing
	// by code, "Kopplung lösen" (issue #152: on the overview as its first row,
	// and on its own page).
	import { t } from '$lib/i18n/index.js';
	import {
		bridge,
		bridgeViaDevice,
		checkBridge,
		pairBridge,
		unpairBridge
	} from './bridge-state.svelte.js';

	/** @type {{ intro?: boolean }} */
	let { intro = true } = $props();

	let code = $state('');
	let pairing = $state(false);

	/** @param {SubmitEvent} event */
	async function pair(event) {
		event.preventDefault();
		pairing = true;
		if (await pairBridge(code)) code = '';
		pairing = false;
	}

	const secondary =
		'min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading';
</script>

<div data-testid="bridge-panel">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			{#if intro}<p class="text-sm text-text">{t('integrationen.bridge.intro')}</p>{/if}
			<p class="mt-1 text-sm text-text" data-testid="bridge-status" data-state={bridge.state}>
				{#if bridge.state === 'checking'}
					{t('integrationen.bridge.checking')}
				{:else if bridge.state === 'online'}
					<span class="font-medium text-success">{t('integrationen.bridge.online')}</span>
					·
					{bridgeViaDevice()
						? t('integrationen.bridge.viaDevice')
						: bridge.token
							? t('integrationen.bridge.paired')
							: t('integrationen.bridge.unpaired')}
					{#if !bridge.health.hibiscus}· {t('integrationen.bridge.noHibiscus')}{/if}
				{:else if bridge.state === 'offline'}
					<span class="font-medium text-danger">{t('integrationen.bridge.offline')}</span>
				{:else}
					{t('integrationen.bridge.unknown')}
				{/if}
			</p>
		</div>
		<button type="button" class={secondary} onclick={checkBridge}
			>{t('integrationen.bridge.check')}</button
		>
	</div>

	{#if bridgeViaDevice()}
		<p class="mt-3 text-sm text-text" data-testid="bridge-via-device">
			{t('integrationen.bridge.viaDeviceHint')}
		</p>
	{:else if !bridge.token}
		<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={pair}>
			<label class="flex flex-col text-sm">
				<span class="text-faint">{t('integrationen.bridge.url')}</span>
				<input
					class="mt-1 min-h-11 w-64 max-w-full rounded-md border px-2 font-mono text-sm"
					bind:value={bridge.url}
					data-testid="bridge-url"
				/>
			</label>
			<label class="flex flex-col text-sm">
				<span class="text-faint">{t('integrationen.bridge.code')}</span>
				<input
					class="mt-1 min-h-11 w-40 rounded-md border px-2 font-mono text-sm uppercase"
					bind:value={code}
					placeholder="ABCD-EFGH"
					autocomplete="off"
					data-testid="pairing-code"
				/>
			</label>
			<button
				type="submit"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={pairing || !code.trim()}>{t('integrationen.bridge.pair')}</button
			>
		</form>
		<p class="mt-2 text-xs text-faint">
			{t('integrationen.bridge.codeHint', {
				when: bridge.paired
					? t('integrationen.bridge.codeHintPaired')
					: t('integrationen.bridge.codeHintFirst')
			})}
		</p>
	{:else}
		<button
			type="button"
			class="mt-3 min-h-11 text-sm text-text underline hover:text-heading"
			onclick={unpairBridge}
			data-testid="unpair">{t('integrationen.bridge.unpair')}</button
		>
	{/if}
	{#if bridge.error}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="bridge-error">{bridge.error}</p>
	{/if}
</div>
