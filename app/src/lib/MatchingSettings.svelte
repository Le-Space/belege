<script module>
	// The ledger accounts taken over from the chart since the app was opened:
	// kept beside the component, because the chart is read in on one page of
	// the settings and the accounts are looked at on another.
	/** @type {{ list: { id: string, number: string, name: string }[] }} */
	const takenFromChart = $state({ list: [] });
</script>

<script>
	import { taxKeyLabel } from './booking/tax-key-names.js';
	import { resolve } from '$app/paths';
	import { intlLocale } from '$lib/i18n/index.js';
	import { accountLabel } from './bank/format.js';
	// "Eigene Anweisungen": company names, own IBANs, rules. Stored sealed in
	// `settings` under `matching` (matching/classify.js), read by every
	// "Abgleich". And what the DATEV export needs: each bank account's ledger
	// account (on its `accounts` record) and the header values and BU keys
	// under `datev` (booking/settings.js).
	import { onMount } from 'svelte';
	import { app, currentStore, refreshNow, runMatchingNow } from './session.svelte.js';
	import { forgetBankFee } from './matching/actions.js';
	import { cleanChart, decodeChartBytes, parseChart } from './booking/chart.js';
	import { chartCandidates, takeLedgersFromChart } from './booking/ledger-match.js';
	import { recordEvent } from './activity/events.js';
	import { setSetting } from './store/settings.js';
	import {
		cleanMatchingSettings,
		DEFAULT_GRACE_DAYS,
		DEFAULT_PAYMENT_ACCOUNT,
		MAX_GRACE_DAYS
	} from './matching/classify.js';
	import { ulid } from './store/ids.js';
	import {
		accountsInOrder,
		cleanDatevSettings,
		LEGAL_FORMS,
		suggestedLedgerAccount
	} from './booking/settings.js';
	import { catalogueAccount, isAccountNumber } from './booking/skr03.js';
	import { aliasLabel } from './matching/partners.js';
	import { list, t } from './i18n/index.js';
	import DataTable from './ui/DataTable.svelte';
	import InfoHint from './InfoHint.svelte';

	let companyText = $state('');
	let ownNamesText = $state('');
	let employeesText = $state('');
	let ibanText = $state('');
	/** @type {import('./matching/classify.js').Rule[]} */
	let rules = $state([]);

	/** @type {'counterparty' | 'purpose' | 'any'} */
	let field = $state('counterparty');
	let contains = $state('');
	/** @type {'ignore' | 'private'} */
	let action = $state('ignore');
	let reason = $state('');
	/** @type {number | string} */
	let graceDays = $state(DEFAULT_GRACE_DAYS);
	/** The account of a deposit into a payment contract (classify.js), as typed. */
	let paymentAccount = $state(DEFAULT_PAYMENT_ACCOUNT);

	/** @type {Record<string, string>} bank account id → its ledger account, as typed */
	let ledgers = $state({});
	/** When output VAT counts (#195), as cleanDatevSettings keeps it. */
	const VAT_BASES = /** @type {const} */ (['ist', 'soll']);
	let datev = $state(cleanDatevSettings(null));
	/** @type {string | null} */
	let invalid = $state(null);
	const MONTHS = Array.from({ length: 12 }, (_, i) =>
		new Intl.DateTimeFormat(intlLocale(), { month: 'long', timeZone: 'UTC' }).format(
			new Date(Date.UTC(2026, i, 1))
		)
	);
	const TAX_KEYS = /** @type {const} */ ([
		'input19',
		'input7',
		'output19',
		'output7',
		'reverseCharge'
	]);

	let saving = $state(false);
	/** @type {string | null} */
	let saved = $state(null);

	onMount(() => {
		const current = cleanMatchingSettings(app.matchingSettings);
		companyText = current.companyNames.join('\n');
		ownNamesText = current.ownNames.join('\n');
		employeesText = current.employees.join('\n');
		ibanText = current.ownIbans.join('\n');
		rules = current.rules;
		graceDays = current.graceDays;
		paymentAccount = current.paymentAccountLedger;
		datev = cleanDatevSettings(app.datevSettings);
		ledgers = Object.fromEntries(app.accounts.map((a) => [a.id, String(a.ledgerAccount ?? '')]));
		// Accounts added since the chart was read in get their ledger account too.
		takeFromChart().catch(() => {});
	});

	// The ledger accounts just taken over from the chart.
	let fromChart = $derived(takenFromChart.list);
	/** How many this page's reading of the chart gave their ledger account. */
	let tookNow = $state(0);

	/**
	 * Every account without a ledger account gets the one the chart names for
	 * it, when that is unambiguous (booking/ledger-match.js): written to the
	 * books at once, shown in the fields, and noted in the Verlauf.
	 */
	async function takeFromChart() {
		const store = currentStore();
		const current = cleanChart(app.chart);
		if (!store || !current) return;
		const taken = await takeLedgersFromChart(store, current);
		if (!taken.length) return;
		for (const x of taken) ledgers[x.id] = x.number;
		takenFromChart.list = [...takenFromChart.list, ...taken];
		tookNow += taken.length;
		await recordEvent(store.events, 'decision', {
			action: 'ledger-from-chart',
			accounts: taken.map((x) => ({ accountId: x.id, ledgerAccount: x.number }))
		});
		await refreshNow();
	}

	let bankAccounts = $derived(accountsInOrder(app.accounts));

	// The accounts as the form has them now, so that a chart account picked for
	// one is no longer offered to another before it is saved.
	let accountsAsEdited = $derived(
		bankAccounts.map((a) => ({ ...a, ledgerAccount: (ledgers[a.id] ?? '').trim() }))
	);

	// What people's links taught (matching/partners.js); wrong ones can go.
	let learned = $derived(
		(app.partners ?? []).filter((p) => !p.deleted && (p.aliases ?? []).length)
	);

	/** @param {string} id */
	async function forget(id) {
		const store = currentStore();
		if (!store) return;
		await store.partners.softDelete(id);
		await refreshNow();
	}

	// Bank fees a person taught (classify.js feeKey: account id | purpose words).
	let learnedFees = $derived(
		cleanMatchingSettings(app.matchingSettings).feeKeys.map((key) => {
			const [accountId, words] = key.split('|');
			const a = app.accounts.find((x) => x.id === accountId);
			return { key, words, account: a ? `${accountLabel(a)}` : '—' };
		})
	);

	/** @param {string} key */
	async function forgetFee(key) {
		const store = currentStore();
		if (!store) return;
		await forgetBankFee(/** @type {any} */ (store), key);
		await refreshNow();
		await runMatchingNow();
	}

	// "Kontenplan einlesen" (booking/chart.js): a preview first, stored on "Übernehmen".
	/** @type {{ parsed: import('./booking/chart.js').ParsedChart, fileName: string } | null} */
	let chartPreview = $state(null);
	/** @type {string | null} */
	let chartError = $state(null);
	let chart = $derived(cleanChart(app.chart));

	// The example from the hint as a file, made here: nothing is fetched.
	function downloadChartExample() {
		const blob = new Blob([`${t('anweisungen.chart.formats.example')}\n`], {
			type: 'text/csv;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = t('anweisungen.chart.formats.exampleFile');
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	/** @param {Event} event */
	async function readChart(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0];
		input.value = '';
		chartError = null;
		chartPreview = null;
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			chartError = t('anweisungen.chart.tooLarge');
			return;
		}
		const parsed = parseChart(decodeChartBytes(new Uint8Array(await file.arrayBuffer())));
		if (!parsed.accounts.length) {
			chartError = t('anweisungen.chart.nothing');
			return;
		}
		chartPreview = { parsed, fileName: file.name };
	}

	async function takeChart() {
		const store = currentStore();
		if (!store || !chartPreview) return;
		await setSetting(store.settings, 'chart', {
			accounts: chartPreview.parsed.accounts,
			format: chartPreview.parsed.format,
			fileName: chartPreview.fileName,
			importedAt: new Date().toISOString()
		});
		chartPreview = null;
		await refreshNow();
		await takeFromChart();
	}

	async function dropChart() {
		const store = currentStore();
		if (!store) return;
		await setSetting(store.settings, 'chart', null);
		await refreshNow();
	}

	let bookAccounts = $derived(
		app.accounts.map((a) => `${accountLabel(a)}`).join(', ') || t('anweisungen.ownIbansNone')
	);

	/** @param {string} text */
	const lines = (text) =>
		text
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);

	function addRule() {
		if (contains.trim().length < 2) return;
		rules = [
			...rules,
			{ id: ulid(), field, contains: contains.trim(), action, reason: reason.trim() }
		];
		contains = '';
		reason = '';
	}

	/** @param {string} id */
	function removeRule(id) {
		rules = rules.filter((r) => r.id !== id);
	}

	/** @param {SubmitEvent} event */
	async function save(event) {
		event.preventDefault();
		const store = currentStore();
		if (!store) return;
		invalid = null;
		const wrong = bankAccounts.find(
			(a) => (ledgers[a.id] ?? '').trim() && !isAccountNumber(ledgers[a.id])
		);
		if (wrong) {
			invalid = t('anweisungen.books.invalidLedger', {
				name: `${accountLabel(wrong)}`
			});
			return;
		}
		if (String(paymentAccount).trim() && !/^\d{4,8}$/.test(String(paymentAccount).trim())) {
			invalid = t('anweisungen.books.invalidPaymentAccount');
			return;
		}
		saving = true;
		saved = null;
		try {
			for (const a of bankAccounts) {
				const next = (ledgers[a.id] ?? '').trim();
				if (next !== String(a.ledgerAccount ?? '')) {
					await store.accounts.put({ ...$state.snapshot(a), ledgerAccount: next || null });
				}
			}
			datev = cleanDatevSettings($state.snapshot(datev));
			await setSetting(store.settings, 'datev', datev);
			const value = cleanMatchingSettings({
				// Not edited here – links made by hand, learned fees, prepaid vendors,
				// "Beleg ist richtig" and whatever comes later – kept as they are.
				...cleanMatchingSettings(app.matchingSettings),
				companyNames: lines(companyText),
				ownNames: lines(ownNamesText),
				employees: lines(employeesText),
				ownIbans: lines(ibanText),
				rules: $state.snapshot(rules),
				graceDays: String(graceDays),
				paymentAccountLedger: String(paymentAccount).trim()
			});
			graceDays = value.graceDays;
			paymentAccount = value.paymentAccountLedger;
			await setSetting(store.settings, 'matching', value);
			saved = t('anweisungen.saved');
			await runMatchingNow();
		} finally {
			saving = false;
		}
	}

	/** @param {import('./matching/classify.js').Rule} r */
	const ruleText = (r) =>
		t('anweisungen.ruleText', {
			field: t(
				r.field === 'purpose'
					? 'anweisungen.fieldPurpose'
					: r.field === 'any'
						? 'anweisungen.fieldAny'
						: 'anweisungen.fieldCounterparty'
			),
			contains: r.contains,
			action: t(r.action === 'private' ? 'anweisungen.actionPrivate' : 'anweisungen.actionIgnore')
		}) + (r.reason ? ` (${r.reason})` : '');

	/**
	 * Which part to show: Einstellungen gives each its own page (#152 follow-up).
	 * All of them load and save together either way – a page shows a part of one
	 * form, so saving on one never drops what another holds.
	 *
	 * @type {{ section?: 'all' | 'firma' | 'abgleich' | 'gelerntes' | 'buchhaltung' | 'kontenplan' }}
	 */
	let { section = 'all' } = $props();
	/** @param {string} id */
	const show = (id) => section === 'all' || section === id;

	/** What kind of account one is, for the table of ledger accounts. @param {Record<string, any>} a */
	const accountKind = (a) =>
		t(
			`anweisungen.books.kind.${['exchange', 'wallet', 'card', 'outlay', 'travel'].includes(a.kind) ? a.kind : 'bank'}`
		);
	/** The SKR 03 placeholder counts the accounts in their own order, however the table is sorted. */
	let placeholderOf = $derived(
		new Map(bankAccounts.map((a, i) => [a.id, suggestedLedgerAccount(i)]))
	);
	let ledgerColumns = $derived([
		{
			key: 'account',
			label: t('anweisungen.books.col.account'),
			sort: (/** @type {any} */ a) => accountLabel(a)
		},
		{ key: 'kind', label: t('anweisungen.books.col.kind'), sort: accountKind },
		{
			key: 'ledger',
			label: t('anweisungen.books.ledger'),
			// By the number in the books, not the one being typed: rows stay put while typing.
			sort: (/** @type {any} */ a) => String(a.ledgerAccount ?? '')
		},
		// What the chart calls it: a column only when a chart was read in.
		...(chart
			? [
					{
						key: 'name',
						label: t('anweisungen.books.col.name'),
						sort: (/** @type {any} */ a) =>
							catalogueAccount(String(a.ledgerAccount ?? ''), chart)?.name ?? ''
					}
				]
			: [])
	]);
	let learnedColumns = $derived([
		{
			key: 'vendor',
			label: t('anweisungen.learnedCol.vendor'),
			sort: (/** @type {any} */ p) => String(p.name ?? '')
		},
		{ key: 'aliases', label: t('anweisungen.learnedCol.aliases') },
		{
			key: 'more',
			label: t('anweisungen.learnedCol.more'),
			sort: (/** @type {any} */ p) => String(p.account ?? '')
		},
		{ key: 'action', label: '', class: 'text-right' }
	]);
	/** @param {Record<string, any>} p */
	const aliasText = (p) =>
		(p.aliases ?? [])
			.map((/** @type {string} */ a) => t('language.quoted', { text: aliasLabel(a) }))
			.join(', ');

	const input = 'mt-1 rounded-md border px-2 py-1.5 text-sm';
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="anw-h"
	data-testid="matching-settings"
>
	<h2 id="anw-h" class={section === 'all' ? 'text-lg font-semibold' : 'sr-only'}>
		{t('anweisungen.title')}
	</h2>
	{#if section === 'all'}
		<p class="mt-1 text-sm text-text">{t('anweisungen.intro')}</p>
	{/if}
	<form class="{section === 'all' ? 'mt-3' : ''} flex flex-col gap-4" onsubmit={save}>
		{#if show('firma')}
			<label class="flex scroll-mt-4 flex-col text-sm" id="firma">
				<span class="font-medium text-heading">{t('anweisungen.companyNames')}</span>
				<textarea
					class="{input} min-h-16 font-sans"
					bind:value={companyText}
					placeholder="le space UG"
					data-testid="company-names"
				></textarea>
				<span class="mt-1 text-xs text-faint">{t('anweisungen.companyHint')}</span>
			</label>
			<label class="flex flex-col text-sm">
				<span class="font-medium text-heading">{t('anweisungen.ownNames')}</span>
				<textarea
					class="{input} min-h-16 font-sans"
					bind:value={ownNamesText}
					placeholder="Erika Mustermann"
					data-testid="own-names"
				></textarea>
				<span class="mt-1 text-xs text-faint">{t('anweisungen.ownNamesHint')}</span>
			</label>
			<label class="flex flex-col text-sm">
				<span class="font-medium text-heading">{t('anweisungen.employees')}</span>
				<textarea
					class="{input} min-h-16 font-sans"
					bind:value={employeesText}
					placeholder="Max Beispiel"
					data-testid="employees"
				></textarea>
				<span class="mt-1 text-xs text-faint">{t('anweisungen.employeesHint')}</span>
			</label>
			<label class="flex flex-col text-sm">
				<span class="font-medium text-heading">{t('anweisungen.ownIbans')}</span>
				<textarea
					class="{input} min-h-16 font-mono"
					bind:value={ibanText}
					placeholder="DE00 0000 0000 0000 0000 00"
					data-testid="own-ibans"
				></textarea>
				<span class="mt-1 text-xs text-faint"
					>{t('anweisungen.ownIbansHint', { list: bookAccounts })}</span
				>
			</label>

			<label class="flex flex-col text-sm">
				<span class="font-medium text-heading">{t('anweisungen.grace')}</span>
				<span class="mt-1 flex items-center gap-2">
					<input
						type="number"
						min="0"
						max={MAX_GRACE_DAYS}
						step="1"
						class="{input} mt-0 w-20 tabular-nums"
						bind:value={graceDays}
						data-testid="grace-days"
					/>
					<span class="text-text">{t('anweisungen.graceUnit')}</span>
				</span>
				<span class="mt-1 text-xs text-faint">{t('anweisungen.graceHint')}</span>
			</label>
		{/if}

		{#if show('abgleich')}
			<fieldset class="scroll-mt-4 text-sm" id="abgleich">
				<legend class="font-medium text-heading">{t('anweisungen.rules')}</legend>
				<ul class="mt-1 divide-y divide-border" data-testid="rules">
					{#each rules as r (r.id)}
						<li class="flex items-center gap-3 py-1.5" data-testid="rule">
							<span class="flex-1 text-text">{ruleText(r)}</span>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								onclick={() => removeRule(r.id)}
								data-testid="rule-remove">{t('anweisungen.remove')}</button
							>
						</li>
					{:else}
						<li class="py-1.5 text-faint">{t('anweisungen.noRules')}</li>
					{/each}
				</ul>
				<div class="mt-2 flex flex-wrap items-end gap-2">
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.field')}</span>
						<select class={input} bind:value={field} data-testid="rule-field">
							<option value="counterparty">{t('anweisungen.fieldCounterparty')}</option>
							<option value="purpose">{t('anweisungen.fieldPurpose')}</option>
							<option value="any">{t('anweisungen.fieldAny')}</option>
						</select>
					</label>
					<label class="flex min-w-32 flex-1 flex-col">
						<span class="text-faint">{t('anweisungen.contains')}</span>
						<input class={input} bind:value={contains} data-testid="rule-contains" />
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.action')}</span>
						<select class={input} bind:value={action} data-testid="rule-action">
							<option value="ignore">{t('anweisungen.actionIgnore')}</option>
							<option value="private">{t('anweisungen.actionPrivate')}</option>
						</select>
					</label>
					<label class="flex min-w-32 flex-1 flex-col">
						<span class="text-faint">{t('anweisungen.reason')}</span>
						<input
							class={input}
							bind:value={reason}
							placeholder={t('anweisungen.reasonPlaceholder')}
							data-testid="rule-reason"
						/>
					</label>
					<button
						type="button"
						class="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50"
						onclick={addRule}
						disabled={contains.trim().length < 2}
						data-testid="rule-add">{t('anweisungen.add')}</button
					>
				</div>
			</fieldset>
		{/if}

		{#if show('gelerntes')}
			<fieldset class="scroll-mt-4 text-sm" id="gelerntes">
				<legend class="font-medium text-heading">{t('anweisungen.learnedFees')}</legend>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.learnedFeesHint')}</p>
				<ul class="mt-1 divide-y divide-border" data-testid="learned-fees">
					{#each learnedFees as f (f.key)}
						<li class="flex items-center gap-3 py-1.5" data-testid="learned-fee">
							<span class="flex-1 text-text"
								><span class="font-medium text-heading">{f.account}</span> · {t('language.quoted', {
									text: f.words
								})}</span
							>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								onclick={() => forgetFee(f.key)}
								data-testid="learned-fee-forget">{t('anweisungen.forget')}</button
							>
						</li>
					{:else}
						<li class="py-1.5 text-faint">{t('anweisungen.noLearnedFees')}</li>
					{/each}
				</ul>
			</fieldset>

			<fieldset class="text-sm">
				<legend class="font-medium text-heading">{t('anweisungen.learned')}</legend>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.learnedHint')}</p>
				{#snippet learnedCell(/** @type {any} */ p, /** @type {{ key: string }} */ column)}
					{#if column.key === 'vendor'}
						<span class="font-medium text-heading">{p.name}</span>
					{:else if column.key === 'aliases'}
						<span class="text-text">{aliasText(p)}</span>
					{:else if column.key === 'more'}
						{#if p.account}
							<span class="text-faint" data-testid="learned-account"
								>{t('anweisungen.books.learnedAccount', {
									account: p.taxKey
										? `${p.account} / BU ${taxKeyLabel(p.taxKey, datev.taxKeys)}`
										: p.account
								})}</span
							>
						{/if}
						{#if (p.senderDomains ?? []).length}
							<span class="block text-faint"
								>{t('anweisungen.learnedMail', { domains: p.senderDomains.join(', ') })}</span
							>
						{/if}
					{:else}
						<button
							type="button"
							class="text-sm text-faint underline hover:text-heading"
							onclick={() => forget(p.id)}
							data-testid="learned-forget">{t('anweisungen.forget')}</button
						>
					{/if}
				{/snippet}
				<DataTable
					rows={learned}
					columns={learnedColumns}
					rowKey={(p) => p.id}
					cell={learnedCell}
					search={(p) =>
						`${p.name} ${aliasText(p)} ${p.account ?? ''} ${(p.senderDomains ?? []).join(' ')}`}
					sortBy="vendor"
					empty={t('anweisungen.noLearned')}
					label={t('anweisungen.learned')}
					testid="learned-partners"
					rowTestid="learned-partner"
				/>
			</fieldset>
		{/if}

		{#if show('buchhaltung')}
			<fieldset class="scroll-mt-4 text-sm" id="buchhaltung" data-testid="books-settings">
				<legend class="font-medium text-heading">{t('anweisungen.books.title')}</legend>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.hint')}</p>
				<p class="mt-1 text-xs text-faint">
					{chart
						? t('anweisungen.books.ledgerHintChart', { count: chart.accounts.length })
						: t('anweisungen.books.ledgerHintPlain')}
				</p>
				{#snippet ledgerCell(/** @type {any} */ a, /** @type {{ key: string }} */ column)}
					{#if column.key === 'account'}
						<span class="font-medium text-heading">{accountLabel(a)}</span>
					{:else if column.key === 'kind'}
						<span class="text-text">{accountKind(a)}</span>
					{:else if column.key === 'ledger'}
						<!-- With a chart read in, the person's own accounts are offered and
					     the SKR 03 placeholder is left out: it named other accounts. -->
						<input
							class="{input} mt-0 w-28 font-mono"
							inputmode="numeric"
							autocomplete="off"
							aria-label="{t('anweisungen.books.ledger')}: {accountLabel(a)}"
							list={chart ? 'ledger-chart' : undefined}
							bind:value={ledgers[a.id]}
							placeholder={chart ? '' : (placeholderOf.get(a.id) ?? '')}
							data-testid="ledger-account"
							data-account={a.ibanLast4}
						/>
					{:else}
						{#if chart && isAccountNumber(ledgers[a.id] ?? '')}
							{@const own = catalogueAccount(ledgers[a.id], chart)}
							<span
								class="block {own ? 'text-text' : 'text-danger'}"
								data-testid="ledger-account-name">{own ? own.name : t('booking.notInChart')}</span
							>
						{/if}
						{#if fromChart.some((x) => x.id === a.id && x.number === ledgers[a.id])}
							<span class="block text-xs text-heading" data-testid="ledger-from-chart"
								>{t('anweisungen.books.fromChart')}</span
							>
						{/if}
						{#if chart && !(ledgers[a.id] ?? '').trim()}
							{@const offered = chartCandidates(a, accountsAsEdited, chart)}
							{#if offered.length}
								<span class="flex flex-wrap items-center gap-1.5 text-xs text-text">
									{t('anweisungen.books.candidates')}
									{#each offered as c (c.number)}
										<button
											type="button"
											class="rounded-md border border-border px-2 py-0.5 hover:bg-surface-2 hover:text-heading"
											onclick={() => (ledgers[a.id] = c.number)}
											data-testid="ledger-candidate"
											data-number={c.number}>{c.number} {c.name}</button
										>
									{/each}
								</span>
							{/if}
						{/if}
					{/if}
				{/snippet}
				<DataTable
					rows={bankAccounts}
					columns={ledgerColumns}
					rowKey={(a) => a.id}
					cell={ledgerCell}
					search={(a) => `${accountLabel(a)} ${accountKind(a)} ${ledgers[a.id] ?? ''}`}
					filters={[
						{
							id: 'missing',
							label: t('anweisungen.books.filterMissing'),
							test: (a) => !(ledgers[a.id] ?? '').trim()
						}
					]}
					empty={t('anweisungen.books.noAccounts')}
					label={t('anweisungen.books.ledger')}
					testid="ledger-accounts"
					rowTestid="ledger-row"
				/>
				{#if chart}
					<datalist id="ledger-chart">
						{#each chart.accounts as c (c.number)}
							<option value={c.number}>{c.number} {c.name}</option>
						{/each}
					</datalist>
				{/if}
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.consultant')}</span>
						<input
							class="{input} w-28 font-mono"
							inputmode="numeric"
							bind:value={datev.consultantNumber}
							data-testid="datev-consultant"
						/>
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.client')}</span>
						<input
							class="{input} w-24 font-mono"
							inputmode="numeric"
							bind:value={datev.clientNumber}
							data-testid="datev-client"
						/>
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.fiscalStart')}</span>
						<select
							class={input}
							bind:value={datev.fiscalYearStartMonth}
							data-testid="datev-fiscal-start"
						>
							{#each MONTHS as name, i (i)}
								<option value={i + 1}>{name}</option>
							{/each}
						</select>
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.accountLength')}</span>
						<select
							class={input}
							bind:value={datev.accountLength}
							data-testid="datev-account-length"
						>
							{#each [4, 5, 6, 7, 8] as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.legalForm')}</span>
						<select class={input} bind:value={datev.legalForm} data-testid="datev-legal-form">
							<option value="">{t('anweisungen.books.legalFormUnset')}</option>
							{#each LEGAL_FORMS as f (f)}
								<option value={f}>{t(`anweisungen.books.legalForms.${f}`)}</option>
							{/each}
						</select>
					</label>
					{#if datev.legalForm === 'corporation'}
						<label class="flex flex-col">
							<span class="text-faint">{t('anweisungen.books.shareholderAccount')}</span>
							<input
								class="{input} w-28 font-mono"
								inputmode="numeric"
								bind:value={datev.shareholderAccount}
								data-testid="datev-shareholder-account"
							/>
						</label>
					{/if}
				</div>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.legalFormHint')}</p>
				<label class="mt-3 flex flex-col">
					<span class="text-faint">{t('anweisungen.books.suspenseAccount')}</span>
					<input
						class="{input} w-28 font-mono"
						inputmode="numeric"
						bind:value={datev.suspenseAccount}
						data-testid="datev-suspense-account"
					/>
				</label>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.suspenseHint')}</p>
				<label class="mt-3 flex flex-col">
					<span class="text-faint">{t('anweisungen.books.paymentAccount')}</span>
					<input
						class="{input} w-28 font-mono"
						inputmode="numeric"
						bind:value={paymentAccount}
						placeholder={DEFAULT_PAYMENT_ACCOUNT}
						data-testid="payment-contract-account"
					/>
				</label>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.paymentAccountHint')}</p>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.vatPeriod')}</span>
						<select class={input} bind:value={datev.vatPeriod} data-testid="datev-vat-period">
							<option value="quarter">{t('anweisungen.books.vatPeriods.quarter')}</option>
							<option value="month">{t('anweisungen.books.vatPeriods.month')}</option>
						</select>
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.ownVatId')}</span>
						<input
							class="{input} w-40 font-mono"
							autocomplete="off"
							bind:value={datev.ownVatId}
							placeholder="DE…"
							data-testid="datev-own-vat-id"
						/>
					</label>
					<label class="flex flex-col">
						<span class="text-faint">{t('anweisungen.books.vatBasis')}</span>
						<select class={input} bind:value={datev.vatBasis} data-testid="datev-vat-basis">
							{#each VAT_BASES as basis (basis)}
								<option value={basis}>{t(`anweisungen.books.vatBases.${basis}`)}</option>
							{/each}
						</select>
					</label>
					<label class="flex min-h-11 items-center gap-2">
						<input
							type="checkbox"
							bind:checked={datev.smallBusiness}
							data-testid="datev-small-business"
						/>
						<span>{t('anweisungen.books.smallBusiness')}</span>
					</label>
				</div>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.vatHint')}</p>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.numbersHint')}</p>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.accountLengthHint')}</p>
				<p class="mt-3 text-text">{t('anweisungen.books.taxKeys')}</p>
				<div class="mt-1 flex flex-wrap items-end gap-3">
					{#each TAX_KEYS as k (k)}
						<label class="flex flex-col">
							<span class="text-faint"
								>{t(`anweisungen.books.${k}`)}{k === 'reverseCharge'
									? ` (${t('anweisungen.books.reverseChargeHint')})`
									: ''}</span
							>
							<input
								class="{input} w-20 font-mono"
								inputmode="numeric"
								bind:value={datev.taxKeys[k]}
								data-testid="datev-key-{k}"
							/>
						</label>
					{/each}
				</div>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.books.taxKeysHint')}</p>
			</fieldset>
		{/if}

		{#if show('kontenplan')}
			<fieldset class="scroll-mt-4 text-sm" id="kontenplan" data-testid="chart">
				<legend class="flex items-center gap-1.5 font-medium text-heading">
					{t('anweisungen.chart.title')}
					<InfoHint
						label={t('anweisungen.chart.formats.label')}
						testid="chart-formats"
						idPrefix="chart-formats"
						interactive
						width="w-80"
					>
						<span class="block font-semibold text-heading"
							>{t('anweisungen.chart.formats.title')}</span
						>
						<ul class="mt-1 flex list-disc flex-col gap-1 pl-4">
							{#each list('anweisungen.chart.formats.items') as line (line)}
								<li>{line}</li>
							{/each}
						</ul>
						<span class="mt-2 block text-faint">{t('anweisungen.chart.formats.exampleTitle')}</span>
						<pre
							class="mt-0.5 overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-[11px] leading-snug"
							data-testid="chart-formats-example">{t('anweisungen.chart.formats.example')}</pre>
						<button
							type="button"
							class="mt-1.5 text-faint underline hover:text-heading"
							onclick={downloadChartExample}
							data-testid="chart-formats-download">{t('anweisungen.chart.formats.download')}</button
						>
						<span class="mt-1.5 block text-faint">{t('anweisungen.chart.formats.check')}</span>
						<span class="mt-1.5 block text-faint">{t('anweisungen.chart.infoTitle')}</span>
					</InfoHint>
				</legend>
				<p class="mt-1 text-xs text-faint">{t('anweisungen.chart.hint')}</p>
				<details class="mt-1 text-xs text-text" data-testid="chart-how">
					<summary class="cursor-pointer text-faint underline"
						>{t('anweisungen.chart.howTitle')}</summary
					>
					<ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
						{#each list('anweisungen.chart.how') as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				</details>
				{#if chart}
					<p class="mt-2 text-text" data-testid="chart-current">
						{t('anweisungen.chart.current', {
							count: chart.accounts.length,
							file: chart.fileName || '—',
							date: chart.importedAt
								? chart.importedAt.slice(0, 10).split('-').reverse().join('.')
								: '?'
						})}
						<button
							type="button"
							class="ml-2 text-sm text-faint underline hover:text-heading"
							onclick={dropChart}
							data-testid="chart-drop">{t('anweisungen.chart.drop')}</button
						>
					</p>
				{/if}
				<label
					class="mt-2 inline-block cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading"
				>
					{chart ? t('anweisungen.chart.replace') : t('anweisungen.chart.read')}
					<input
						type="file"
						accept=".csv,.txt,text/csv,text/plain"
						class="sr-only"
						onchange={readChart}
						data-testid="chart-file"
					/>
				</label>
				{#if chartError}
					<p class="mt-1 text-sm text-danger" role="alert" data-testid="chart-error">
						{chartError}
					</p>
				{/if}
				{#if chartPreview}
					<div
						class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2"
						data-testid="chart-preview"
					>
						<p class="text-text">
							{t('anweisungen.chart.found', {
								count: chartPreview.parsed.accounts.length,
								format: t(`anweisungen.chart.format.${chartPreview.parsed.format}`),
								skipped: chartPreview.parsed.skipped
							})}
						</p>
						<ul class="mt-1 font-mono text-xs text-faint">
							{#each chartPreview.parsed.accounts.slice(0, 5) as a (a.number)}
								<li>{a.number} {a.name}</li>
							{/each}
						</ul>
						<div class="mt-2 flex gap-3">
							<button
								type="button"
								class="rounded-md bg-coral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-coral-800"
								onclick={takeChart}
								data-testid="chart-take">{t('anweisungen.chart.take')}</button
							>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								onclick={() => (chartPreview = null)}
								data-testid="chart-cancel">{t('anweisungen.chart.cancel')}</button
							>
						</div>
					</div>
				{/if}
				{#if tookNow && section === 'kontenplan'}
					<p class="mt-2 text-text" role="status" data-testid="chart-took-ledgers">
						{t('anweisungen.chart.tookLedgers', { count: tookNow })}
						<a
							class="underline hover:text-heading"
							href={resolve('/einstellungen/buchhaltung')}
							data-testid="chart-to-ledgers">{t('anweisungen.chart.toLedgers')}</a
						>
					</p>
				{/if}
			</fieldset>
		{/if}

		{#if section === 'all' || section === 'firma' || section === 'abgleich' || section === 'buchhaltung'}
			<div class="flex flex-wrap items-center gap-3">
				<button
					type="submit"
					class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={saving}
					data-testid="matching-save">{t('anweisungen.save')}</button
				>
				{#if invalid}
					<p class="text-sm text-danger" role="alert" data-testid="matching-invalid">{invalid}</p>
				{/if}
				{#if saved}
					<p class="text-sm text-heading" role="status" data-testid="matching-saved">{saved}</p>
				{/if}
			</div>
		{/if}
	</form>
</section>
