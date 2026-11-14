<script>
	// What a device added from here may use at the bridge (#579), ticked before
	// it is added – by QR, by its id, or let in when it asks. Kept in the
	// device's record; the bridge gives it to a device new to it, and the
	// device that paired the bridge changes it later per device (BridgeAccess).
	// Shown only when the books have a bridge.
	import { onDestroy } from 'svelte';
	import { app, setNewDeviceBridgeScopes } from '$lib/session.svelte.js';
	import { t } from '$lib/i18n/index.js';
	import { DEVICE_SCOPES, scopeLabel } from '$lib/bridge/scopes.js';

	/** @type {string[]} */
	let ticked = $state([...DEVICE_SCOPES]);
	const hasBridge = $derived((app.sync.state?.devices ?? []).some((d) => d.bridge));

	$effect(() => {
		setNewDeviceBridgeScopes(hasBridge ? ticked : null);
	});
	onDestroy(() => setNewDeviceBridgeScopes(null));

	/** @param {string} scope @param {boolean} on */
	function tick(scope, on) {
		ticked = DEVICE_SCOPES.filter((s) => (s === scope ? on : ticked.includes(s)));
	}
</script>

{#if hasBridge}
	<fieldset class="mt-2 text-sm" data-testid="devices-new-scopes">
		<legend class="text-heading">{t('devices.newScopes')}</legend>
		<p class="text-xs text-faint">{t('devices.newScopesText')}</p>
		<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
			{#each DEVICE_SCOPES as scope (scope)}
				<label class="inline-flex items-center gap-1 text-text">
					<input
						type="checkbox"
						checked={ticked.includes(scope)}
						onchange={(e) => tick(scope, e.currentTarget.checked)}
						data-testid="devices-new-scope"
						data-scope={scope}
					/>
					{scopeLabel(scope)}
				</label>
			{/each}
		</div>
	</fieldset>
{/if}
