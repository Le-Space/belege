<script>
	// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/PasskeyOnboarding.svelte) at 56647d5.
	// Changed: Svelte 5 runes, German text, no anonymous identity and no
	// storage choice (belege always uses a passkey and always keeps its data),
	// and the buttons act directly instead of feeding a consent dialog — a
	// WebAuthn call needs the click's user gesture. The look follows
	// apps/escrow01 at f0d3df4: a card on the brand tokens, one coral action.
	import { app, createPasskey, restorePasskey, unlockStoredPasskey } from './session.svelte.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';
	import { intlLocale, t } from './i18n/index.js';
	import ResetDialog from './storage/ResetDialog.svelte';

	const hasStoredPasskey = hasStoredPasskeyCredential();
	// A way to start over without unlocking: the passkey or the store may be what is broken (#212).
	let resetOpen = $state(false);
	let label = $state('');
	let busy = $derived(app.status === 'starting');

	// The unlock's step while the books open (unlock-progress.js), and the time
	// since it began, every second.
	let clock = $state(Date.now());
	$effect(() => {
		if (!busy) return;
		const id = setInterval(() => (clock = Date.now()), 1000);
		return () => clearInterval(id);
	});
	let unlock = $derived(app.unlock);
	/** @param {number} n */
	const count = (n) => new Intl.NumberFormat(intlLocale()).format(n);
	let stepText = $derived.by(() => {
		if (!unlock) return t('onboarding.busy');
		const collection =
			'collection' in unlock ? t(`onboarding.progress.collection.${unlock.collection}`) : '';
		if (unlock.step === 'move') {
			return t('onboarding.progress.move', {
				collection,
				done: count(unlock.done),
				total: count(unlock.total)
			});
		}
		return t(`onboarding.progress.${unlock.step}`, { collection });
	});

	const primary =
		'w-full rounded-md bg-coral-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const secondary =
		'w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<section
	class="mx-auto mt-6 max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm sm:mt-12"
	data-testid="passkey-onboarding"
>
	<h1 class="text-xl font-semibold text-heading">{t('onboarding.title')}</h1>
	<p class="mt-2 text-sm leading-relaxed text-text">{t('onboarding.intro')}</p>

	{#if hasStoredPasskey}
		<button
			type="button"
			class="mt-6 {primary}"
			disabled={busy}
			onclick={unlockStoredPasskey}
			data-testid="passkey-unlock"
		>
			{t('onboarding.unlock')}
		</button>
	{/if}

	<div class="mt-6 space-y-2">
		<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">
			{t('onboarding.newHeading')}
		</h2>
		<label class="block text-sm font-medium text-heading" for="passkey-label"
			>{t('onboarding.label')}</label
		>
		<input
			id="passkey-label"
			type="text"
			bind:value={label}
			placeholder={t('onboarding.labelPlaceholder')}
			class="w-full rounded-md border px-3 py-2 text-sm"
			data-testid="passkey-label"
		/>
		<p class="text-xs text-faint">{t('onboarding.labelHint')}</p>
		<button
			type="button"
			class={hasStoredPasskey ? secondary : primary}
			disabled={busy}
			onclick={() => createPasskey(label)}
			data-testid="passkey-create"
		>
			{t('onboarding.create')}
		</button>
	</div>

	<div class="mt-6 space-y-2 border-t border-border pt-4">
		<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">
			{t('onboarding.restoreHeading')}
		</h2>
		<button
			type="button"
			class={secondary}
			disabled={busy}
			onclick={restorePasskey}
			data-testid="passkey-restore"
		>
			{t('onboarding.restore')}
		</button>
	</div>

	{#if busy}
		<div
			class="mt-4 text-sm text-text"
			role="status"
			data-testid="passkey-busy"
			data-step={unlock?.step}
		>
			<p data-testid="passkey-step">{stepText}</p>
			{#if unlock?.step === 'move'}
				<div
					class="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax={unlock.total}
					aria-valuenow={unlock.done}
					aria-label={stepText}
				>
					<div
						class="h-full bg-cyan-800 dark:bg-cyan"
						style:width="{unlock.total ? (100 * unlock.done) / unlock.total : 0}%"
					></div>
				</div>
				<p class="mt-2 text-xs text-faint" data-testid="passkey-move-hint">
					{t('onboarding.progress.moveHint')}
				</p>
			{/if}
			{#if unlock}
				<p class="mt-1 text-xs text-faint" data-testid="passkey-elapsed">
					{t('onboarding.progress.elapsed', {
						seconds: Math.max(0, Math.round((clock - unlock.since) / 1000))
					})}
				</p>
			{/if}
		</div>
	{/if}
	{#if app.status === 'error' && app.error}
		<p
			class="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-heading"
			role="alert"
			data-testid="passkey-error"
		>
			{app.error}
		</p>
	{/if}
	{#if hasStoredPasskey}
		<button
			type="button"
			class="mt-4 min-h-11 text-xs text-faint underline hover:text-heading"
			onclick={() => (resetOpen = true)}
			data-testid="reset-from-lock">{t('storage.reset.fromLock')}</button
		>
	{/if}
</section>

<ResetDialog bind:open={resetOpen} onclose={() => (resetOpen = false)} />
