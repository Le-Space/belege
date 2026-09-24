<script>
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { list, t } from '$lib/i18n/index.js';
	import { app } from '$lib/session.svelte.js';

	const hour = new Date().getHours();
	const greeting = t(hour < 11 ? 'home.morning' : hour < 18 ? 'home.day' : 'home.evening');

	const card = 'rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
</script>

<h1 class="text-2xl font-bold text-heading">{greeting}!</h1>
<p class="mt-1 text-sm text-faint">{t('home.intro')}</p>

<dl class="mt-6 grid gap-4 sm:grid-cols-3">
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.transactions')}</dt>
		<dd
			class="mt-1 text-3xl font-semibold text-heading tabular-nums"
			data-testid="count-transactions"
		>
			{app.transactions.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.receipts')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-receipts">
			{app.receipts.length}
		</dd>
	</div>
	<div class={card}>
		<dt class="text-sm font-medium text-faint">{t('home.partners')}</dt>
		<dd class="mt-1 text-3xl font-semibold text-heading tabular-nums" data-testid="count-partners">
			{app.partners.length}
		</dd>
	</div>
</dl>

{#if app.did}
	<section class="mt-6 {card}" data-testid="home-identity">
		<h2 class="text-sm font-medium text-faint">{t('home.identity')}</h2>
		<p class="mt-2 font-mono text-xs break-all text-heading">{app.did}</p>
		<p class="mt-2 text-xs text-faint">{t('home.identityHint')}</p>
		<TechnicalNote class="mt-3" lines={list('home.technical')} />
	</section>
{/if}
