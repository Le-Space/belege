<script>
	import { app } from '$lib/session.svelte.js';

	const hour = new Date().getHours();
	const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
</script>

<h1 class="text-2xl font-semibold text-slate-900">{greeting}!</h1>
<p class="mt-1 text-sm text-slate-600">Hier steht, was in deinen Büchern liegt.</p>

<dl class="mt-6 grid gap-4 sm:grid-cols-3">
	<div class="rounded-lg border border-slate-200 bg-white p-4">
		<dt class="text-sm text-slate-500">Zahlungen</dt>
		<dd class="text-2xl font-semibold" data-testid="count-transactions">
			{app.transactions.length}
		</dd>
	</div>
	<div class="rounded-lg border border-slate-200 bg-white p-4">
		<dt class="text-sm text-slate-500">Belege</dt>
		<dd class="text-2xl font-semibold" data-testid="count-receipts">{app.receipts.length}</dd>
	</div>
	<div class="rounded-lg border border-slate-200 bg-white p-4">
		<dt class="text-sm text-slate-500">Partner</dt>
		<dd class="text-2xl font-semibold" data-testid="count-partners">{app.partners.length}</dd>
	</div>
</dl>
