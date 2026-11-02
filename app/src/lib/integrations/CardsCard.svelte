<script>
	// Company credit cards (issue #382): each card an account of its own
	// (bank/card-import.js), its statement read from the issuer's CSV in the
	// browser (bank/card-csv.js). The columns are recognised by their names;
	// before the import, the mapping and the sign can be changed and the lines
	// are shown. What was chosen is kept for the card's next statement.
	import { btn } from '$lib/ui/styles.js';
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { decodeChartBytes } from '$lib/booking/chart.js';
	import { FIELDS, cardLines, chargesPositive, readCardCsv } from '$lib/bank/card-csv.js';
	import { addCard, importCardLines, isCardAccount } from '$lib/bank/card-import.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';

	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';

	let cards = $derived(app.accounts.filter(isCardAccount));
	let lineCount = $derived(
		new Map(
			cards.map((c) => [
				c.id,
				app.transactions.filter((tx) => tx.accountId === c.id && !tx.deleted).length
			])
		)
	);

	let name = $state('');
	let last4 = $state('');
	let adding = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let done = $state(null);

	/**
	 * A statement read, waiting for its import.
	 *
	 * @type {{ account: Record<string, any>, header: string[], rows: string[][], mapping: Record<string, number | undefined>, invert: boolean } | null}
	 */
	let pending = $state(null);
	let preview = $derived.by(() => {
		const p =
			/** @type {{ rows: string[][], mapping: Record<string, number | undefined>, invert: boolean } | null} */ (
				pending
			);
		return p
			? cardLines({ rows: p.rows, mapping: /** @type {any} */ (p.mapping) }, { invert: p.invert })
			: null;
	});

	/** @param {() => Promise<void>} fn */
	async function run(fn) {
		busy = true;
		error = null;
		done = null;
		try {
			await fn();
		} catch (e) {
			const code = /** @type {any} */ (e)?.code;
			error =
				code === 'name' || code === 'last4'
					? t(`integrationen.cards.error.${code}`)
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			busy = false;
		}
	}

	const add = () =>
		run(async () => {
			const store = currentStore();
			if (!store) return;
			await addCard(store.accounts, { name, last4 });
			name = '';
			last4 = '';
			adding = false;
			await refreshNow();
		});

	/**
	 * @param {Record<string, any>} account
	 * @param {Event & { currentTarget: HTMLInputElement }} e
	 */
	const read = (account, e) =>
		run(async () => {
			const file = e.currentTarget.files?.[0];
			e.currentTarget.value = '';
			if (!file) return;
			let table;
			try {
				table = readCardCsv(decodeChartBytes(new Uint8Array(await file.arrayBuffer())));
			} catch {
				throw new Error(t('integrationen.cards.error.noTable'));
			}
			// The same issuer as last time: the mapping and sign chosen then.
			const known =
				account.csvFormat && account.csvFormat.header?.join('|') === table.header.join('|')
					? account.csvFormat
					: null;
			pending = {
				account,
				header: table.header,
				rows: table.rows,
				mapping: { ...(known?.mapping ?? table.mapping) },
				invert: known ? Boolean(known.invert) : chargesPositive(table)
			};
		});

	/** @param {string} f @param {string} value */
	function setColumn(f, value) {
		if (!pending) return;
		const next = { ...pending.mapping };
		if (value === '') delete next[f];
		else next[f] = Number(value);
		pending.mapping = next;
	}

	const importNow = () =>
		run(async () => {
			const store = currentStore();
			if (!store || !pending || !preview) return;
			const counts = await importCardLines(store, pending.account, preview.lines, {
				header: pending.header,
				mapping: /** @type {any} */ ($state.snapshot(pending.mapping)),
				invert: pending.invert
			});
			done = t('integrationen.cards.imported', {
				name: String(pending.account.name),
				new: counts.new,
				skipped: counts.skipped
			});
			pending = null;
			await refreshNow();
			runMatchingNow().catch(() => {});
		});

	let sums = $derived(
		preview
			? {
					out: preview.lines
						.filter((l) => l.amountCents < 0)
						.reduce((s, l) => s + l.amountCents, 0),
					in: preview.lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0)
				}
			: null
	);
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="cards-h"
	data-testid="cards-card"
>
	<h2 id="cards-h" class="text-lg font-semibold">{t('integrationen.cards.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.cards.intro')}</p>

	{#if cards.length}
		<ul class="mt-3 divide-y divide-border text-sm">
			{#each cards as card (card.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="card">
					<span class="font-medium text-heading">{card.name} ···{card.ibanLast4}</span>
					<span class="text-xs text-faint"
						>{t('integrationen.cards.lines', {
							count: lineCount.get(card.id) ?? 0
						})}{card.lastSyncedOn ? ` · ${formatDate(card.lastSyncedOn)}` : ''}</span
					>
					<label class="ml-auto inline-flex cursor-pointer items-center {btn.secondary}">
						{t('integrationen.cards.choose')}
						<input
							type="file"
							accept=".csv,text/csv,text/plain"
							disabled={busy}
							onchange={(e) => read(card, e)}
							class="sr-only"
							data-testid="card-file"
						/>
					</label>
				</li>
			{/each}
		</ul>
	{/if}

	{#if pending && preview}
		<div class="mt-3 rounded-md border border-border p-3" data-testid="card-preview">
			<p class="text-sm font-medium text-heading">
				{t('integrationen.cards.previewTitle', { name: String(pending.account.name) })}
			</p>
			<p class="mt-1 text-xs text-faint">{t('integrationen.cards.mappingHint')}</p>
			<div class="mt-2 grid gap-2 sm:grid-cols-3">
				{#each FIELDS as f (f)}
					<label class="flex flex-col text-xs text-text"
						>{t(`integrationen.cards.field.${f}`)}
						<select
							class={field}
							value={pending.mapping[f] === undefined ? '' : String(pending.mapping[f])}
							onchange={(e) => setColumn(f, e.currentTarget.value)}
							data-testid={`card-map-${f}`}
						>
							<option value="">—</option>
							{#each pending.header as h, i (i)}
								<option value={String(i)}>{h || `#${i + 1}`}</option>
							{/each}
						</select>
					</label>
				{/each}
			</div>
			<label class="mt-2 flex items-center gap-2 text-sm text-text">
				<input
					type="checkbox"
					class="size-5"
					bind:checked={pending.invert}
					data-testid="card-invert"
				/>
				{t('integrationen.cards.invert')}
			</label>
			<ul class="mt-2 divide-y divide-border text-sm" data-testid="card-preview-lines">
				{#each preview.lines.slice(0, 8) as l, i (i)}
					<li class="flex flex-wrap justify-between gap-2 py-1" data-testid="card-preview-line">
						<span class="min-w-0 truncate"
							>{formatDate(String(l.date))} · {l.counterpartyName}{l.bookingType
								? ` · ${t('integrationen.cards.settlement')}`
								: ''}</span
						>
						<span class="font-mono tabular-nums"
							>{#if l.original}<span class="text-xs text-faint"
									>{`${l.original.amount} ${l.original.currency} → `}</span
								>{/if}{formatMoney(l.amountCents, 'EUR')}</span
						>
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-xs text-text" data-testid="card-preview-sum">
				{t('integrationen.cards.summary', {
					count: preview.lines.length,
					out: formatMoney(sums?.out ?? 0, 'EUR'),
					in: formatMoney(sums?.in ?? 0, 'EUR'),
					skipped: preview.skipped.length
				})}
			</p>
			<div class="mt-2 flex gap-2">
				<button
					type="button"
					class={btn.primary}
					onclick={importNow}
					disabled={busy || !preview.lines.length}
					data-testid="card-import">{t('integrationen.cards.import')}</button
				>
				<button type="button" class={btn.secondary} onclick={() => (pending = null)}
					>{t('integrationen.cards.cancel')}</button
				>
			</div>
		</div>
	{/if}

	{#if adding}
		<form
			class="mt-3 flex flex-wrap items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				void add();
			}}
			data-testid="card-form"
		>
			<label class="flex flex-col text-sm text-text"
				>{t('integrationen.cards.name')}
				<input class={field} bind:value={name} required data-testid="card-name" />
			</label>
			<label class="flex flex-col text-sm text-text"
				>{t('integrationen.cards.last4')}
				<input
					class="w-24 font-mono {field}"
					inputmode="numeric"
					maxlength="4"
					bind:value={last4}
					required
					data-testid="card-last4"
				/>
			</label>
			<button type="submit" class={btn.primary} disabled={busy} data-testid="card-save"
				>{t('integrationen.cards.save')}</button
			>
		</form>
	{:else}
		<button
			type="button"
			class="mt-3 {btn.secondary}"
			onclick={() => (adding = true)}
			data-testid="card-add">{t('integrationen.cards.add')}</button
		>
	{/if}
	{#if done}<p class="mt-2 text-sm text-heading" role="status" data-testid="card-result">
			{done}
		</p>{/if}
	{#if error}<p class="mt-2 text-sm text-danger" role="alert" data-testid="card-error">
			{error}
		</p>{/if}
	<p class="mt-3 text-xs text-faint">{t('integrationen.cards.adviser')}</p>
</section>
