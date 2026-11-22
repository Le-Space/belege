<script>
	// "Mit eigenem Passkey zu bestehenden Büchern" (#962, session/own-join.js):
	// on the unlock screen of a device that has no books yet. A passkey of its
	// own, the other device's invite scanned, this device's answer shown for it
	// to scan – then the other device asks "Zulassen?", and the books open here.
	import Qr from '../Qr.svelte';
	import QrScan from './QrScan.svelte';
	import { app, cancelOwnJoin, ownJoinScanned, startOwnJoin } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';

	let label = $state('');
	let pasted = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	let step = $derived(app.sync.ownJoin);

	/** @param {() => Promise<unknown>} action */
	async function doing(action) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<div class="mt-2 space-y-2 text-sm" data-testid="own-join">
	<p class="text-xs text-faint">{t('onboarding.ownJoin.hint')}</p>
	{#if !step}
		<label class="block text-sm font-medium text-heading" for="own-join-label"
			>{t('onboarding.ownJoin.label')}</label
		>
		<input
			id="own-join-label"
			type="text"
			bind:value={label}
			placeholder={t('onboarding.labelPlaceholder')}
			class="w-full rounded-md border px-3 py-2 text-sm"
			data-testid="own-join-label"
		/>
		<button
			type="button"
			class={button}
			disabled={busy}
			onclick={() => doing(() => startOwnJoin(label))}
			data-testid="own-join-start">{t('onboarding.ownJoin.start')}</button
		>
	{:else if step.phase === 'scan'}
		<p class="text-text">{t('onboarding.ownJoin.scan')}</p>
		<QrScan
			onscan={(text) => doing(() => ownJoinScanned(text))}
			class={button}
			prefix="own-join-scan"
		/>
		<form
			class="flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				doing(() => ownJoinScanned(pasted));
			}}
		>
			<label class="flex min-w-48 flex-1 flex-col text-faint"
				>{t('devices.qrMode.pasteLabel')}
				<input
					class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
					bind:value={pasted}
					autocomplete="off"
					spellcheck="false"
					data-testid="own-join-paste"
				/></label
			>
			<button
				type="submit"
				class={button}
				disabled={busy || !pasted.trim()}
				data-testid="own-join-use">{t('devices.qrMode.use')}</button
			>
		</form>
	{:else if step.phase === 'answer'}
		<p class="text-text">{t('onboarding.ownJoin.answer')}</p>
		<!-- A white plaque in both themes: a camera reads it, not the theme. -->
		<div
			class="w-fit rounded-md bg-white p-2 [&_svg]:size-64"
			role="img"
			aria-label={t('devices.qrMode.answerLabel')}
			data-testid="own-join-code"
			data-code={step.code}
		>
			<Qr text={step.code} />
		</div>
		<p class="text-xs text-text" data-testid="own-join-compare">
			{t('onboarding.ownJoin.compare', { self: step.self, peer: step.peer })}
		</p>
	{:else if step.phase === 'error'}
		<p class="text-danger" role="alert" data-testid="own-join-error">{step.error}</p>
	{:else}
		<p class="text-text" role="status" data-testid="own-join-status" data-phase={step.phase}>
			{t(`onboarding.ownJoin.${step.phase}`)}
		</p>
	{/if}
	{#if step && step.phase !== 'done' && step.phase !== 'opening' && step.phase !== 'connecting'}
		<button
			type="button"
			class="text-xs text-faint underline hover:text-heading"
			onclick={() => doing(cancelOwnJoin)}
			data-testid="own-join-cancel">{t('onboarding.ownJoin.cancel')}</button
		>
	{/if}
	{#if error}
		<p class="text-danger" role="alert" data-testid="own-join-failed">{error}</p>
	{/if}
</div>
