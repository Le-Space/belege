<script>
	import WayOut from '$lib/help/WayOut.svelte';
	// The bridge: whether it answers and whether this device is paired, pairing
	// by code, "Kopplung lösen" (issue #152: on the overview as its first row,
	// and on its own page).
	import { t } from '$lib/i18n/index.js';
	import { app } from '$lib/session.svelte.js';
	import {
		bridge,
		bridgePaired,
		bridgeViaDevice,
		bridgeViaStream,
		checkBridge,
		pairBridge,
		pairBridgeByInvitation,
		unpairBridge
	} from './bridge-state.svelte.js';
	import { hostsBridge } from './host.js';

	/** @type {{ intro?: boolean }} */
	let { intro = true } = $props();

	let code = $state('');
	let invitation = $state('');
	let pairing = $state(false);

	/** @param {SubmitEvent} event */
	async function pair(event) {
		event.preventDefault();
		pairing = true;
		if (await pairBridge(code)) code = '';
		pairing = false;
	}

	/** "Über Einladung koppeln" (#575): the bridge's own node becomes a device of the books. */
	/** @param {SubmitEvent} event */
	async function pairByInvitation(event) {
		event.preventDefault();
		pairing = true;
		if (await pairBridgeByInvitation(invitation)) invitation = '';
		pairing = false;
	}

	const secondary =
		'min-h-11 rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 hover:text-heading';
</script>

<div data-testid="bridge-panel">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			{#if intro}<p class="text-sm text-text">{t('integrationen.bridge.intro')}</p>{/if}
			<p
				class="mt-1 text-sm text-text"
				data-testid="bridge-status"
				data-state={bridge.state}
				data-paired={bridgePaired() ? 'true' : 'false'}
				data-route={app.sync.bridgeRoute}
			>
				{#if bridge.state === 'checking'}
					{t('integrationen.bridge.checking')}
				{:else if bridge.state === 'online'}
					<span class="font-medium text-success">{t('integrationen.bridge.online')}</span>
					·
					{bridgeViaStream()
						? t('integrationen.bridge.viaStream')
						: bridgeViaDevice()
							? t('integrationen.bridge.viaDevice')
							: bridgePaired()
								? t('integrationen.bridge.paired')
								: t('integrationen.bridge.unpaired')}
					{#if !bridge.health.hibiscus}· {t('integrationen.bridge.noHibiscus')}{/if}
				{:else if bridge.state === 'offline' && !bridgePaired()}
					<!-- Nothing paired and nothing answering: no bridge here, not a failure. -->
					<span class="font-medium text-text">{t('integrationen.bridge.noneHere')}</span>
				{:else if bridge.state === 'offline'}
					<span class="font-medium text-danger">{t('integrationen.bridge.offline')}</span>
				{:else}
					{t('integrationen.bridge.unknown')}
				{/if}
			</p>
		</div>
		<button type="button" class={secondary} onclick={checkBridge} data-testid="bridge-check"
			>{t('integrationen.bridge.check')}</button
		>
	</div>

	{#if bridgeViaDevice()}
		<p class="mt-3 text-sm text-text" data-testid="bridge-via-device">
			{t('integrationen.bridge.viaDeviceHint')}
		</p>
	{:else if !bridgePaired()}
		{#if app.sync.online}
			<!-- The bridge's own node (#573): paired by the invitation it printed, a device of the books from then on. -->
			<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={pairByInvitation}>
				<label class="flex min-w-0 flex-1 flex-col text-sm">
					<span class="text-faint">{t('integrationen.bridge.invitation')}</span>
					<input
						class="mt-1 min-h-11 w-full rounded-md border px-2 font-mono text-sm"
						bind:value={invitation}
						placeholder="web+ucep:pair?…"
						autocomplete="off"
						data-testid="bridge-invitation"
					/>
				</label>
				<button
					type="submit"
					class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={pairing || !invitation.trim().startsWith('web+ucep:pair')}
					data-testid="bridge-pair-invitation">{t('integrationen.bridge.pairInvitation')}</button
				>
			</form>
			<p class="mt-2 text-xs text-faint">{t('integrationen.bridge.invitationHint')}</p>
		{/if}
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
	{:else if bridgeViaStream()}
		<p class="mt-3 text-sm text-text" data-testid="bridge-via-stream">
			{t('integrationen.bridge.viaStreamHint')}
		</p>
		<button
			type="button"
			class="mt-3 min-h-11 text-sm text-text underline hover:text-heading"
			onclick={unpairBridge}
			data-testid="unpair">{t('integrationen.bridge.unpair')}</button
		>
	{:else if bridge.state === 'offline' && !hostsBridge()}
		<!-- A phone never runs a bridge (#142): no terminal, no unpairing – the computer's bridge, over device sync. -->
		<p class="mt-3 text-sm text-text" data-testid="bridge-on-a-phone">
			{t('integrationen.bridge.onAPhone')}
		</p>
	{:else}
		<button
			type="button"
			class="mt-3 min-h-11 text-sm text-text underline hover:text-heading"
			onclick={unpairBridge}
			data-testid="unpair">{t('integrationen.bridge.unpair')}</button
		>
	{/if}
	{#if bridge.error && (bridge.state !== 'offline' || hostsBridge())}
		<p class="mt-3 text-sm text-danger" role="alert" data-testid="bridge-error">{bridge.error}</p>
		<WayOut message={bridge.error} />
	{/if}
</div>
