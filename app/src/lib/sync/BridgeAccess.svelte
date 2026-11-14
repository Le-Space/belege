<script>
	// What each device may do with the bridge's own node (#579), under
	// Geräte → Erweitert. The device that paired the bridge sees every device's
	// access, ticks per device which areas it may use (`device.scopes`), and
	// renews one that lapsed after 90 days unused; any other device sees its
	// own, the boxes disabled. Shown only while the bridge's node is connected.
	import {
		app,
		bridgeGrants,
		renewBridgeDevice,
		setBridgeDeviceScopes
	} from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { scopeChoices, scopeLabel, toggled } from '$lib/bridge/scopes.js';
	import { usageList, usageTotal } from './bridge-usage.js';

	/** @type {{ holder: boolean, scopes: string[], settable?: string[], devices: { peerId: string, scopes: string[], lastUsedAt: number | null, expiresAt: number | null, usage?: unknown }[] } | null} */
	let grants = $state(null);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} the device being renewed */
	let renewing = $state(null);
	/** @type {string | null} the device whose scopes are being saved */
	let saving = $state(null);
	const choices = $derived(grants ? scopeChoices(grants) : []);

	async function load() {
		try {
			grants = await bridgeGrants();
		} catch {
			grants = null;
		}
	}
	$effect(() => {
		// Again when the way to the bridge or the device list changes.
		void app.sync.bridgeRoute;
		void app.sync.state?.devices.length;
		load();
	});

	/** @param {string} peerId */
	async function renew(peerId) {
		renewing = peerId;
		error = null;
		try {
			await renewBridgeDevice(peerId);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			renewing = null;
		}
	}

	/**
	 * One box ticked or not: saved at once, then read back from the bridge.
	 *
	 * @param {{ peerId: string, scopes: string[] }} g
	 * @param {string} scope
	 * @param {boolean} on
	 */
	async function tick(g, scope, on) {
		saving = g.peerId;
		error = null;
		try {
			await setBridgeDeviceScopes(g.peerId, toggled(g.scopes, choices, scope, on));
		} catch (e) {
			error = t('devices.bridgeAccess.saveFailed', {
				reason: e instanceof Error ? e.message : String(e)
			});
		} finally {
			await load();
			saving = null;
		}
	}

	/** @param {number} at */
	const moment = (at) =>
		new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(at)
		);
	/** @param {number} at */
	const day = (at) =>
		new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(at));
	/** @param {string} peerId */
	const name = (peerId) =>
		peerId === app.sync.state?.self
			? t('devices.bridgeAccess.thisDevice')
			: app.sync.state?.devices.find((d) => d.peerId === peerId)?.label ||
				`${peerId.slice(0, 10)}…`;
	/** @param {{ scopes: string[] }} g some area not ticked */
	const narrowed = (g) => choices.some((s) => !g.scopes.includes(s));
	const button =
		'rounded-md border border-border px-3 py-1 text-xs text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

{#if grants && grants.devices.length}
	<div class="mt-4 text-sm" data-testid="bridge-access">
		<h4 class="text-heading">{t('devices.bridgeAccess.title')}</h4>
		<p class="text-xs text-faint">{t('devices.bridgeAccess.text')}</p>
		<ul class="mt-2 space-y-1">
			{#each grants.devices as g (g.peerId)}
				{@const lapsed = g.expiresAt !== null && g.expiresAt < Date.now()}
				{@const used = usageList(g.usage)}
				{@const total = usageTotal(used)}
				<li class="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="bridge-access-device">
					<span class="text-heading">{name(g.peerId)}</span>
					<span class="text-xs {lapsed ? 'text-warning' : 'text-faint'}">
						{#if lapsed}
							{t('devices.bridgeAccess.lapsed')}
						{:else if g.expiresAt === null}
							{t('devices.bridgeAccess.holder')}
						{:else}
							{t('devices.bridgeAccess.until', { date: day(g.expiresAt) })}
						{/if}
						{#if g.lastUsedAt}
							· {t('devices.bridgeAccess.lastUsed', { date: day(g.lastUsedAt) })}
						{/if}
						{#if narrowed(g)}
							· {t('devices.bridgeAccess.narrowed', {
								count: g.scopes.filter((s) => choices.includes(s)).length
							})}
						{/if}
					</span>
					{#if lapsed && grants.holder}
						<button
							type="button"
							class={button}
							disabled={renewing !== null}
							onclick={() => renew(g.peerId)}
							data-testid="bridge-access-renew">{t('devices.bridgeAccess.renew')}</button
						>
					{:else if lapsed}
						<span class="text-xs text-faint">{t('devices.bridgeAccess.askHolder')}</span>
					{/if}
					{#if choices.length}
						<fieldset
							class="w-full"
							disabled={!grants.holder || saving !== null}
							data-testid="bridge-access-scopes"
						>
							<legend class="sr-only">{t('devices.bridgeAccess.scopes')}</legend>
							<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
								{#each choices as scope (scope)}
									<label class="inline-flex items-center gap-1 text-text">
										<input
											type="checkbox"
											checked={g.scopes.includes(scope)}
											onchange={(e) => tick(g, scope, e.currentTarget.checked)}
											data-testid="bridge-access-scope"
											data-scope={scope}
										/>
										{scopeLabel(scope)}
									</label>
								{/each}
								{#if saving === g.peerId}
									<span class="text-faint">{t('devices.bridgeAccess.saving')}</span>
								{/if}
							</div>
						</fieldset>
					{/if}
					<details class="w-full text-xs" data-testid="bridge-access-usage">
						<summary class="cursor-pointer text-faint" data-testid="bridge-access-usage-total">
							{used.length
								? t('devices.bridgeAccess.usage', total)
								: t('devices.bridgeAccess.usageNone')}
						</summary>
						<p class="mt-1 text-faint">{t('devices.bridgeAccess.usageText')}</p>
						{#if used.length}
							<ul class="mt-1 space-y-0.5">
								{#each used as u (u.command)}
									<li data-testid="bridge-access-usage-item" data-command={u.command}>
										<code class="text-heading">{u.command}</code>
										<span class="text-faint">
											{t('devices.bridgeAccess.usageItem', {
												calls: u.calls,
												refused: u.refused,
												date: u.lastAt ? moment(u.lastAt) : '–'
											})}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</details>
				</li>
			{/each}
		</ul>
		{#if !grants.holder}
			<p class="mt-1 text-xs text-faint">{t('devices.bridgeAccess.onlyHolder')}</p>
		{/if}
		{#if error}
			<p class="mt-1 text-xs text-danger" role="alert">{error}</p>
		{/if}
	</div>
{/if}
