<script>
	// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/PasskeyOnboarding.svelte) at 56647d5.
	// Changed: Svelte 5 runes, German text, no anonymous identity and no
	// storage choice (belege always uses a passkey and always keeps its data),
	// and the buttons act directly instead of feeding a consent dialog — a
	// WebAuthn call needs the click's user gesture.
	import { app, createPasskey, restorePasskey, unlockStoredPasskey } from './session.svelte.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';

	const hasStoredPasskey = hasStoredPasskeyCredential();
	let label = $state('');
	let busy = $derived(app.status === 'starting');
</script>

<section
	class="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
	data-testid="passkey-onboarding"
>
	<h1 class="text-xl font-semibold text-slate-900">Belege</h1>
	<p class="mt-2 text-sm text-slate-600">
		Deine Buchhaltungsdaten bleiben auf diesem Gerät und werden mit einem Schlüssel aus deinem
		Passkey verschlüsselt. Ohne den Passkey kann niemand sie lesen – auch wir nicht.
	</p>

	{#if hasStoredPasskey}
		<button
			type="button"
			class="mt-6 w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
			disabled={busy}
			onclick={unlockStoredPasskey}
			data-testid="passkey-unlock"
		>
			Mit gespeichertem Passkey entsperren
		</button>
	{/if}

	<div class="mt-6 space-y-2">
		<label class="block text-sm font-medium text-slate-700" for="passkey-label"
			>Name für den Passkey</label
		>
		<input
			id="passkey-label"
			type="text"
			bind:value={label}
			placeholder="z. B. Firma Mustermann"
			class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
			data-testid="passkey-label"
		/>
		<p class="text-xs text-slate-500">
			Nur eine Beschriftung in der Passkey-Auswahl. Die Identität kommt aus dem Schlüssel, nicht aus
			diesem Namen.
		</p>
		<button
			type="button"
			class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
			disabled={busy}
			onclick={() => createPasskey(label)}
			data-testid="passkey-create"
		>
			Passkey anlegen
		</button>
	</div>

	<button
		type="button"
		class="mt-4 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
		disabled={busy}
		onclick={restorePasskey}
		data-testid="passkey-restore"
	>
		Mit vorhandenem Passkey wiederherstellen
	</button>

	{#if busy}
		<p class="mt-4 text-sm text-slate-600" data-testid="passkey-busy">
			Bitte den Passkey bestätigen …
		</p>
	{/if}
	{#if app.status === 'error' && app.error}
		<p
			class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
			role="alert"
			data-testid="passkey-error"
		>
			{app.error}
		</p>
	{/if}
</section>
