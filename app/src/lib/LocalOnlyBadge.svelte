<script>
	// The network's state in the header, on every page (network-status.js), and
	// its switches: a click opens a menu to pause everything, or to switch own
	// devices and the invoicing app off or on one by one. Off is at once – the
	// books stay open, the connections are hung up and refused (session.svelte.js
	// `pauseNetwork`); on is at once where this session's node went online at
	// unlock, else from the next unlock. Switching device sync on for the first
	// time goes through the consent screen, which says what the relay sees.
	// Where devices meet (public relays, own network, both) comes with #148.
	import { resolve } from '$app/paths';
	import {
		app,
		pauseNetwork,
		resumeNetwork,
		setDevicesNetwork,
		startUcep,
		stopUcep
	} from './session.svelte.js';
	import { consent } from './consent.js';
	import { t } from './i18n/index.js';
	import { networkStatus } from './network-status.js';

	let status = $derived(networkStatus(app));
	let label = $derived(
		status.state === 'paused'
			? t('header.network.paused')
			: status.parts.length === 0
				? t('header.localOnly')
				: status.parts.length === 2
					? t('header.network.both')
					: t(`header.network.only.${status.parts[0].id}`)
	);
	let title = $derived(
		status.state === 'paused'
			? t('header.network.pausedTitle')
			: status.parts.length === 0
				? t('header.localOnlyTitle')
				: [
						t('header.network.title'),
						...status.parts.map((p) =>
							t(`header.network.part.${p.id}.${p.state}`, {
								count: p.devices ?? 0,
								error: p.error ?? ''
							})
						)
					].join('\n')
	);
	const DOT = {
		off: 'border-2 border-faint',
		paused: 'border-2 border-amber-500',
		connecting: 'bg-amber-500 animate-pulse',
		online: 'bg-cyan-600 dark:bg-cyan-400',
		connected: 'bg-emerald-600 dark:bg-emerald-400',
		failed: 'bg-red-600 dark:bg-red-400'
	};

	let open = $state(false);
	let busy = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();
	let devicesPart = $derived(status.parts.find((p) => p.id === 'devices'));
	let appPart = $derived(status.parts.find((p) => p.id === 'invoice-app'));
	let unlocked = $derived(app.status === 'ready');

	/** A part's state as the menu's second line: the tooltip line without its name. @param {import('./network-status.js').NetworkPart | undefined} p */
	const stateLine = (p) =>
		p
			? t(`header.network.part.${p.id}.${p.state}`, {
					count: p.devices ?? 0,
					error: p.error ?? ''
				}).replace(/^• [^:]+: /, '')
			: t('header.network.off');

	/** @param {() => Promise<unknown>} work */
	async function run(work) {
		busy = true;
		try {
			await work();
		} finally {
			busy = false;
		}
	}

	/** @param {MouseEvent} e */
	function outside(e) {
		if (open && root && !root.contains(/** @type {Node} */ (e.target))) open = false;
	}
	/** @param {KeyboardEvent} e */
	function escape(e) {
		if (open && e.key === 'Escape') open = false;
	}

	const row = 'flex items-center justify-between gap-3 py-2';
	const small =
		'min-h-9 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium text-heading hover:bg-surface-2 disabled:opacity-50';
</script>

<svelte:window onclick={outside} onkeydown={escape} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		onclick={() => (open = !open)}
		{title}
		aria-label={title}
		aria-expanded={open}
		aria-haspopup="dialog"
		data-testid="local-only"
		data-state={status.state}
		class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
	>
		<span class="h-2 w-2 shrink-0 rounded-full {DOT[status.state]}" aria-hidden="true"></span>
		<span>{label}</span>
	</button>

	{#if open}
		<div
			role="dialog"
			aria-label={t('header.network.menu')}
			class="absolute left-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
			data-testid="network-menu"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="font-semibold text-heading">{t('header.network.menu')}</p>
				{#if unlocked}
					{#if app.network.paused}
						<button
							type="button"
							class={small}
							disabled={busy}
							onclick={() => run(resumeNetwork)}
							data-testid="network-resume">{t('header.network.resume')}</button
						>
					{:else}
						<button
							type="button"
							class={small}
							disabled={busy}
							onclick={() => run(pauseNetwork)}
							data-testid="network-pause">{t('header.network.pause')}</button
						>
					{/if}
				{/if}
			</div>
			{#if !unlocked}
				<p class="mt-2 text-xs text-faint">{t('header.network.locked')}</p>
			{:else}
				<div class="mt-2 divide-y divide-border">
					<div class={row} data-testid="network-devices">
						<span class="min-w-0">
							<span class="block text-heading">{t('header.network.devices')}</span>
							<span class="block text-xs text-faint">{stateLine(devicesPart)}</span>
						</span>
						{#if app.network.paused}
							<span class="text-xs text-faint">{t('header.network.pausedShort')}</span>
						{:else if app.sync.online}
							<button
								type="button"
								class={small}
								disabled={busy}
								onclick={() => run(() => setDevicesNetwork(false))}
								data-testid="network-devices-off">{t('header.network.switchOff')}</button
							>
						{:else if app.network.syncCapable}
							<button
								type="button"
								class={small}
								disabled={busy}
								onclick={() => run(() => setDevicesNetwork(true))}
								data-testid="network-devices-on">{t('header.network.switchOn')}</button
							>
						{:else}
							<button
								type="button"
								class={small}
								onclick={() => {
									open = false;
									consent.reopen();
								}}
								data-testid="network-devices-setup">{t('header.network.switchOnFirst')}</button
							>
						{/if}
					</div>
					<div class={row} data-testid="network-app">
						<span class="min-w-0">
							<span class="block text-heading">{t('header.network.app')}</span>
							<span class="block text-xs text-faint">{stateLine(appPart)}</span>
						</span>
						{#if app.network.paused}
							<span class="text-xs text-faint">{t('header.network.pausedShort')}</span>
						{:else if app.ucep.status !== 'off'}
							<button
								type="button"
								class={small}
								disabled={busy}
								onclick={() => run(stopUcep)}
								data-testid="network-app-off">{t('header.network.switchOff')}</button
							>
						{:else if app.ucep.app}
							<button
								type="button"
								class={small}
								disabled={busy}
								onclick={() => run(startUcep)}
								data-testid="network-app-on">{t('header.network.switchOn')}</button
							>
						{:else}
							<a
								class="shrink-0 text-xs text-text underline"
								href={resolve('/integrationen/rechnungs-app')}
								onclick={() => (open = false)}>{t('header.network.setUp')}</a
							>
						{/if}
					</div>
				</div>
				{#if app.network.reloadNeeded}
					<p class="mt-2 text-xs text-warning" role="status" data-testid="network-reload">
						{t('header.network.reloadNeeded')}
						<button type="button" class="underline" onclick={() => location.reload()}
							>{t('header.network.reload')}</button
						>
					</p>
				{/if}
				<fieldset class="mt-3 border-t border-border pt-2" data-testid="network-mode">
					<legend class="text-xs font-medium text-faint">{t('header.network.mode')}</legend>
					<label class="mt-1 flex items-center gap-2 text-sm text-heading">
						<input type="radio" name="network-mode" checked disabled />{t(
							'header.network.modes.public'
						)}
					</label>
					<label class="flex items-center gap-2 text-sm text-faint">
						<input type="radio" name="network-mode" disabled />{t('header.network.modes.local')}
					</label>
					<label class="flex items-center gap-2 text-sm text-faint">
						<input type="radio" name="network-mode" disabled />{t('header.network.modes.both')}
					</label>
					<p class="mt-1 text-xs text-faint">{t('header.network.modesLater')}</p>
				</fieldset>
			{/if}
			<button
				type="button"
				class="mt-3 text-xs text-text underline"
				onclick={() => {
					open = false;
					consent.reopen();
				}}
				data-testid="network-consent">{t('header.network.more')}</button
			>
		</div>
	{/if}
</div>
