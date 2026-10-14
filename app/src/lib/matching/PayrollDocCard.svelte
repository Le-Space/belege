<script>
	// "Lohn- oder Steuerunterlage …" on a receipt (issue #233, payroll-docs.js):
	// a payroll run's payslips or journal, a wage-tax return, a contribution
	// statement or a tax assessment, linked to all the payments it stands for.
	// Its kind and period are proposed from the receipt; the payments of that
	// kind and period are ticked; a click links them. Once linked: which
	// payments, and the way back.
	import { app, currentStore, refreshNow, runMatchingNow } from '$lib/session.svelte.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { isActive } from './engine.js';
	import { periodOf } from './payroll.js';
	import {
		DOC_KINDS,
		PERIOD,
		guessPayrollDoc,
		linkPayrollDoc,
		paymentsFor,
		unlinkPayrollDoc
	} from './payroll-docs.js';

	/** @type {{ receipt: Record<string, any> }} */
	let { receipt } = $props();

	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';
	const KINDS = /** @type {import('./payroll-docs.js').DocKind[]} */ (Object.keys(DOC_KINDS));

	let doc = $derived(receipt.payrollDoc?.kind ? receipt.payrollDoc : null);
	let linked = $derived(
		doc
			? app.matches
					.filter((m) => m.receiptId === receipt.id && isActive(m))
					.map((m) => app.transactions.find((tx) => tx.id === m.transactionId))
					.filter((tx) => tx && !tx.deleted)
					.map((tx) => /** @type {Record<string, any>} */ (tx))
			: []
	);

	let open = $state(false);
	/** @type {import('./payroll-docs.js').DocKind} */
	let kind = $state('payroll');
	let periodText = $state('');
	/** @type {string[]} */
	let picked = $state([]);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another receipt: the form closed. Only then (a refresh brings the same one back).
	let shownFor = '';
	$effect(() => {
		const id = String(receipt.id);
		if (id === shownFor) return;
		shownFor = id;
		open = false;
		error = null;
	});

	/** `12/2025` as `2025-12`; a period payroll.js writes stays. */
	let period = $derived(
		PERIOD.test(periodText.trim()) ? periodText.trim() : (periodOf(periodText) ?? '')
	);
	let candidates = $derived(
		period ? paymentsFor({ kind, period }, app.transactions, app.classifications) : []
	);

	function start() {
		const guess = guessPayrollDoc(receipt);
		kind = guess?.kind ?? 'payroll';
		periodText = guess?.period ?? '';
		open = true;
		error = null;
	}
	// The payments of the kind and period, ticked – again only when either changes,
	// not on a refresh, which would tick again what was unticked.
	let pickedFor = '';
	$effect(() => {
		const key = `${kind}|${period}|${open}`;
		const ids = candidates.map((tx) => String(tx.id));
		if (key === pickedFor) return;
		pickedFor = key;
		picked = ids;
	});

	/** @param {() => Promise<void>} fn */
	async function act(fn) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await fn();
			await refreshNow();
		} catch (e) {
			error =
				/** @type {any} */ (e)?.code === 'period'
					? t('belege.payrollDoc.badPeriod')
					: e instanceof Error
						? e.message
						: String(e);
			return;
		} finally {
			busy = false;
		}
		runMatchingNow().catch((e) => (error = e instanceof Error ? e.message : String(e)));
	}

	const link = () =>
		act(async () => {
			await linkPayrollDoc(currentStore(), String(receipt.id), { kind, period }, picked);
			open = false;
		});
	const unlink = () => act(() => unlinkPayrollDoc(currentStore(), String(receipt.id)));

	/** `2025-12` → `12/2025`. @param {string} p */
	const shown = (p) => {
		const m = /^(\d{4})-(\d{2})$/.exec(p);
		return m ? `${m[2]}/${m[1]}` : p.replace('-', ' ');
	};
</script>

{#if doc}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="payroll-doc">
		<p class="font-medium text-heading">
			{t('belege.payrollDoc.is', {
				kind: t(`belege.payrollDoc.kind.${doc.kind}`),
				period: shown(String(doc.period ?? ''))
			})}
		</p>
		<ul class="mt-1 text-xs text-text">
			{#each linked as tx (tx.id)}
				<li data-testid="payroll-doc-payment">
					{formatDate(String(tx.bookedOn))} · {tx.counterparty} · {formatMoney(
						Number(tx.amountCents),
						'EUR'
					)}
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="text-xs text-faint underline"
			onclick={unlink}
			disabled={busy}
			data-testid="payroll-doc-undo">{t('belege.payrollDoc.undo')}</button
		>
	</div>
{:else}
	<div class="mt-3 border-t border-border pt-3 text-sm" data-testid="payroll-doc-offer">
		<button
			type="button"
			class={btn.link}
			onclick={() => (open ? (open = false) : start())}
			aria-expanded={open}
			data-testid="payroll-doc-open">{t('belege.payrollDoc.offer')}</button
		>
		{#if open}
			<p class="mt-1 text-xs text-faint">{t('belege.payrollDoc.hint')}</p>
			<div class="mt-2 flex flex-wrap items-end gap-3">
				<label class="flex flex-col text-text"
					>{t('belege.payrollDoc.kindLabel')}
					<select class={field} bind:value={kind} data-testid="payroll-doc-kind">
						{#each KINDS as k (k)}
							<option value={k}>{t(`belege.payrollDoc.kind.${k}`)}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col text-text"
					>{t('belege.payrollDoc.period')}
					<input
						class="w-32 {field}"
						placeholder="12/2025"
						bind:value={periodText}
						data-testid="payroll-doc-period"
					/>
				</label>
			</div>
			{#if period}
				{#if candidates.length}
					<ul class="mt-2 divide-y divide-border rounded-md border border-border">
						{#each candidates as tx (tx.id)}
							<li class="px-3 py-2">
								<label class="flex items-center gap-2 text-text" data-testid="payroll-doc-choice">
									<input type="checkbox" value={String(tx.id)} bind:group={picked} />
									<span class="flex-1">{formatDate(String(tx.bookedOn))} · {tx.counterparty}</span>
									<span class="font-mono tabular-nums"
										>{formatMoney(Number(tx.amountCents), 'EUR')}</span
									>
								</label>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-xs text-faint" data-testid="payroll-doc-none">
						{t('belege.payrollDoc.none', { period: shown(period) })}
					</p>
				{/if}
			{/if}
			<button
				type="button"
				class="mt-2 {btn.primary}"
				onclick={link}
				disabled={busy || !period}
				data-testid="payroll-doc-link">{t('belege.payrollDoc.link')}</button
			>
		{/if}
	</div>
{/if}
{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
