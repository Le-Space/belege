<script>
	// "Export": one month as a DATEV Buchungsstapel plus the receipts, in a
	// ZIP made here in the browser (export/build.js, loaded on the click with
	// fflate) and downloaded. Before that, the check list (export/plan.js):
	// without a confirmed account for every booking and a ledger account for
	// every bank account there is no export.
	import { resolve } from '$app/paths';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { app, currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { planMonth } from '$lib/export/plan.js';
	import { cleanDatevSettings } from '$lib/booking/settings.js';
	import { confirmBookings } from '$lib/booking/actions.js';
	import { suggestBooking } from '$lib/booking/suggest.js';
	import { accountLabel, formatDate, formatMoney } from '$lib/bank/format.js';
	import { receiptVendor } from '$lib/receipts/view.js';
	import { list, t } from '$lib/i18n/index.js';

	const MONTH = new Intl.DateTimeFormat('de-DE', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const MONTH_NAME = new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' });

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

	let settings = $derived(cleanDatevSettings(app.datevSettings));
	let plan = $derived(
		month
			? planMonth({
					month,
					transactions: app.transactions,
					accounts: app.accounts,
					receipts: app.receipts,
					matches: app.matches,
					classifications: app.classifications
				})
			: null
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
			// Only a download: a Blob and a click, nothing sent anywhere.
			const url = URL.createObjectURL(
				new Blob([/** @type {BlobPart} */ (zip)], { type: 'application/zip' })
			);
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName;
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			done = t('export.done', { file: fileName, ...counts });
			await refreshNow();
		} catch (e) {
			error = failed(e);
		} finally {
			busy = false;
		}
	}

	/** @param {string} id */
	const txLink = (id) => `${resolve('/zahlungen')}?tx=${encodeURIComponent(id)}`;
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
				onchange={(e) => (chosen = /** @type {HTMLSelectElement} */ (e.currentTarget).value)}
				data-testid="export-month-select"
			>
				{#each months as m (m)}
					<option value={m}>{MONTH.format(new Date(`${m}-01T00:00:00Z`))}</option>
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
		<p class="mt-1 text-xs text-faint" data-testid="export-settings">
			{t('export.settings', {
				consultant: settings.consultantNumber,
				client: settings.clientNumber,
				fiscal: MONTH_NAME.format(new Date(Date.UTC(2026, settings.fiscalYearStartMonth - 1, 1))),
				length: settings.accountLength
			})} ·
			<a class="underline" href={resolve('/integrationen')}>{t('export.settingsLink')}</a>
		</p>
	</section>

	<section
		class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		data-testid="export-checks"
	>
		<h2 class="text-lg font-semibold text-heading">{t('export.checks')}</h2>
		<ul class="mt-2 flex flex-col gap-3 text-sm">
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
				plan.checks.unlinkedReceipts.map((r) => ({ id: r.id, text: receiptText(r), href: null }))
			)}
			{@render item(
				'unverified',
				plan.checks.unverified.length ? 'warning' : 'ok',
				plan.checks.unverified.length
					? t('export.check.unverified', { count: plan.checks.unverified.length })
					: t('export.check.unverifiedOk'),
				plan.checks.unverified.map((r) => ({ id: r.id, text: receiptText(r), href: null }))
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
