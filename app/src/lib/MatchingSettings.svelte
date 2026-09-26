<script>
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
	import { setSetting } from './store/settings.js';
	import {
		cleanMatchingSettings,
		DEFAULT_GRACE_DAYS,
		MAX_GRACE_DAYS
	} from './matching/classify.js';
	import { ulid } from './store/ids.js';
	import {
		accountsInOrder,
		cleanDatevSettings,
		suggestedLedgerAccount
	} from './booking/settings.js';
	import { isAccountNumber } from './booking/skr03.js';
	import { aliasLabel } from './matching/partners.js';
	import { list, t } from './i18n/index.js';

	let companyText = $state('');
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

	/** @type {Record<string, string>} bank account id → its ledger account, as typed */
	let ledgers = $state({});
	let datev = $state(cleanDatevSettings(null));
	/** @type {string | null} */
	let invalid = $state(null);
	const MONTHS = Array.from({ length: 12 }, (_, i) =>
		new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' }).format(
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
		ibanText = current.ownIbans.join('\n');
		rules = current.rules;
		graceDays = current.graceDays;
		datev = cleanDatevSettings(app.datevSettings);
		ledgers = Object.fromEntries(app.accounts.map((a) => [a.id, String(a.ledgerAccount ?? '')]));
	});

	let bankAccounts = $derived(accountsInOrder(app.accounts));

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
				companyNames: lines(companyText),
				ownIbans: lines(ibanText),
				rules: $state.snapshot(rules),
				graceDays: String(graceDays),
				// Not edited here: kept as they are.
				feeKeys: cleanMatchingSettings(app.matchingSettings).feeKeys,
				notTransfers: cleanMatchingSettings(app.matchingSettings).notTransfers
			});
			graceDays = value.graceDays;
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

	const input = 'mt-1 rounded-md border px-2 py-1.5 text-sm';
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="anw-h"
	data-testid="matching-settings"
>
	<h2 id="anw-h" class="text-lg font-semibold">{t('anweisungen.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('anweisungen.intro')}</p>
	<form class="mt-3 flex flex-col gap-4" onsubmit={save}>
		<label class="flex flex-col text-sm">
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

		<fieldset class="text-sm">
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

		<fieldset class="text-sm">
			<legend class="font-medium text-heading">{t('anweisungen.learnedFees')}</legend>
			<p class="mt-1 text-xs text-faint">{t('anweisungen.learnedFeesHint')}</p>
			<ul class="mt-1 divide-y divide-border" data-testid="learned-fees">
				{#each learnedFees as f (f.key)}
					<li class="flex items-center gap-3 py-1.5" data-testid="learned-fee">
						<span class="flex-1 text-text"
							><span class="font-medium text-heading">{f.account}</span> · „{f.words}“</span
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
			<ul class="mt-1 divide-y divide-border" data-testid="learned-partners">
				{#each learned as p (p.id)}
					<li class="flex items-center gap-3 py-1.5" data-testid="learned-partner">
						<span class="flex-1 text-text">
							<span class="font-medium text-heading">{p.name}</span>
							← {(p.aliases ?? [])
								.map((/** @type {string} */ a) => `„${aliasLabel(a)}“`)
								.join(', ')}
							{#if p.account}
								<span class="text-faint" data-testid="learned-account"
									>· {t('anweisungen.books.learnedAccount', {
										account: p.taxKey ? `${p.account} / BU ${p.taxKey}` : p.account
									})}</span
								>
							{/if}
							{#if (p.senderDomains ?? []).length}
								<span class="text-faint"
									>· {t('anweisungen.learnedMail', { domains: p.senderDomains.join(', ') })}</span
								>
							{/if}
						</span>
						<button
							type="button"
							class="text-sm text-faint underline hover:text-heading"
							onclick={() => forget(p.id)}
							data-testid="learned-forget">{t('anweisungen.forget')}</button
						>
					</li>
				{:else}
					<li class="py-1.5 text-faint">{t('anweisungen.noLearned')}</li>
				{/each}
			</ul>
		</fieldset>

		<fieldset class="text-sm" data-testid="books-settings">
			<legend class="font-medium text-heading">{t('anweisungen.books.title')}</legend>
			<p class="mt-1 text-xs text-faint">{t('anweisungen.books.hint')}</p>
			<ul class="mt-2 flex flex-col gap-2">
				{#each bankAccounts as a, i (a.id)}
					<li>
						<label class="flex flex-col">
							<span class="text-text"
								>{t('anweisungen.books.ledger')}:
								<span class="font-medium text-heading">{accountLabel(a)}</span></span
							>
							<input
								class="{input} w-32 font-mono"
								inputmode="numeric"
								bind:value={ledgers[a.id]}
								placeholder={suggestedLedgerAccount(i)}
								data-testid="ledger-account"
								data-account={a.ibanLast4}
							/>
							<span class="mt-1 text-xs text-faint"
								>{t('anweisungen.books.ledgerHint', {
									suggestion: suggestedLedgerAccount(i)
								})}</span
							>
						</label>
					</li>
				{:else}
					<li class="text-faint">{t('anweisungen.books.noAccounts')}</li>
				{/each}
			</ul>
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
					<select class={input} bind:value={datev.accountLength} data-testid="datev-account-length">
						{#each [4, 5, 6, 7, 8] as n (n)}
							<option value={n}>{n}</option>
						{/each}
					</select>
				</label>
			</div>
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

		<fieldset class="text-sm" data-testid="chart">
			<legend class="flex items-center gap-1.5 font-medium text-heading">
				{t('anweisungen.chart.title')}
				<span
					class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] leading-none text-faint"
					title={t('anweisungen.chart.infoTitle')}
					aria-hidden="true">i</span
				>
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
				<p class="mt-1 text-sm text-danger" role="alert" data-testid="chart-error">{chartError}</p>
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
		</fieldset>

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
	</form>
</section>
