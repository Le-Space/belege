<script>
	// "Gehostete Bridge" (#585, #587): start the bridge's confidential VM from
	// this browser (hosted-vm.js), owned and paid by the books' Aleph key,
	// attest and unlock it, paired in the same step (hosted-bridge.js), see how
	// long it runs, and stop it. A VM that runs already can be unlocked by its
	// hash. The passphrase is the image's, typed here and kept nowhere.
	import { intlLocale, t } from '$lib/i18n/index.js';
	import {
		app,
		continueHostedStart,
		hostedBridgeRecord,
		hostedNodes,
		hostedVmRecord,
		startHostedBridge,
		stopHostedBridge,
		unlockHostedBridge
	} from '$lib/session.svelte.js';
	import HackathonBand from './HackathonBand.svelte';
	import { bridge, checkBridge } from './bridge-state.svelte.js';
	import { usage } from './hosted-vm.js';

	let instance = $state('');
	let passphrase = $state('');
	let startPassphrase = $state('');
	let crn = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string} */
	let progress = $state('');
	/** @type {Awaited<ReturnType<typeof hostedBridgeRecord>>} */
	let kept = $state(null);
	/** @type {any} */
	let vm = $state(null);
	/** @type {Awaited<ReturnType<typeof hostedNodes>> | null} */
	let nodes = $state(null);
	let now = $state(Date.now());

	const running = $derived(Boolean(vm && !vm.stoppedAt));
	/** A start Aleph has, not yet unlocked from here. */
	const halfway = $derived(running && /** @type {any} */ (kept)?.instance !== vm?.instance);
	const used = $derived(usage(vm, vm?.stoppedAt ? Date.parse(vm.stoppedAt) : now));

	async function reload() {
		[kept, vm] = await Promise.all([hostedBridgeRecord(), hostedVmRecord()]);
	}

	$effect(() => {
		if (app.sync.online) reload();
	});
	$effect(() => {
		if (kept && !instance) instance = kept.instance;
	});
	$effect(() => {
		if (!app.sync.online || running || nodes) return;
		hostedNodes()
			.then((list) => {
				nodes = list;
				if (!crn) crn = list.find((n) => n.fits)?.hash ?? list[0]?.hash ?? '';
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)));
	});
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	/** @param {{ phase: string }} p */
	const onProgress = ({ phase }) => {
		const key = `integrationen.hostedBridge.phase.${phase}`;
		const text = t(key);
		if (text !== key) progress = text;
	};

	/** @param {() => Promise<any>} run */
	async function step(run) {
		busy = true;
		error = null;
		progress = '';
		try {
			const result = await run();
			if (result?.peerId) {
				bridge.peerId = result.peerId;
				await checkBridge();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			progress = '';
			await reload();
		}
	}

	/** @param {SubmitEvent} event */
	function start(event) {
		event.preventDefault();
		const typed = startPassphrase;
		startPassphrase = '';
		step(() =>
			halfway
				? continueHostedStart({ passphrase: typed, onProgress })
				: startHostedBridge({ crn, passphrase: typed, onProgress })
		);
	}

	function stop() {
		step(() => stopHostedBridge());
	}

	/** @param {SubmitEvent} event */
	function unlock(event) {
		event.preventDefault();
		const typed = passphrase;
		passphrase = '';
		step(() => unlockHostedBridge({ instance, passphrase: typed, onProgress }));
	}

	/** @param {string} iso */
	const when = (iso) => new Date(iso).toLocaleString(intlLocale());
	const field = 'mt-1 min-h-11 rounded-md border px-2 font-mono text-sm';
	const primary =
		'min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	data-testid="hosted-bridge"
>
	<HackathonBand />
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.hostedBridge.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.hostedBridge.intro')}</p>

	{#if vm}
		<p class="mt-3 text-sm text-text" data-testid="hosted-bridge-vm">
			{#if running}
				{t('integrationen.hostedBridge.running', { date: when(vm.startedAt) })}
			{:else}
				{t('integrationen.hostedBridge.stopped', { date: when(vm.stoppedAt) })}
			{/if}
			· <span class="font-mono">{vm.instance.slice(0, 12)}</span>
			{#if used}
				· <span data-testid="hosted-bridge-usage"
					>{used.credits !== null
						? t('integrationen.hostedBridge.usage', {
								hours: used.hours.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }),
								credits: used.credits.toLocaleString(intlLocale()),
								perHour: Number(vm.creditsPerHour).toLocaleString(intlLocale())
							})
						: t('integrationen.hostedBridge.usageHours', {
								hours: used.hours.toLocaleString(intlLocale(), { maximumFractionDigits: 1 })
							})}</span
				>
			{/if}
		</p>
	{/if}

	{#if kept && (!vm || (running && kept.instance === vm.instance))}
		<p class="mt-3 text-sm text-text" data-testid="hosted-bridge-state">
			<span class="font-medium text-success">{t('integrationen.hostedBridge.attested')}</span>
			· <span class="font-mono">{kept.host}</span>
			· {t('integrationen.hostedBridge.attestedAt', { date: when(kept.attestedAt) })}
		</p>
		<p class="mt-1 font-mono text-xs break-all text-faint" data-testid="hosted-bridge-measurement">
			{t('integrationen.hostedBridge.measurement')}
			{kept.measurement}
		</p>
	{/if}

	{#if app.sync.online}
		{#if running && !halfway}
			<button
				type="button"
				class="hover:bg-surface-muted mt-4 min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text disabled:opacity-50"
				disabled={busy}
				onclick={stop}
				data-testid="hosted-bridge-stop">{t('integrationen.hostedBridge.stop')}</button
			>
		{:else}
			<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={start}>
				{#if !halfway}
					<label class="flex min-w-0 flex-1 flex-col text-sm">
						<span class="text-faint">{t('integrationen.hostedBridge.node')}</span>
						{#if nodes === null}
							<span class="mt-1 text-sm text-faint"
								>{t('integrationen.hostedBridge.nodesLoading')}</span
							>
						{:else if nodes.length === 0}
							<span class="mt-1 text-sm text-text">{t('integrationen.hostedBridge.nodesNone')}</span
							>
						{:else}
							<select class="{field} w-full" bind:value={crn} data-testid="hosted-bridge-node">
								{#each nodes as n (n.hash)}
									<option value={n.hash}
										>{n.fits
											? n.name
											: t('integrationen.hostedBridge.nodeTight', { name: n.name })}</option
									>
								{/each}
							</select>
						{/if}
					</label>
				{/if}
				<label class="flex flex-col text-sm">
					<span class="text-faint">{t('integrationen.hostedBridge.passphrase')}</span>
					<input
						class="{field} w-64 max-w-full"
						type="password"
						bind:value={startPassphrase}
						autocomplete="off"
						data-testid="hosted-bridge-start-passphrase"
					/>
				</label>
				<button
					type="submit"
					class={primary}
					disabled={busy || !startPassphrase || (!halfway && !crn)}
					data-testid="hosted-bridge-start"
					>{halfway
						? t('integrationen.hostedBridge.resume')
						: t('integrationen.hostedBridge.start')}</button
				>
			</form>
			<p class="mt-2 text-xs text-faint">{t('integrationen.hostedBridge.startHint')}</p>
		{/if}
		{#if busy && progress}
			<p class="mt-2 text-sm text-text" data-testid="hosted-bridge-progress">{progress}</p>
		{/if}

		<details class="mt-4 text-sm" data-testid="hosted-bridge-existing">
			<summary class="cursor-pointer text-text underline"
				>{t('integrationen.hostedBridge.existing')}</summary
			>
			<form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={unlock}>
				<label class="flex min-w-0 flex-1 flex-col text-sm">
					<span class="text-faint">{t('integrationen.hostedBridge.instance')}</span>
					<input
						class="{field} w-full"
						bind:value={instance}
						autocomplete="off"
						spellcheck="false"
						data-testid="hosted-bridge-instance"
					/>
				</label>
				<label class="flex flex-col text-sm">
					<span class="text-faint">{t('integrationen.hostedBridge.passphrase')}</span>
					<input
						class="{field} w-64 max-w-full"
						type="password"
						bind:value={passphrase}
						autocomplete="off"
						data-testid="hosted-bridge-passphrase"
					/>
				</label>
				<button
					type="submit"
					class={primary}
					disabled={busy || !/^[0-9a-f]{64}$/.test(instance.trim()) || !passphrase}
					data-testid="hosted-bridge-unlock">{t('integrationen.hostedBridge.unlock')}</button
				>
			</form>
			<p class="mt-2 text-xs text-faint">{t('integrationen.hostedBridge.hint')}</p>
		</details>
	{:else}
		<p class="mt-3 text-sm text-text">{t('messages.bridge.needsSync')}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="hosted-bridge-error">{error}</p>
	{/if}
</section>
