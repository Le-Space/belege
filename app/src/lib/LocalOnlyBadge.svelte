<script>
	// The network's state in the header, on every page (network-status.js):
	// "Nur dieses Gerät" while nothing is online; once device sync or the
	// invoicing app is on, which of them, with a dot that says how – pulsing
	// while connecting, filled when online, green when an own device or the
	// app is connected, red on a failure. Hover lists each part; a click opens
	// the consent screen, which says what goes where.
	import { app } from './session.svelte.js';
	import { consent } from './consent.js';
	import { t } from './i18n/index.js';
	import { networkStatus } from './network-status.js';

	let status = $derived(networkStatus(app));
	let label = $derived(
		status.parts.length === 0
			? t('header.localOnly')
			: status.parts.length === 2
				? t('header.network.both')
				: t(`header.network.only.${status.parts[0].id}`)
	);
	let title = $derived(
		status.parts.length === 0
			? t('header.localOnlyTitle')
			: [
					t('header.network.title'),
					...status.parts.map((p) =>
						t(`header.network.part.${p.id}.${p.state}`, {
							count: p.devices ?? 0,
							error: p.error ?? ''
						})
					),
					t('header.network.more')
				].join('\n')
	);
	const DOT = {
		off: 'border-2 border-faint',
		connecting: 'bg-amber-500 animate-pulse',
		online: 'bg-cyan-600 dark:bg-cyan-400',
		connected: 'bg-emerald-600 dark:bg-emerald-400',
		failed: 'bg-red-600 dark:bg-red-400'
	};
</script>

<button
	type="button"
	onclick={() => consent.reopen()}
	{title}
	aria-label={title}
	data-testid="local-only"
	data-state={status.state}
	class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
>
	<span class="h-2 w-2 shrink-0 rounded-full {DOT[status.state]}" aria-hidden="true"></span>
	<span>{label}</span>
</button>
