<script>
	// "Welche Bridge antwortet?" (Integrationen → Bridge): the bridge on this
	// computer, the hosted one on Aleph and the one on Phala over NEAR, each
	// with what it is doing – so a VM that runs but is still locked, or a
	// hosted bridge answering while the computer has none, shows at a glance.
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { app } from '$lib/session.svelte.js';
	import { bridge, bridgePaired } from './bridge-state.svelte.js';
	import { bridgeStatusRows } from './bridge-status.js';
	import { hosted, loadAleph } from './hosted-status.svelte.js';

	$effect(() => {
		// Whenever the books' settings may have changed underneath (sync, an unlock elsewhere).
		void app.sync.online;
		loadAleph().catch(() => {});
	});

	const rows = $derived(
		bridgeStatusRows({
			local: {
				state: bridge.state,
				route: app.sync.bridgeRoute,
				paired: bridgePaired(),
				peerId: bridge.peerId
			},
			aleph: hosted.aleph,
			near: hosted.near
		})
	);

	/** @param {string | null | undefined} iso */
	const when = (iso) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '');

	/** @param {import('./bridge-status.js').Row} row */
	function detail(row) {
		if (row.id === 'aleph') {
			const { vm, kept } = hosted.aleph;
			if (row.state === 'locked') return t('integrationen.bridgeStatus.detail.locked');
			if (row.kind === 'ok' || row.state === 'silent')
				return t('integrationen.bridgeStatus.detail.attested', { date: when(kept?.attestedAt) });
			if (row.state === 'stopped')
				return t('integrationen.bridgeStatus.detail.stopped', { date: when(vm?.stoppedAt) });
		}
		if (row.id === 'near' && row.kind === 'ok' && hosted.near?.attestedAt)
			return t('integrationen.bridgeStatus.detail.attested', {
				date: when(hosted.near.attestedAt)
			});
		if (row.id === 'local' && row.state === 'silent')
			return t('integrationen.bridgeStatus.detail.localSilent');
		return '';
	}

	const badge = {
		ok: 'bg-success/15 text-success',
		warn: 'bg-warning/15 text-warning',
		err: 'bg-danger/15 text-danger',
		idle: 'bg-border/40 text-faint'
	};
	const target = { local: '#bridge-local', aleph: '#hosted-bridge', near: '#near-bridge' };
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	data-testid="bridge-overall"
>
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.bridgeStatus.title')}</h2>
	<ul class="mt-2 divide-y divide-border">
		{#each rows as row (row.id)}
			<li
				class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
				data-testid="bridge-overall-{row.id}"
				data-kind={row.kind}
				data-state={row.state}
			>
				<a
					class="w-44 font-medium text-heading underline-offset-2 hover:underline"
					href={target[row.id]}>{t(`integrationen.bridgeStatus.name.${row.id}`)}</a
				>
				<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {badge[row.kind]}"
					>{t(`integrationen.bridgeStatus.state.${row.id}.${row.state}`)}</span
				>
				{#if detail(row)}<span class="text-xs text-faint">{detail(row)}</span>{/if}
			</li>
		{/each}
	</ul>
	<p class="mt-2 text-xs text-faint">{t('integrationen.bridgeStatus.hint')}</p>
</section>
