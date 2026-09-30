<script>
	// The bridge step of the setup checklist (issue #200): the commands to start
	// it, a page that notices by itself when it runs (asking /health every few
	// seconds while this is shown), why it does not answer when it does not,
	// and then the pairing form of Integrationen.
	import { onDestroy, onMount } from 'svelte';
	import CopyButton from '$lib/CopyButton.svelte';
	import BridgePanel from '$lib/integrations/BridgePanel.svelte';
	import { bridge, checkBridge } from '$lib/integrations/bridge-state.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { bridgeCommands, diagnoseBridge } from './diagnose.js';

	const EVERY_MS = 3000;
	const README = 'https://github.com/Le-Space/belege/blob/main/bridge/README.md';

	/** @type {import('./diagnose.js').BridgeDiagnosis | 'checking'} */
	let diagnosis = $state('checking');
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let stopped = false;

	async function look() {
		if (stopped) return;
		diagnosis = await diagnoseBridge(bridge.url);
		if (diagnosis === 'online' && bridge.state !== 'online') await checkBridge();
		if (!stopped && diagnosis !== 'online') timer = setTimeout(look, EVERY_MS);
	}

	onMount(look);
	onDestroy(() => {
		stopped = true;
		clearTimeout(timer);
	});

	const commands = bridgeCommands().join('\n');
	const origin = typeof location === 'undefined' ? '' : location.origin;
</script>

<div class="mt-3 space-y-3 text-sm" data-testid="setup-bridge" data-diagnosis={diagnosis}>
	{#if diagnosis !== 'online'}
		<div>
			<p class="text-text">{t('setup.bridge.commands')}</p>
			<CopyButton
				text={commands}
				label={t('setup.bridge.copy')}
				testid="setup-bridge-commands"
				class="mt-1"
				valueClass="block overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-heading"
				>{commands}</CopyButton
			>
			<p class="mt-1 text-faint">{t('setup.bridge.commandsAfter')}</p>
		</div>
		{#if diagnosis !== 'checking'}
			<p class="text-danger" data-testid="setup-bridge-diagnosis">
				{t(`setup.bridge.diagnosis.${diagnosis}`, { url: bridge.url, origin })}
			</p>
		{/if}
		<p class="text-xs text-faint" role="status" data-testid="setup-bridge-waiting">
			{t('setup.bridge.waiting', { url: bridge.url })}
		</p>
	{:else if !bridge.token}
		<p class="font-medium text-success" role="status" data-testid="setup-bridge-found">
			{t('setup.bridge.found')}
		</p>
	{/if}
	{#if diagnosis === 'online'}
		<BridgePanel intro={false} />
	{/if}
	<a class="inline-block text-text underline hover:text-heading" href={README} rel="noreferrer"
		>{t('setup.bridge.more')}</a
	>
</div>
