<script>
	import { app, currentStore } from '$lib/session.svelte.js';
	import { formatCents, groupByMonth } from '$lib/store/months.js';

	let groups = $derived(
		groupByMonth(
			/** @type {{ id: string, bookedOn: string, counterparty?: string, purpose?: string, amountCents?: number }[]} */ (
				/** @type {unknown} */ (app.transactions)
			)
		)
	);

	// Only in development and in the E2E build; the bank import is step 2.
	const showTestButton = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';

	async function addTestTransaction() {
		await currentStore()?.transactions.put({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: 'Testpartner GmbH',
			purpose: 'Testbuchung',
			amountCents: -1999
		});
	}
</script>

<div class="flex items-center justify-between gap-4">
	<h1 class="text-2xl font-semibold text-slate-900">Zahlungen</h1>
	{#if showTestButton}
		<button
			type="button"
			class="rounded-md border border-dashed border-slate-400 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
			onclick={addTestTransaction}
			data-testid="add-test-transaction">Testbuchung anlegen</button
		>
	{/if}
</div>

{#if groups.length === 0}
	<p
		class="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-slate-600"
		data-testid="transactions-empty"
	>
		Noch keine Zahlungen – Bankanbindung folgt in Schritt 2
	</p>
{:else}
	{#each groups as group (group.month)}
		<section class="mt-6" data-testid="transaction-month">
			<h2 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">{group.label}</h2>
			<ul class="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
				{#each group.items as tx (tx.id)}
					<li class="flex items-baseline gap-4 px-4 py-3" data-testid="transaction">
						<span class="w-24 shrink-0 text-sm text-slate-500">
							{new Date(`${tx.bookedOn}T00:00:00Z`).toLocaleDateString('de-DE', {
								timeZone: 'UTC'
							})}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-slate-900">{tx.counterparty ?? '—'}</span
							>
							{#if tx.purpose}<span class="block truncate text-sm text-slate-500">{tx.purpose}</span
								>{/if}
						</span>
						<span
							class="shrink-0 font-mono tabular-nums"
							class:text-red-700={(tx.amountCents ?? 0) < 0}
						>
							{formatCents(tx.amountCents ?? 0)}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}
