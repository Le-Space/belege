<script>
	import '../app.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import { app } from '$lib/session.svelte.js';

	let { children } = $props();

	const nav = /** @type {const} */ ([
		{ href: '/', label: 'Home' },
		{ href: '/zahlungen', label: 'Zahlungen' },
		{ href: '/belege', label: 'Belege' },
		{ href: '/export', label: 'Export' },
		{ href: '/integrationen', label: 'Integrationen' }
	]);

	/** @param {string} did */
	const shortDid = (did) => (did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did);
</script>

{#if app.status !== 'ready'}
	<main class="px-4">
		<PasskeyOnboarding />
	</main>
{:else}
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
			<span class="font-semibold text-slate-900">Belege</span>
			<nav class="flex flex-wrap gap-1 text-sm" aria-label="Hauptnavigation">
				{#each nav as item (item.href)}
					<a
						href={resolve(item.href)}
						class="rounded-md px-3 py-1.5 hover:bg-slate-100"
						class:bg-slate-900={page.url.pathname === item.href}
						class:text-white={page.url.pathname === item.href}
						class:hover:bg-slate-700={page.url.pathname === item.href}
						aria-current={page.url.pathname === item.href ? 'page' : undefined}>{item.label}</a
					>
				{/each}
			</nav>
			{#if app.did}
				<span
					class="ml-auto font-mono text-xs text-slate-500"
					title={app.did}
					data-testid="own-did"
					data-did={app.did}>{shortDid(app.did)}</span
				>
			{/if}
		</div>
	</header>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
{/if}
