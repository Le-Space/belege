<script>
	// "Gehostete Bridge" (#585): attest the bridge's confidential VM from this
	// browser and unlock it, paired in the same step (hosted-bridge.js). The
	// passphrase is the image's, typed here and kept nowhere.
	import { t } from '$lib/i18n/index.js';
	import { app, hostedBridgeRecord, unlockHostedBridge } from '$lib/session.svelte.js';
	import HackathonBand from './HackathonBand.svelte';
	import { bridge, checkBridge } from './bridge-state.svelte.js';

	let instance = $state('');
	let passphrase = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string} */
	let progress = $state('');
	/** @type {Awaited<ReturnType<typeof hostedBridgeRecord>>} */
	let kept = $state(null);

	$effect(() => {
		if (app.sync.online) hostedBridgeRecord().then((r) => (kept = r));
	});
	$effect(() => {
		if (kept && !instance) instance = kept.instance;
	});

	/** @param {SubmitEvent} event */
	async function unlock(event) {
		event.preventDefault();
		busy = true;
		error = null;
		progress = '';
		try {
			const result = await unlockHostedBridge({
				instance,
				passphrase,
				onProgress: (/** @type {{ phase: string }} */ { phase }) => {
					const key = `integrationen.hostedBridge.phase.${phase}`;
					const text = t(key);
					if (text !== key) progress = text;
				}
			});
			passphrase = '';
			progress = '';
			kept = await hostedBridgeRecord();
			bridge.peerId = result.peerId;
			await checkBridge();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	data-testid="hosted-bridge"
>
	<HackathonBand />
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.hostedBridge.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.hostedBridge.intro')}</p>

	{#if kept}
		<p class="mt-3 text-sm text-text" data-testid="hosted-bridge-state">
			<span class="font-medium text-success">{t('integrationen.hostedBridge.attested')}</span>
			· <span class="font-mono">{kept.host}</span>
			· {t('integrationen.hostedBridge.attestedAt', {
				date: new Date(kept.attestedAt).toLocaleString()
			})}
		</p>
		<p class="mt-1 font-mono text-xs break-all text-faint" data-testid="hosted-bridge-measurement">
			{t('integrationen.hostedBridge.measurement')}
			{kept.measurement}
		</p>
	{/if}

	{#if app.sync.online}
		<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={unlock}>
			<label class="flex min-w-0 flex-1 flex-col text-sm">
				<span class="text-faint">{t('integrationen.hostedBridge.instance')}</span>
				<input
					class="mt-1 min-h-11 w-full rounded-md border px-2 font-mono text-sm"
					bind:value={instance}
					autocomplete="off"
					spellcheck="false"
					data-testid="hosted-bridge-instance"
				/>
			</label>
			<label class="flex flex-col text-sm">
				<span class="text-faint">{t('integrationen.hostedBridge.passphrase')}</span>
				<input
					class="mt-1 min-h-11 w-64 max-w-full rounded-md border px-2 font-mono text-sm"
					type="password"
					bind:value={passphrase}
					autocomplete="off"
					data-testid="hosted-bridge-passphrase"
				/>
			</label>
			<button
				type="submit"
				class="min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={busy || !/^[0-9a-f]{64}$/.test(instance.trim()) || !passphrase}
				data-testid="hosted-bridge-unlock">{t('integrationen.hostedBridge.unlock')}</button
			>
		</form>
		<p class="mt-2 text-xs text-faint">{t('integrationen.hostedBridge.hint')}</p>
		{#if busy && progress}
			<p class="mt-2 text-sm text-text" data-testid="hosted-bridge-progress">{progress}</p>
		{/if}
	{:else}
		<p class="mt-3 text-sm text-text">{t('messages.bridge.needsSync')}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="hosted-bridge-error">{error}</p>
	{/if}
</section>
