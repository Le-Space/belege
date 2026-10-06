<script>
	// "Export": one month as a DATEV Buchungsstapel plus the receipts, in a
	// ZIP made here in the browser (export/build.js, loaded on the click with
	// fflate) and downloaded. Before that, the check list (export/plan.js):
	// without a confirmed account for every booking and a ledger account for
	// every bank account there is no export.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { onMount } from 'svelte';
	import { exportChoice, monthParam } from '$lib/export/month-choice.svelte.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import {
		app,
		currentBlobs,
		currentStore,
		refreshNow,
		runMatchingNow
	} from '$lib/session.svelte.js';
	import { planMonth } from '$lib/export/plan.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { confirmBookings } from '$lib/booking/actions.js';
	import { suggestBooking } from '$lib/booking/suggest.js';
	import { accountLabel, formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptVendor } from '$lib/receipts/view.js';
	import { intlLocale, list, t } from '$lib/i18n/index.js';
	import { releaseName } from '$lib/build-info.js';

	const monthFormat = $derived(
		new Intl.DateTimeFormat(intlLocale(), {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);
	const monthName = $derived(
		new Intl.DateTimeFormat(intlLocale(), { month: 'long', timeZone: 'UTC' })
	);

	let months = $derived(
		[
			...new Set(
				app.transactions
					.filter((tx) => !tx.deleted)
					.map((tx) => String(tx.bookedOn ?? '').slice(0, 7))
					.filter((m) => /^\d{4}-\d{2}$/.test(m))
			)
		].sort((a, b) => (a < b ? 1 : -1))
	);
	/** @type {string | null} */
	let chosen = $state(null);
	let month = $derived(chosen && months.includes(chosen) ? chosen : (months[0] ?? null));

	// The month kept (#314): from the address first, else the one chosen last
	// in this session; written back to both on every choice.
	onMount(() => {
		const wanted = monthParam(page.url.searchParams.get('month')) ?? exportChoice.month;
		if (wanted) choose(wanted);
	});

	/** @param {string} m */
	function choose(m) {
		chosen = m;
		exportChoice.month = m;
		const url = new URL(page.url);
		if (url.searchParams.get('month') === m) return;
		url.searchParams.set('month', m);
		replaceState(url, page.state);
	}

	let settings = $derived(cleanDatevSettings(app.datevSettings));
	/** Test bookings into the package too (sample/test-bookings.js) – off unless asked for. */
	let includeTests = $state(false);
	/**
	 * The accounts' monthly statements into the package – on unless switched
	 * off; this browser remembers the choice.
	 */
	const STATEMENTS_KEY = 'belege.export.statements';
	/**
	 * Network fees an Akash usage statement covers as one booking (#305) – on
	 * unless switched off; this browser remembers the choice.
	 */
	const COLLECT_KEY = 'belege.export.collectFees';
	let collectFees = $state(
		(() => {
			try {
				return localStorage.getItem(COLLECT_KEY) !== 'off';
			} catch {
				return true;
			}
		})()
	);
	$effect(() => {
		try {
			localStorage.setItem(COLLECT_KEY, collectFees ? 'on' : 'off');
		} catch {
			// Not remembered: on again next time.
		}
	});
	// Only a month with an Akash usage statement has fees to collect.
	let hasFeeStatement = $derived(
		Boolean(month) &&
			app.receipts.some(
				(r) =>
					!r.deleted &&
					r.selfReceipt?.kind === 'akash-statement' &&
					String(r.documentDate ?? '').startsWith(String(month))
			)
	);
	let withStatements = $state(
		(() => {
			try {
				return localStorage.getItem(STATEMENTS_KEY) !== 'off';
			} catch {
				return true;
			}
		})()
	);
	$effect(() => {
		try {
			localStorage.setItem(STATEMENTS_KEY, withStatements ? 'on' : 'off');
		} catch {
			// Not remembered: on again next time.
		}
	});
	let plan = $derived(
		month
			? planMonth({
					month,
					transactions: app.transactions,
					accounts: app.accounts,
					receipts: app.receipts,
					matches: app.matches,
					classifications: app.classifications,
					includeTests,
					withStatements,
					collectFees
				})
			: null
	);
	// Statements whose bookings do not lead to their closing balance (#287).
	let unreconciled = $derived(
		(plan?.statements ?? []).filter((s) => s.balances?.check?.status === 'open').map((s) => s.label)
	);
	// Unconfirmed bookings whose suggestion is automatic (transfer, fee).
	let automatic = $derived(
		(plan?.checks.unassigned ?? []).flatMap((tx) => {
			const s = suggestBooking(tx, { classification: app.classifications[tx.id] ?? null });
			return s.account && (s.source === 'transfer' || s.source === 'fee')
				? [{ transactionId: tx.id, account: s.account, taxKey: s.taxKey }]
				: [];
		})
	);

	let busy = $state(false);
	/** @type {string | null} */
	let done = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	$effect(() => {
		void month;
		done = null;
		error = null;
	});

	/** @param {unknown} e */
	const failed = (e) => t('export.failed', { error: e instanceof Error ? e.message : String(e) });

	async function confirmAutomatic() {
		const store = currentStore();
		if (!store || !automatic.length) return;
		busy = true;
		error = null;
		try {
			await confirmBookings(/** @type {any} */ (store), $state.snapshot(automatic));
			await refreshNow();
		} catch (e) {
			error = failed(e);
		} finally {
			busy = false;
		}
	}

	async function download() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !plan || plan.blocked) return;
		busy = true;
		done = null;
		error = null;
		try {
			const { runMonthExport } = await import('$lib/export/build.js');
			const counts = {
				bookings: plan.lines.length,
				receipts: plan.receipts.length,
				statements: plan.statements.length
			};
			const { zip, fileName } = await runMonthExport({
				store,
				blobs,
				plan,
				settings,
				accounts: app.accounts,
				classifications: app.classifications
			});
			save(new Blob([/** @type {BlobPart} */ (zip)], { type: 'application/zip' }), fileName);
			done = t('export.done', { file: fileName, ...counts });
			await refreshNow();
		} catch (e) {
			error = failed(e);
		} finally {
			busy = false;
		}
	}

	/** Only a download: a Blob and a click, nothing sent anywhere. @param {Blob} blob @param {string} fileName */
	function save(blob, fileName) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	let cryptoAccountIds = $derived(
		new Set(
			app.accounts.filter((a) => a.kind === 'wallet' || a.kind === 'exchange').map((a) => a.id)
		)
	);
	let cryptoYears = $derived(
		[
			...new Set(
				app.transactions
					.filter((tx) => !tx.deleted && cryptoAccountIds.has(tx.accountId))
					.map((tx) => String(tx.bookedOn ?? '').slice(0, 4))
					.filter((y) => /^\d{4}$/.test(y))
			)
		].sort((a, b) => (a < b ? 1 : -1))
	);
	/** '' for all years. */
	let cryptoYear = $state('');
	/** @type {string | null} */
	let cryptoDone = $state(null);
	/** @type {string | null} */
	let cryptoError = $state(null);

	/** @param {'json' | 'csv'} kind */
	async function downloadCrypto(kind) {
		const store = currentStore();
		if (!store) return;
		cryptoDone = null;
		cryptoError = null;
		try {
			const [{ cryptoLedger, cryptoLedgerCsv }, { loadWallets }] = await Promise.all([
				import('$lib/export/crypto-ledger.js'),
				import('$lib/wallets/wallet-sync.js')
			]);
			const release = releaseName();
			const ledger = cryptoLedger({
				accounts: $state.snapshot(app.accounts),
				transactions: $state.snapshot(app.transactions),
				wallets: await loadWallets(store.settings),
				year: cryptoYear || null,
				...(release ? { generator: `Belege ${release}` } : {})
			});
			const fileName = `crypto-ledger-${cryptoYear || 'all'}-${ledger.createdAt.slice(0, 10)}.${kind}`;
			save(
				kind === 'json'
					? new Blob([`${JSON.stringify(ledger, null, '\t')}\n`], { type: 'application/json' })
					: new Blob([cryptoLedgerCsv(ledger)], { type: 'text/csv;charset=utf-8' }),
				fileName
			);
			cryptoDone = t('export.crypto.done', {
				file: fileName,
				movements: ledger.movements.length,
				accounts: ledger.accounts.length
			});
		} catch (e) {
			cryptoError = failed(e);
		}
	}

	let importing = $state(false);
	/** @type {string[]} */
	let imported = $state([]);

	/** A crypto-ledger file into the books. @param {File | undefined} file */
	async function importCrypto(file) {
		const store = currentStore();
		if (!store || !file) return;
		importing = true;
		imported = [];
		cryptoDone = null;
		cryptoError = null;
		try {
			const { importCryptoLedger } = await import('$lib/export/crypto-ledger-import.js');
			const r = await importCryptoLedger({ store, text: await file.text() });
			imported = [
				t('export.crypto.imported', {
					new: r.new,
					updated: r.updated,
					skipped: r.skipped,
					accounts: r.accounts.length
				}),
				...(r.unpriced ? [t('export.crypto.unpriced', { count: r.unpriced })] : []),
				...(r.left.length
					? [
							t('export.crypto.left', {
								list: r.left
									.map((l) =>
										t('export.crypto.leftItem', { account: l.account, count: l.movements })
									)
									.join(', ')
							})
						]
					: [])
			];
			await refreshNow();
			if (r.new || r.updated) await runMatchingNow();
		} catch (e) {
			cryptoError = failed(e);
		} finally {
			importing = false;
		}
	}

	/** @param {string} id */
	const txLink = (id) => `${resolve('/zahlungen')}?tx=${encodeURIComponent(id)}`;
	/** @param {string} id */
	const receiptLink = (id) => `${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;
	/** @param {Record<string, any>} tx */
	const txText = (tx) =>
		`${formatDate(tx.bookedOn)} · ${tx.counterparty || '—'} · ${formatMoney(tx.amountCents ?? 0, tx.currency)}`;
	/** @param {Record<string, any>} r */
	const receiptText = (r) =>
		[
			receiptVendor(/** @type {any} */ (r)),
			typeof r.amountCents === 'number' ? formatMoney(r.amountCents, r.currency) : ''
		]
			.filter(Boolean)
			.join(' · ');

	const SHOWN = 5;
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
</script>

{#snippet item(
	/** @type {string} */ kind,
	/** @type {'ok' | 'blocker' | 'warning'} */ state,
	/** @type {string} */ text,
	/** @type {{ id: string, text: string, href: string | null }[]} */ entries
)}
	<li data-testid="export-check" data-check={kind} data-state={state}>
		<p
			class={state === 'ok'
				? 'text-success'
				: state === 'blocker'
					? 'font-medium text-danger'
					: 'text-heading'}
			data-testid="export-check-text"
		>
			{state === 'ok' ? '✓' : state === 'blocker' ? '✗' : '⚠'}
			{text}
		</p>
		{#if entries.length}
			<ul class="mt-1 ml-5 flex flex-col gap-0.5 text-xs text-text">
				{#each entries.slice(0, SHOWN) as e (e.id)}
					<li>
						{e.text}
						{#if e.href}
							· <a class="underline" href={e.href} data-testid="export-check-open"
								>{t('export.open')}</a
							>
						{/if}
					</li>
				{/each}
				{#if entries.length > SHOWN}
					<li class="text-faint">{t('export.check.more', { count: entries.length - SHOWN })}</li>
				{/if}
			</ul>
		{/if}
	</li>
{/snippet}

<h1 class="text-2xl font-bold text-heading">{t('export.title')}</h1>
<p class="mt-2 text-text">{t('export.intro')}</p>

{#if !month || !plan}
	<p
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 text-text shadow-sm"
		data-testid="export-empty"
	>
		{t('export.empty')}
		<a class="underline" href={resolve('/integrationen/bank')} data-testid="export-empty-link"
			>{t('export.emptyLink')}</a
		>
	</p>
{:else}
	<section
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		data-testid="export-month"
	>
		<label class="flex flex-wrap items-center gap-2 text-sm">
			<span class="font-medium text-heading">{t('export.month')}</span>
			<select
				class="rounded-md border px-2 py-1.5 text-sm"
				value={month}
				onchange={(e) => choose(/** @type {HTMLSelectElement} */ (e.currentTarget).value)}
				data-testid="export-month-select"
			>
				{#each months as m (m)}
					<option value={m}>{monthFormat.format(new Date(`${m}-01T00:00:00Z`))}</option>
				{/each}
			</select>
		</label>
		<p class="mt-2 text-sm text-text" data-testid="export-summary">
			{t('export.summary', {
				bookings: plan.bookings.length,
				lines: plan.lines.length,
				receipts: plan.receipts.length,
				statements: plan.statements.length
			})}
		</p>
		<label class="mt-2 flex items-start gap-2 text-sm text-text">
			<input
				type="checkbox"
				class="mt-0.5"
				bind:checked={withStatements}
				data-testid="export-with-statements"
			/>
			<span>
				{t('export.withStatements')}
				{#if !withStatements}
					<span class="block text-xs text-faint" data-testid="export-without-statements-hint"
						>{t('export.withoutStatementsHint')}</span
					>
				{/if}
			</span>
		</label>
		{#if withStatements && unreconciled.length}
			<p class="mt-2 text-sm text-warning" role="status" data-testid="export-unreconciled">
				{t('export.unreconciled', { accounts: unreconciled.join(', ') })}
			</p>
		{/if}
		{#if hasFeeStatement}
			<label class="mt-2 flex items-start gap-2 text-sm text-text">
				<input
					type="checkbox"
					class="mt-0.5"
					bind:checked={collectFees}
					data-testid="export-collect-fees"
				/>
				<span>{t('export.collectFees')}</span>
			</label>
		{/if}
		<p class="mt-1 text-xs text-faint" data-testid="export-settings">
			{t('export.settings', {
				consultant: settings.consultantNumber,
				client: settings.clientNumber,
				fiscal: monthName.format(new Date(Date.UTC(2026, settings.fiscalYearStartMonth - 1, 1))),
				length: settings.accountLength
			})} ·
			<a class="underline" href={resolve('/einstellungen')}>{t('export.settingsLink')}</a>
		</p>
	</section>

	<section
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		data-testid="export-checks"
	>
		<h2 class="text-lg font-semibold text-heading">{t('export.checks')}</h2>
		<ul class="mt-2 flex flex-col gap-3 text-sm">
			{#if plan.tests}
				<li data-testid="export-tests">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={includeTests} data-testid="export-include-tests" />
						{t('export.check.tests', { count: plan.tests })}
					</label>
				</li>
			{/if}
			{#if plan.sample !== 'none'}
				{@render item(
					'sample',
					plan.sample === 'mixed' ? 'blocker' : 'warning',
					plan.sample === 'mixed' ? t('export.check.sampleMixed') : t('export.check.sampleAll'),
					[]
				)}
			{/if}
			{#if plan.checks.unpriced.length}
				{@render item(
					'unpriced',
					'blocker',
					t('export.check.unpriced', { count: plan.checks.unpriced.length }),
					plan.checks.unpriced.map((tx) => ({ id: tx.id, text: txText(tx), href: txLink(tx.id) }))
				)}
			{/if}
			{@render item(
				'unassigned',
				plan.checks.unassigned.length ? 'blocker' : 'ok',
				plan.checks.unassigned.length
					? t('export.check.unassigned', { count: plan.checks.unassigned.length })
					: t('export.check.unassignedOk'),
				plan.checks.unassigned.map((tx) => ({ id: tx.id, text: txText(tx), href: txLink(tx.id) }))
			)}
			{#if automatic.length}
				<li class="ml-5">
					<button
						type="button"
						class={button}
						onclick={confirmAutomatic}
						disabled={busy}
						data-testid="export-auto-confirm"
						>{t('export.check.autoConfirm', { count: automatic.length })}</button
					>
					<p class="mt-1 text-xs text-faint">{t('export.check.autoConfirmHint')}</p>
				</li>
			{/if}
			{@render item(
				'ledger',
				plan.checks.noLedger.length || plan.checks.noBankAccount.length ? 'blocker' : 'ok',
				plan.checks.noLedger.length
					? t('export.check.noLedger', {
							list: plan.checks.noLedger.map((a) => `${accountLabel(a)}`).join(', ')
						})
					: plan.checks.noBankAccount.length
						? t('export.check.noBankAccount', { count: plan.checks.noBankAccount.length })
						: t('export.check.ledgerOk'),
				plan.checks.noBankAccount.map((tx) => ({
					id: tx.id,
					text: txText(tx),
					href: txLink(tx.id)
				}))
			)}
			{@render item(
				'missing-receipt',
				plan.checks.missingReceipt.length ? 'warning' : 'ok',
				plan.checks.missingReceipt.length
					? t('export.check.missingReceipt', { count: plan.checks.missingReceipt.length })
					: t('export.check.missingReceiptOk'),
				plan.checks.missingReceipt.map((tx) => ({
					id: tx.id,
					text: txText(tx),
					href: txLink(tx.id)
				}))
			)}
			{@render item(
				'unlinked',
				plan.checks.unlinkedReceipts.length ? 'warning' : 'ok',
				plan.checks.unlinkedReceipts.length
					? t('export.check.unlinked', { count: plan.checks.unlinkedReceipts.length })
					: t('export.check.unlinkedOk'),
				plan.checks.unlinkedReceipts.map((r) => ({
					id: r.id,
					text: receiptText(r),
					href: receiptLink(r.id)
				}))
			)}
			{#if plan.checks.copies.length}
				{@render item(
					'copies',
					'warning',
					t('export.check.copies', { count: plan.checks.copies.length }),
					plan.checks.copies.map((r) => ({
						id: r.id,
						text: receiptText(r),
						href: receiptLink(r.id)
					}))
				)}
			{/if}
			{@render item(
				'unverified',
				plan.checks.unverified.length ? 'warning' : 'ok',
				plan.checks.unverified.length
					? t('export.check.unverified', { count: plan.checks.unverified.length })
					: t('export.check.unverifiedOk'),
				plan.checks.unverified.map((r) => ({
					id: r.id,
					text: receiptText(r),
					href: receiptLink(r.id)
				}))
			)}
		</ul>

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				onclick={download}
				disabled={busy || plan.blocked}
				data-testid="export-download">{busy ? t('export.building') : t('export.download')}</button
			>
			{#if plan.blocked}
				<p class="text-sm text-faint" data-testid="export-blocked">{t('export.blocked')}</p>
			{/if}
		</div>
		{#if done}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="export-done">{done}</p>
		{/if}
		{#if error}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="export-error">{error}</p>
		{/if}
		<TechnicalNote class="mt-3" testid="export-technical" lines={list('export.technical')} />
	</section>
{/if}

{#if currentStore()}
	<section
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		data-testid="export-crypto"
	>
		<h2 class="text-lg font-semibold text-heading">{t('export.crypto.title')}</h2>
		<p class="mt-1 text-sm text-text">{t('export.crypto.intro')}</p>
		{#if cryptoYears.length}
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<label class="flex items-center gap-2 text-sm">
					<span class="font-medium text-heading">{t('export.crypto.year')}</span>
					<select
						class="rounded-md border px-2 py-1.5 text-sm"
						bind:value={cryptoYear}
						data-testid="export-crypto-year"
					>
						<option value="">{t('export.crypto.allYears')}</option>
						{#each cryptoYears as y (y)}
							<option value={y}>{y}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					class={button}
					onclick={() => downloadCrypto('json')}
					data-testid="export-crypto-json">{t('export.crypto.json')}</button
				>
				<button
					type="button"
					class={button}
					onclick={() => downloadCrypto('csv')}
					data-testid="export-crypto-csv">{t('export.crypto.csv')}</button
				>
			</div>
		{/if}
		<div class="mt-3">
			<label
				class="inline-block cursor-pointer {button} {importing
					? 'pointer-events-none opacity-50'
					: ''}"
				data-testid="export-crypto-import"
				>{importing ? t('export.crypto.importing') : t('export.crypto.import')}<input
					type="file"
					accept=".json,application/json"
					class="sr-only"
					disabled={importing}
					onchange={(e) => {
						const input = /** @type {HTMLInputElement} */ (e.currentTarget);
						void importCrypto(input.files?.[0]);
						input.value = '';
					}}
					data-testid="export-crypto-import-file"
				/></label
			>
		</div>
		{#each imported as line, i (i)}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="export-crypto-imported">
				{line}
			</p>
		{/each}
		{#if cryptoDone}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="export-crypto-done">
				{cryptoDone}
			</p>
		{/if}
		{#if cryptoError}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="export-crypto-error">
				{cryptoError}
			</p>
		{/if}
		<TechnicalNote
			class="mt-3"
			testid="export-crypto-technical"
			lines={list('export.crypto.technical')}
		/>
	</section>
{/if}
