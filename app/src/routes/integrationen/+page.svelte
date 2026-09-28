<script>
	// Integrationen (issue #152): what Belege is connected to and what needs the
	// person, at a glance. One row per integration with its state; everything
	// else on its own page (/integrationen/<id>). The bridge is the first row
	// and shows its pairing right here, because everything else waits for it.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { getSetting } from '$lib/store/settings.js';
	import { loadWallets } from '$lib/wallets/wallet-sync.js';
	import { loadAleph } from '$lib/aleph/aleph.js';
	import { isWalletSource } from '$lib/wallets/chains.js';
	import { describeMoment } from '$lib/moment.js';
	import { t } from '$lib/i18n/index.js';
	import BridgePanel from '$lib/integrations/BridgePanel.svelte';
	import { bridge, loadBridge } from '$lib/integrations/bridge-state.svelte.js';
	import { integrationsOverview } from '$lib/integrations/overview.js';

	let wallets = $state(0);
	let aleph = $state(0);
	let invoiceApp = $state(false);
	let deviceFlag = $state(false);

	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		try {
			deviceFlag = localStorage.getItem('belege.device-sync') !== null;
		} catch {
			deviceFlag = false;
		}
		const [w, a, inv] = await Promise.all([
			loadWallets(store.settings),
			loadAleph(store.settings),
			getSetting(store.settings, 'ucepInvoiceApp')
		]);
		wallets = w.length;
		aleph = a.accounts.length;
		invoiceApp = Boolean(inv);
		await loadBridge();
	});

	let view = $derived(
		integrationsOverview({
			bridge: { token: bridge.token, state: bridge.state, health: bridge.health },
			devices: {
				flag: deviceFlag,
				online: app.sync.online,
				removed: app.sync.removed,
				error: app.sync.error,
				connected: (app.sync.state?.devices ?? []).filter((d) => d.connected).length
			},
			accounts: app.accounts,
			events: app.events,
			wallets,
			aleph,
			invoiceApp,
			isWalletSource
		})
	);

	const GROUPS = /** @type {const} */ (['basis', 'sources', 'together']);
	const CHIP = {
		ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
		warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
		err: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
		off: 'border border-border text-faint'
	};
	/** @param {import('$lib/integrations/overview.js').Row} r */
	const hrefOf = (r) => resolve(/** @type {any} */ (r.href ?? `/integrationen/${r.id}`));
	/** @param {string | null} iso */
	const when = (iso) => (iso ? (describeMoment(iso)?.local ?? '') : '');
	/** @param {string} id */
	const nameOf = (id) => t(`integrationen.overview.name.${id || 'mail'}`);
</script>

<svelte:head><title>{t('integrationen.title')} · Le Space Belege</title></svelte:head>

<h1 class="text-2xl font-bold text-heading">{t('integrationen.title')}</h1>
<p class="mt-1 text-sm text-text">{t('integrationen.overview.intro')}</p>

<div class="mt-4 grid grid-cols-3 gap-2 sm:gap-3" data-testid="integrations-counts">
	<div class="rounded-lg border border-border bg-surface px-3 py-3 sm:px-4">
		<div class="font-mono text-2xl text-heading" data-testid="count-ok">{view.counts.ok}</div>
		<div class="text-xs text-text sm:text-sm">{t('integrationen.overview.countOk')}</div>
	</div>
	<div
		class="rounded-lg border px-3 py-3 sm:px-4 {view.counts.needs
			? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950'
			: 'border-border bg-surface'}"
	>
		<div class="font-mono text-2xl text-heading" data-testid="count-needs">{view.counts.needs}</div>
		<div class="text-xs text-text sm:text-sm">{t('integrationen.overview.countNeeds')}</div>
	</div>
	<div class="rounded-lg border border-border bg-surface px-3 py-3 sm:px-4">
		<div class="font-mono text-2xl text-heading" data-testid="count-off">{view.counts.off}</div>
		<div class="text-xs text-text sm:text-sm">{t('integrationen.overview.countOff')}</div>
	</div>
</div>

{#if view.needs.length}
	<section
		class="mt-4 rounded-lg border border-amber-300 bg-surface px-4 py-3 sm:px-5 dark:border-amber-700"
		aria-labelledby="needs-h"
		data-testid="integrations-needs"
	>
		<h2 id="needs-h" class="text-base font-semibold text-heading">
			{t('integrationen.overview.needsTitle')}
		</h2>
		<ul class="mt-1 divide-y divide-border">
			{#each view.needs as n (n.id + n.text)}
				<li>
					<a
						href={resolve(/** @type {any} */ (`/integrationen/${n.id}`))}
						class="flex min-h-14 items-center gap-3 py-2 text-heading"
						data-testid="integrations-need"
					>
						<span class="rounded-full px-2 py-0.5 text-xs font-semibold {CHIP[n.kind]}"
							>{t(`integrationen.overview.needKind.${n.kind}`)}</span
						>
						<span class="min-w-0 flex-1 text-sm"
							><span class="font-medium">{nameOf(n.id)}</span> –
							{t(`integrationen.overview.need.${n.text}`, n.params ?? {})}</span
						>
						<span aria-hidden="true" class="text-faint">›</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#each GROUPS as g (g)}
	<section class="mt-6" aria-labelledby="grp-{g}">
		<div class="flex items-baseline gap-2">
			<h2 id="grp-{g}" class="text-xs font-semibold tracking-wide text-faint uppercase">
				{t(`integrationen.overview.group.${g}`)}
			</h2>
			<span class="text-xs text-faint">{t(`integrationen.overview.groupHint.${g}`)}</span>
		</div>
		<ul class="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
			{#each view.rows.filter((r) => r.group === g) as r (r.id + r.initials)}
				<li data-testid="integration-row" data-id={r.id || 'mail'} data-kind={r.kind}>
					{#if r.id === 'bridge'}
						<div class="px-4 py-3">
							<div class="flex items-center gap-3">
								<span
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-heading"
									aria-hidden="true">{r.initials}</span
								>
								<a
									href={hrefOf(r)}
									class="font-semibold text-heading hover:underline"
									data-testid="integration-bridge">{nameOf(r.id)}</a
								>
								<span class="rounded-full px-2 py-0.5 text-xs font-semibold {CHIP[r.kind]}"
									>{t(`integrationen.overview.state.${r.state}`)}</span
								>
							</div>
							<div class="mt-2 sm:pl-13">
								<BridgePanel intro={false} />
							</div>
						</div>
					{:else}
						<a
							href={hrefOf(r)}
							class="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface-2"
							data-testid="integration-{r.id || 'mail'}"
						>
							<span
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-heading"
								aria-hidden="true">{r.initials}</span
							>
							<span class="min-w-0 flex-1">
								<span class="flex flex-wrap items-center gap-2">
									<span class="font-semibold text-heading">{nameOf(r.id)}</span>
									<span class="rounded-full px-2 py-0.5 text-xs font-semibold {CHIP[r.kind]}"
										>{t(`integrationen.overview.state.${r.state}`, r.params ?? {})}</span
									>
								</span>
								<span class="block text-sm text-text"
									>{t(`integrationen.overview.line.${r.line}`, r.params ?? {})}</span
								>
							</span>
							{#if r.when}
								<span class="hidden text-xs text-faint sm:block"
									>{t('integrationen.overview.when', { when: when(r.when) })}</span
								>
							{/if}
							<span aria-hidden="true" class="text-lg text-faint">›</span>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/each}

<p class="mt-6 text-sm text-faint">
	{t('integrationen.overview.settingsMoved')}
	<a class="underline" href={resolve('/einstellungen')}>{t('settings.title')}</a>.
</p>
