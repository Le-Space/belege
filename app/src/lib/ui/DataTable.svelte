<script>
	// A table for lists that grow: a search field, columns that sort on a click
	// of their heading, filters to tick, and how many rows are shown. The
	// caller gives the rows, says what each column sorts by, and draws each
	// cell (a snippet), so a cell can hold an input or a button as well as
	// text. On a narrow screen a row becomes a small card with each value under
	// its column's name: no sideways scrolling.
	//
	// Sorting is by what `sort` returns for a row – for a cell with an input,
	// hand in the stored value, not the one being typed, or the rows jump while
	// the person types.
	import { t } from '$lib/i18n/index.js';

	/**
	 * @typedef {object} Column
	 * @property {string} key
	 * @property {string} label the heading
	 * @property {(row: any) => string | number | null | undefined} [sort] what the column sorts by; none: not sortable
	 * @property {string} [class] for the cells and the heading
	 */

	/**
	 * @type {{
	 *   rows: any[],
	 *   columns: Column[],
	 *   rowKey: (row: any) => string,
	 *   cell: import('svelte').Snippet<[any, Column]>,
	 *   search?: ((row: any) => string) | null,
	 *   filters?: { id: string, label: string, test: (row: any) => boolean }[],
	 *   sortBy?: string,
	 *   empty?: string,
	 *   label: string,
	 *   testid?: string,
	 *   rowTestid?: string
	 * }}
	 */
	let {
		rows,
		columns,
		rowKey,
		cell,
		search = null,
		filters = [],
		sortBy = '',
		empty = '',
		label,
		testid = 'table',
		rowTestid = 'table-row'
	} = $props();

	let query = $state('');
	/** @type {string[]} the filters ticked */
	let on = $state([]);
	// The first order only; from then on the person's.
	let sortKey = $state(sortBy);
	let descending = $state(false);

	/** Compared without case, and without the marks on letters. @param {unknown} v */
	const plain = (v) =>
		String(v ?? '')
			.normalize('NFD')
			.replace(/\p{M}/gu, '')
			.toLowerCase();

	const shown = $derived.by(() => {
		const words = plain(query).split(/\s+/).filter(Boolean);
		const active = filters.filter((f) => on.includes(f.id));
		let list = rows.filter((row) => active.every((f) => f.test(row)));
		if (search && words.length) {
			list = list.filter((row) => {
				const text = plain(search(row));
				return words.every((w) => text.includes(w));
			});
		}
		const column = columns.find((c) => c.key === sortKey);
		if (column?.sort) {
			const by = column.sort;
			const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
			list = [...list].sort((a, b) => {
				const [x, y] = [by(a), by(b)];
				// Rows without a value last, whichever way the column sorts.
				const [ex, ey] = [
					x === null || x === undefined || x === '',
					y === null || y === undefined || y === ''
				];
				if (ex !== ey) return ex ? 1 : -1;
				const order =
					typeof x === 'number' && typeof y === 'number' ? x - y : compare(String(x), String(y));
				return descending ? -order : order;
			});
		}
		return list;
	});

	/** @param {Column} column */
	function sortOn(column) {
		if (!column.sort) return;
		if (sortKey === column.key) descending = !descending;
		else {
			sortKey = column.key;
			descending = false;
		}
	}

	/** @param {string} id */
	function toggle(id) {
		on = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
	}
</script>

<div data-testid={testid}>
	{#if search || filters.length}
		<div class="flex flex-wrap items-center gap-2">
			{#if search}
				<input
					type="search"
					class="min-w-0 basis-full rounded-md border px-2 py-1.5 text-sm sm:max-w-xs sm:flex-1 sm:basis-auto"
					placeholder={t('table.search')}
					aria-label={t('table.searchIn', { what: label })}
					bind:value={query}
					data-testid="{testid}-search"
				/>
			{/if}
			{#each filters as f (f.id)}
				<label
					class="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-sm text-text"
				>
					<input
						type="checkbox"
						checked={on.includes(f.id)}
						onchange={() => toggle(f.id)}
						data-testid="{testid}-filter-{f.id}"
					/>
					{f.label}
				</label>
			{/each}
			{#if columns.some((c) => c.sort)}
				<!-- The headings are not shown on a narrow screen: the order is chosen here. -->
				<label class="flex items-center gap-1.5 text-xs text-faint sm:hidden">
					{t('table.sortBy')}
					<select
						class="rounded-md border px-1.5 py-1 text-sm text-text"
						value={sortKey}
						onchange={(e) => {
							sortKey = e.currentTarget.value;
							descending = false;
						}}
						data-testid="{testid}-sort"
					>
						<option value="">{t('table.sortNone')}</option>
						{#each columns.filter((c) => c.sort) as c (c.key)}
							<option value={c.key}>{c.label}</option>
						{/each}
					</select>
				</label>
			{/if}
			<span class="text-xs text-faint" role="status" data-testid="{testid}-count"
				>{shown.length === rows.length
					? t('table.count', { count: rows.length })
					: t('table.countOf', { shown: shown.length, count: rows.length })}</span
			>
		</div>
	{/if}

	<table class="data-table mt-2 w-full text-left text-sm" aria-label={label}>
		<thead>
			<tr class="border-b border-border text-xs text-faint">
				{#each columns as column (column.key)}
					<th
						scope="col"
						class="py-1.5 pr-3 font-medium {column.class ?? ''}"
						aria-sort={sortKey === column.key
							? descending
								? 'descending'
								: 'ascending'
							: undefined}
					>
						{#if column.sort}
							<button
								type="button"
								class="inline-flex items-center gap-1 hover:text-heading"
								onclick={() => sortOn(column)}
								data-testid="{testid}-sort-{column.key}"
							>
								{column.label}
								<span aria-hidden="true" class="w-2"
									>{sortKey === column.key ? (descending ? '↓' : '↑') : ''}</span
								>
							</button>
						{:else}
							{column.label}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody class="divide-y divide-border">
			{#each shown as row (rowKey(row))}
				<tr data-testid={rowTestid}>
					{#each columns as column (column.key)}
						<td class="py-1.5 pr-3 align-top {column.class ?? ''}" data-label={column.label}>
							{@render cell(row, column)}
						</td>
					{/each}
				</tr>
			{:else}
				<tr>
					<td class="py-2 text-faint" colspan={columns.length} data-testid="{testid}-empty"
						>{rows.length ? t('table.noMatch') : empty}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* Narrow: a row is a card, each value under its column's name. */
	@media (max-width: 639px) {
		.data-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.data-table tr {
			display: block;
			padding: 0.5rem 0;
		}
		.data-table td {
			display: block;
			padding: 0.125rem 0;
		}
		.data-table td[data-label]:not(:first-child)::before {
			content: attr(data-label);
			display: block;
			font-size: 0.75rem;
			color: var(--faint);
		}
		.data-table td:empty {
			display: none;
		}
	}
</style>
