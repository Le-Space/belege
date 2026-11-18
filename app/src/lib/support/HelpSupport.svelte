<script>
	// "Hilfe & Support" in the footer: where to write, what helps, what Le Space
	// never asks for, where weaknesses go, and a diagnosis to copy. Works locked
	// and unlocked: a stuck unlock is when help is needed most. The diagnosis is
	// shown in full before it is copied (diagnosis.js says what it holds).
	import { builtFrom, releaseName, SOURCE_URL } from '../build-info.js';
	import { app } from '../session.svelte.js';
	import { deviceSyncOn } from '../sync/device-sync.js';
	import { networkPause } from '../network-pause.js';
	import { networkMode } from '../sync/network-mode.js';
	import { t } from '../i18n/index.js';
	import { diagnosisText } from './diagnosis.js';

	const APP_MAIL = 'belege@le-space.de';
	const BILLING_MAIL = 'support@le-space.de';
	const SECURITY_MAIL = 'security@le-space.de';

	/** @type {{ onclose: () => void }} */
	let { onclose } = $props();

	/** @type {{ usage?: number, quota?: number } | null} */
	let storage = $state(null);
	let copied = $state(/** @type {'' | 'ok' | 'failed'} */ (''));

	$effect(() => {
		navigator.storage
			?.estimate?.()
			.then((e) => (storage = { usage: e.usage, quota: e.quota }))
			.catch(() => {});
	});

	/** @param {() => unknown} f */
	const safe = (f) => {
		try {
			return f();
		} catch {
			return null;
		}
	};

	let text = $derived(
		diagnosisText({
			release: releaseName(),
			commit: builtFrom()?.short ?? null,
			status: app.status,
			step: app.unlock
				? `${app.unlock.step}${'part' in app.unlock && app.unlock.part ? `/${app.unlock.part}` : ''}`
				: null,
			stepSeconds: app.unlock ? (Date.now() - app.unlock.stepSince) / 1000 : null,
			error: app.error,
			userAgent: navigator.userAgent,
			language: navigator.language,
			online: navigator.onLine,
			standalone: safe(() => matchMedia('(display-mode: standalone)').matches) === true,
			deviceSync: safe(deviceSyncOn) === true,
			networkPaused: safe(networkPause) === true,
			networkMode: String(safe(networkMode) ?? ''),
			storage,
			now: new Date()
		})
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = 'ok';
		} catch {
			copied = 'failed';
		}
	}
</script>

<section
	class="mt-3 rounded-md border border-border bg-surface p-3 text-sm text-text"
	aria-labelledby="support-title"
	data-testid="support"
>
	<div class="flex items-start justify-between gap-3">
		<h2 id="support-title" class="font-semibold text-heading">{t('support.title')}</h2>
		<button
			type="button"
			class="text-xs text-faint underline hover:text-heading"
			onclick={onclose}
			data-testid="support-close">{t('support.close')}</button
		>
	</div>
	<p class="mt-2">
		{t('support.contact')}
		<a class="underline" href="mailto:{APP_MAIL}" data-testid="support-mail">{APP_MAIL}</a>
	</p>
	<p class="mt-1">
		{t('support.billing')}
		<a class="underline" href="mailto:{BILLING_MAIL}" data-testid="support-billing"
			>{BILLING_MAIL}</a
		>
	</p>
	<p class="mt-2 text-xs">{t('support.send')}</p>
	<p
		class="mt-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs font-medium text-heading"
		data-testid="support-never"
	>
		{t('support.never')}
	</p>
	<p class="mt-2 text-xs">
		{t('support.security')}
		<a class="underline" href="mailto:{SECURITY_MAIL}" data-testid="support-security-mail"
			>{SECURITY_MAIL}</a
		>
		{t('support.securityPolicy')}
		<a
			class="underline"
			href="{SOURCE_URL}/blob/main/SECURITY.md"
			target="_blank"
			rel="noopener noreferrer"
			data-testid="support-security">SECURITY.md</a
		>
	</p>
	<h3 class="mt-3 text-xs font-semibold text-heading">{t('support.diagnosisTitle')}</h3>
	<p class="mt-0.5 text-xs text-faint">{t('support.diagnosisHint')}</p>
	<pre
		class="mt-1 max-h-48 overflow-auto rounded bg-surface-2 px-2 py-1 font-mono text-[11px] leading-snug whitespace-pre-wrap"
		data-testid="support-diagnosis">{text}</pre>
	<div class="mt-1.5 flex items-center gap-3">
		<button
			type="button"
			class="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface-2 hover:text-heading"
			onclick={copy}
			data-testid="support-copy">{t('support.copy')}</button
		>
		<span class="text-xs text-faint" role="status" data-testid="support-copied"
			>{copied === 'ok'
				? t('support.copied')
				: copied === 'failed'
					? t('support.copyFailed')
					: ''}</span
		>
	</div>
</section>
