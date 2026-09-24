<script>
	import { resolve } from '$app/paths';
	import { app, currentStore } from '$lib/session.svelte.js';
	import {
		displayPurpose,
		formatMoney,
		groupByDay,
		hasReceipt,
		matchesSearch,
		monthSummaries
	} from '$lib/bank/format.js';

	/** @typedef {{ id: string, bookedOn: string, counterparty?: string, purpose?: string, amountCents?: number, currency?: string, accountId?: string, source?: string, receiptId?: string | null }} Tx */

	let accountId = $state('');
	let query = $state('');
	/** @type {'ohne' | 'alle'} */
	let receiptFilter = $state('ohne');
	/** @type {string | null} */
	let chosenMonth = $state(null);

	let transactions = $derived(/** @type {Tx[]} */ (/** @type {unknown} */ (app.transactions)));
	let accountsById = $derived(new Map(app.accounts.map((a) => [a.id, a])));

	/** Account and search, but not the receipt filter: its buttons count both ways. */
	let searched = $derived(
		transactions.filter(
			(tx) => (!accountId || tx.accountId === accountId) && matchesSearch(tx, query)
		)
	);
	let withoutReceipt = $derived(searched.filter((tx) => !hasReceipt(tx)));
	let filtered = $derived(receiptFilter === 'ohne' ? withoutReceipt : searched);
	let months = $derived(monthSummaries(filtered));
	let month = $derived(
		chosenMonth && months.some((m) => m.month === chosenMonth)
			? chosenMonth
			: (months[0]?.month ?? null)
	);
	let days = $derived(
		groupByDay(filtered.filter((tx) => String(tx.bookedOn ?? '').slice(0, 7) === month))
	);

	/** @param {Tx} tx */
	function badge(tx) {
		const account = tx.accountId ? accountsById.get(tx.accountId) : null;
		if (!account) return tx.source === 'camt' ? 'CAMT' : '';
		return `${account.source === 'camt' ? 'CAMT' : 'Hibiscus'} ···${account.ibanLast4}`;
	}

	// Only in development and in the E2E build.
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

<div class="flex flex-wrap items-center justify-between gap-4">
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

{#if transactions.length === 0}
	<p
		class="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-slate-600"
		data-testid="transactions-empty"
	>
		Noch keine Zahlungen – unter <a class="underline" href={resolve('/integrationen')}
			>Integrationen</a
		> die Bank anbinden oder einen Kontoauszug importieren.
	</p>
{:else}
	<div class="mt-4 flex flex-wrap items-center gap-3">
		<label class="sr-only" for="account-filter">Konto</label>
		<select
			id="account-filter"
			bind:value={accountId}
			class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
			data-testid="account-filter"
		>
			<option value="">Alle Konten</option>
			{#each app.accounts as account (account.id)}
				<option value={account.id}>{account.name} ···{account.ibanLast4}</option>
			{/each}
		</select>
		<label class="sr-only" for="transaction-search">Suchen</label>
		<input
			id="transaction-search"
			type="search"
			bind:value={query}
			placeholder="Suchen: Name, Betrag, Datum"
			class="min-w-48 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
			data-testid="transaction-search"
		/>
		<div class="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm" role="group">
			<button
				type="button"
				class="rounded px-3 py-1"
				class:bg-slate-900={receiptFilter === 'ohne'}
				class:text-white={receiptFilter === 'ohne'}
				aria-pressed={receiptFilter === 'ohne'}
				onclick={() => (receiptFilter = 'ohne')}
				data-testid="filter-without-receipt">Nur ohne Beleg ({withoutReceipt.length})</button
			>
			<button
				type="button"
				class="rounded px-3 py-1"
				class:bg-slate-900={receiptFilter === 'alle'}
				class:text-white={receiptFilter === 'alle'}
				aria-pressed={receiptFilter === 'alle'}
				onclick={() => (receiptFilter = 'alle')}
				data-testid="filter-all">Alle ({searched.length})</button
			>
		</div>
	</div>

	<div class="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
		<nav aria-label="Monate">
			<ul class="space-y-1">
				{#each months as m (m.month)}
					<li>
						<button
							type="button"
							class="w-full rounded-md border px-3 py-2 text-left"
							class:border-slate-900={m.month === month}
							class:bg-white={m.month === month}
							class:border-transparent={m.month !== month}
							aria-current={m.month === month ? 'true' : undefined}
							onclick={() => (chosenMonth = m.month)}
							data-testid="transaction-month"
							data-month={m.month}
						>
							<span class="flex items-baseline justify-between gap-2">
								<span class="font-medium text-slate-900">{m.label}</span>
								<span class="text-sm text-slate-500" data-testid="month-count">{m.count}</span>
							</span>
							<span
								class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-200"
								role="progressbar"
								aria-label="Belegabdeckung {m.label}"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={m.coverage}
							>
								<span class="block h-full bg-emerald-500" style="width: {m.coverage}%"></span>
							</span>
							<span class="mt-0.5 block text-xs text-slate-500">{m.coverage} % mit Beleg</span>
						</button>
					</li>
				{:else}
					<li class="px-3 py-2 text-sm text-slate-500">Keine Treffer</li>
				{/each}
			</ul>
		</nav>

		<section aria-label="Buchungen" class="min-w-0">
			{#each days as day (day.day)}
				<div class="mb-4" data-testid="transaction-day" data-day={day.day}>
					<h2 class="text-sm font-semibold text-slate-500">{day.label}</h2>
					<ul class="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
						{#each day.items as tx (tx.id)}
							<li class="flex items-center gap-3 px-4 py-3" data-testid="transaction">
								<span class="min-w-0 flex-1">
									<span class="block truncate font-medium text-slate-900"
										>{tx.counterparty || '—'}</span
									>
									{#if tx.purpose}<span
											class="block truncate text-sm text-slate-500"
											title={tx.purpose}
											data-testid="purpose">{displayPurpose(tx.purpose)}</span
										>{/if}
								</span>
								{#if badge(tx)}
									<span
										class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600"
										data-testid="account-badge">{badge(tx)}</span
									>
								{/if}
								<span
									class="shrink-0 font-mono whitespace-nowrap tabular-nums"
									class:text-red-700={(tx.amountCents ?? 0) < 0}
									class:text-emerald-700={(tx.amountCents ?? 0) > 0}
									data-testid="amount"
								>
									{formatMoney(tx.amountCents ?? 0, tx.currency)}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">
					Keine Zahlungen für diese Auswahl.
				</p>
			{/each}
		</section>
	</div>
{/if}
