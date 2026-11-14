<script>
	// "Gehostete Bridge auf Phala, über NEAR" (#696): start and stop the bridge
	// in an Intel TDX VM through the NEAR contract, paired in the same step
	// (near-bridge.js). The books' NEAR account pays the gas; it is made on the
	// owner's device and kept in the sealed settings.
	import { t } from '$lib/i18n/index.js';
	import {
		app,
		nearBridgeStatus,
		startNearHostedBridge,
		stopNearHostedBridge
	} from '$lib/session.svelte.js';
	import { PHASES } from './near-bridge.js';
	import { bridge, checkBridge } from './bridge-state.svelte.js';
	import { noteNear } from './hosted-status.svelte.js';

	/** @type {{ accountId: string, balance: bigint | null, contract: any, kept: any } | null} */
	let status = $state(/** @type {any} */ (null));
	let busy = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string[]} */
	let done = $state([]);

	async function refresh() {
		status = await nearBridgeStatus().catch(() => null);
		noteNear(status);
	}
	$effect(() => {
		if (app.sync.online) refresh();
	});

	const running = $derived(Boolean(status?.contract?.bridge?.valid));
	const pending = $derived(status?.contract?.request?.kind ?? null);

	/** @param {bigint | null | undefined} y */
	const near = (y) =>
		y === null || y === undefined
			? t('integrationen.nearBridge.notFunded')
			: `${(Number(y / 10n ** 20n) / 10_000).toFixed(4)} NEAR`;

	async function start() {
		busy = 'start';
		error = null;
		done = [];
		try {
			const result = await startNearHostedBridge({
				onPhase: (phase) => (done = [...done, phase])
			});
			bridge.peerId = result.peerId;
			await checkBridge();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
			await refresh();
		}
	}

	async function stop() {
		busy = 'stop';
		error = null;
		try {
			await stopNearHostedBridge();
			done = [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
			await refresh();
		}
	}
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	id="near-bridge"
	data-testid="near-bridge"
>
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.nearBridge.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.nearBridge.intro')}</p>
	<p class="mt-1 text-xs text-warning">{t('integrationen.nearBridge.testnet')}</p>

	{#if !app.sync.online}
		<p class="mt-3 text-sm text-text">{t('messages.bridge.needsSync')}</p>
	{:else if status}
		<dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
			<dt class="text-faint">{t('integrationen.nearBridge.account')}</dt>
			<dd class="font-mono text-xs break-all" data-testid="near-bridge-account">
				{status.accountId}
			</dd>
			<dt class="text-faint">{t('integrationen.nearBridge.balance')}</dt>
			<dd data-testid="near-bridge-balance">{near(status.balance)}</dd>
			{#if running}
				<dt class="text-faint">{t('integrationen.nearBridge.state')}</dt>
				<dd data-testid="near-bridge-state">
					<span class="font-medium text-success">{t('integrationen.nearBridge.attested')}</span>
					·
					<span class="font-mono text-xs"
						>{String(status.contract.bridge.compose_hash).slice(0, 16)}…</span
					>
				</dd>
			{:else if pending}
				<dt class="text-faint">{t('integrationen.nearBridge.state')}</dt>
				<dd>{t('integrationen.nearBridge.pending', { kind: pending })}</dd>
			{/if}
		</dl>
		{#if status.balance === null}
			<p class="mt-2 text-sm text-text">{t('integrationen.nearBridge.fund')}</p>
		{/if}
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={Boolean(busy) || status.balance === null || running || Boolean(pending)}
				onclick={start}
				data-testid="near-bridge-start">{t('integrationen.nearBridge.start')}</button
			>
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
				disabled={Boolean(busy) || status.balance === null || (!running && !pending)}
				onclick={stop}
				data-testid="near-bridge-stop">{t('integrationen.nearBridge.stop')}</button
			>
			<button
				type="button"
				class="min-h-11 rounded-md px-3 text-sm text-faint underline disabled:opacity-50"
				disabled={Boolean(busy)}
				onclick={refresh}>{t('integrationen.nearBridge.refresh')}</button
			>
		</div>
		{#if busy === 'start' || done.length}
			<ol class="mt-3 flex flex-wrap gap-2 text-xs" data-testid="near-bridge-phases">
				{#each PHASES as phase (phase)}
					<li
						class="rounded-full px-2 py-0.5 {done.includes(phase)
							? 'bg-success/15 text-success'
							: 'bg-border/40 text-faint'}"
					>
						{t(`integrationen.nearBridge.phase.${phase}`)}
					</li>
				{/each}
			</ol>
		{/if}
		{#if busy === 'stop'}
			<p class="mt-2 text-sm text-text">{t('integrationen.nearBridge.stopping')}</p>
		{/if}
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="near-bridge-error">{error}</p>
	{/if}
</section>
