<script>
	// "Konto" in a booking's detail: the suggested contra account and BU key
	// with where they come from (booking/suggest.js), a field to search the
	// SKR 03 catalogue or type any number, and "Übernehmen". Only a confirmed
	// account is exported (export/plan.js); confirming teaches the vendor.
	import { untrack } from 'svelte';
	import TechnicalNote from './TechnicalNote.svelte';
	import { app, currentStore, refreshNow } from './session.svelte.js';
	import { confirmBooking } from './booking/actions.js';
	import { isNetworkFee, setFeeRule } from './booking/fee-rule.js';
	import { cleanMatchingSettings } from './matching/classify.js';
	import { clearingAccountOf, travelSetOf } from '$lib/travel/accounts.js';
	import { suggestBooking } from './booking/suggest.js';
	import { cleanDatevSettings, privateAccounts } from './booking/settings.js';
	import {
		accountLabel,
		catalogueAccount,
		isAccountNumber,
		searchAccounts
	} from './booking/skr03.js';
	import { matchesOfTx } from './matching/view.js';
	import { formatDate, formatMoney } from './bank/format.js';
	import AiMark from './AiMark.svelte';
	import { recordEvent } from './activity/events.js';
	import { eventCalls } from './stats/usage.js';
	import { list, t } from './i18n/index.js';

	/**
	 * @type {{ tx: import('./store/repository.js').StoredRecord, client?: { bookingAssist: (body: any) => Promise<any> } | null }}
	 * `client`: the paired bridge, for "✦ Konto vorschlagen"; without it the button is not shown.
	 */
	let { tx, client = null } = $props();

	let keys = $derived(cleanDatevSettings(app.datevSettings).taxKeys);
	let privateAccountsNow = $derived(privateAccounts(cleanDatevSettings(app.datevSettings)));
	let receipts = $derived(
		matchesOfTx(tx.id, app.matches).flatMap((m) => {
			const r = app.receipts.find((x) => x.id === m.receiptId);
			return r ? [r] : [];
		})
	);
	let suggestion = $derived(
		suggestBooking(tx, {
			classification: app.classifications[tx.id] ?? null,
			receipts,
			partners: app.partners ?? [],
			keys,
			privateAccounts: privateAccountsNow,
			travelSet: travelSetOf(cleanDatevSettings(app.datevSettings), app.travel),
			travelClearing: clearingAccountOf(cleanDatevSettings(app.datevSettings), app.travel)
		})
	);
	let income = $derived((tx.amountCents ?? 0) > 0);
	let chart = $derived(app.chart);
	let catalogue = $derived(searchAccounts('', { income, chart }));

	let accountText = $state('');
	let keyText = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Another booking, or a new suggestion (a receipt was linked): start from it.
	let seed = $derived(`${tx.id}|${suggestion.account}|${suggestion.taxKey}|${suggestion.source}`);
	// Only the seed counts: the lists are read again after every write, and
	// what the person typed must not be reset by that.
	$effect(() => {
		void seed;
		untrack(() => {
			accountText = suggestion.account ?? '';
			keyText = suggestion.taxKey;
			error = null;
		});
	});

	/** "4930 Bürobedarf" or "4930" → "4930". */
	let number = $derived(/^\s*(\d{4,8})(?:\s|$)/.exec(accountText)?.[1] ?? accountText.trim());
	let valid = $derived(isAccountNumber(number) && /^\d{0,4}$/.test(keyText.trim()));
	let known = $derived(catalogueAccount(number, chart));
	let confirmed = $derived(suggestion.source === 'confirmed');
	let unchanged = $derived(
		confirmed && number === suggestion.account && keyText.trim() === suggestion.taxKey
	);

	let sourceText = $derived(
		suggestion.source === 'learned'
			? suggestion.vendor
				? t('booking.source.learnedFrom', { vendor: suggestion.vendor })
				: t('booking.source.learned')
			: suggestion.source
				? t(`booking.source.${suggestion.source}`)
				: null
	);
	let taxText = $derived(
		t(`booking.taxVia.${suggestion.taxVia}`, {
			rate: String(
				receipts[0]?.extraction?.vat?.find((/** @type {any} */ v) => v?.rate)?.rate ?? ''
			)
		})
	);

	// "✦ Konto vorschlagen" (bridge POST /booking/assist): the model picks up to
	// two accounts of the list the "Konto" field offers – the person's chart, or
	// SKR 03 – from the payment, its receipt and the accounts learned so far.
	// Only on a click; nothing is taken until the person takes it.
	/** @type {{ picks: { account: string, confidence: string, reason: string }[], sent: string[] } | null} */
	let aiResult = $state(null);
	let aiBusy = $state(false);

	/** @param {number} cents */
	const plainMoney = (cents) => formatMoney(Math.abs(cents), 'EUR').replace(/\s*EUR$/, '');

	async function suggestByAi() {
		if (!client) return;
		aiBusy = true;
		error = null;
		aiResult = null;
		try {
			const receipt = receipts[0] ?? null;
			const ex = /** @type {Record<string, any>} */ (receipt?.extraction ?? {});
			const own = app.accounts.find((a) => a.id === tx.accountId);
			const r = await client.bookingAssist({
				booking: {
					direction: income ? 'in' : 'out',
					amount: plainMoney(tx.amountCents ?? 0),
					day: String(tx.bookedOn ?? '').slice(0, 10),
					account: own ? String(own.name ?? '').slice(0, 200) : null,
					counterparty: String(tx.counterparty ?? '').slice(0, 200),
					purpose: String(tx.purpose ?? '').slice(0, 1000)
				},
				receipt: receipt
					? {
							vendor: String(receipt.vendor ?? ex.vendor ?? '').slice(0, 200) || null,
							kind: typeof ex.document_type === 'string' ? ex.document_type.slice(0, 60) : null,
							vat:
								(Array.isArray(ex.vat) ? ex.vat : [])
									.map((/** @type {any} */ v) => v?.rate)
									.filter((/** @type {unknown} */ x) => typeof x === 'number')
									.map((/** @type {number} */ x) => `${x} %`)
									.join(', ')
									.slice(0, 60) || null,
							items: (Array.isArray(ex.line_items) ? ex.line_items : [])
								.map((/** @type {any} */ i) => String(i?.description ?? '').slice(0, 200))
								.filter(Boolean)
								.slice(0, 20)
						}
					: null,
				learned: (app.partners ?? [])
					.filter((p) => isAccountNumber(p.account) && String(p.name ?? '').trim())
					.slice(0, 80)
					.map((p) => ({ vendor: String(p.name).slice(0, 200), account: String(p.account) })),
				accounts: catalogue
					.slice(0, 600)
					.map((a) => ({ number: a.number, name: a.name.slice(0, 120) }))
			});
			aiResult = { picks: r.picks ?? [], sent: r.llm?.sent ?? [] };
			await recordEvent(currentStore()?.events, 'booking-assist', {
				transactionId: tx.id,
				picks: aiResult.picks.length,
				model: r.llm?.calls?.at(-1)?.model ?? null,
				calls: eventCalls(r.llm?.calls ?? []),
				ms: (r.llm?.calls ?? []).reduce(
					(/** @type {number} */ n, /** @type {any} */ c) => n + (c.ms ?? 0),
					0
				),
				tokensTotal: (r.llm?.calls ?? []).reduce(
					(/** @type {number} */ n, /** @type {any} */ c) =>
						n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
					0
				)
			});
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			aiBusy = false;
		}
	}

	// Another booking: its own suggestion. By id only – the record is read
	// again after every write, and that must not drop what the model said.
	let txId = $derived(tx.id);
	$effect(() => {
		void txId;
		untrack(() => {
			aiResult = null;
		});
	});

	// A network fee: its account for all of them at once (#305).
	let networkFee = $derived(isNetworkFee(tx));
	let feeRule = $derived(cleanMatchingSettings(app.matchingSettings).networkFeeAccount);
	/** @type {string | null} */
	let ruleNote = $state(null);

	async function setRule(/** @type {boolean} */ on) {
		const store = currentStore();
		if (!store) return;
		if (on && !isAccountNumber(number)) {
			error = t('booking.invalidAccount');
			return;
		}
		busy = true;
		error = null;
		try {
			const count = await setFeeRule(/** @type {any} */ (store), on ? number : null);
			ruleNote = t(on ? 'booking.feeRule.applied' : 'booking.feeRule.lifted', { count });
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function confirm() {
		const store = currentStore();
		if (!store) return;
		if (!isAccountNumber(number)) {
			error = t('booking.invalidAccount');
			return;
		}
		if (!/^\d{0,4}$/.test(keyText.trim())) {
			error = t('booking.invalidKey');
			return;
		}
		busy = true;
		error = null;
		try {
			await confirmBooking(/** @type {any} */ (store), tx.id, {
				account: number,
				taxKey: keyText.trim()
			});
			await refreshNow();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const input = 'mt-1 rounded-md border px-2 py-1.5 text-sm';
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
	data-testid="tx-booking"
	data-confirmed={confirmed ? 'true' : 'false'}
>
	<h3 class="flex items-center gap-1.5 text-sm font-semibold text-heading">
		{t('booking.title')}
		<span
			class="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-border text-xs font-normal text-faint"
			title={t('booking.intro')}
			role="img"
			aria-label={t('booking.intro')}
			data-testid="tx-booking-info">i</span
		>
	</h3>

	{#if confirmed}
		<p class="mt-2 text-sm text-success" data-testid="tx-booking-confirmed">
			{t('booking.confirmed', {
				account: accountLabel(suggestion.account, chart),
				key: suggestion.taxKey
					? t('booking.keyValue', { key: suggestion.taxKey })
					: t('booking.keyNone'),
				date: formatDate(String(tx.booking?.confirmedAt ?? '').slice(0, 10))
			})}
		</p>
	{:else}
		<p class="mt-2 text-sm text-text" data-testid="tx-booking-suggestion">
			{#if suggestion.account}
				<span class="font-medium text-heading">{t('booking.suggestion')}:</span>
				{accountLabel(suggestion.account, chart)}
				<span
					class="ml-1 inline-block rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text"
					data-testid="tx-booking-source"
					data-source={suggestion.source}>{sourceText}</span
				>
			{:else}
				{t('booking.source.none')}
			{/if}
		</p>
		<p class="mt-1 text-xs text-danger" data-testid="tx-booking-open">
			{t('booking.notConfirmed')}
		</p>
	{/if}

	<form
		class="mt-2 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			confirm();
		}}
	>
		<label class="flex min-w-48 flex-1 flex-col text-sm">
			<span class="text-faint">{t('booking.account')}</span>
			<input
				class="{input} font-mono"
				list="skr03-accounts-{tx.id}"
				inputmode="numeric"
				autocomplete="off"
				bind:value={accountText}
				placeholder={t('booking.accountPlaceholder')}
				data-testid="tx-booking-account"
			/>
			<datalist id="skr03-accounts-{tx.id}">
				{#each catalogue as a (a.number)}
					<option value={a.number}>{a.number} {a.name}</option>
				{/each}
			</datalist>
			<span class="mt-1 min-h-4 text-xs text-faint" data-testid="tx-booking-account-name"
				>{known
					? known.name
					: isAccountNumber(number)
						? t(chart ? 'booking.notInChart' : 'booking.ownNumber')
						: ''}</span
			>
		</label>
		<label class="flex w-28 flex-col text-sm">
			<span class="text-faint">{t('booking.taxKey')}</span>
			<input
				class="{input} font-mono"
				list="tax-keys-{tx.id}"
				inputmode="numeric"
				autocomplete="off"
				bind:value={keyText}
				placeholder={t('booking.taxKeyPlaceholder')}
				data-testid="tx-booking-key"
			/>
			<datalist id="tax-keys-{tx.id}">
				{#each [...new Set(Object.values(keys).filter(Boolean))] as k (k)}
					<option value={k}></option>
				{/each}
			</datalist>
			<span class="mt-1 min-h-4 text-xs text-faint">&nbsp;</span>
		</label>
		<button
			type="submit"
			class="mb-5 rounded-md bg-coral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
			disabled={busy || !valid || unchanged}
			data-testid="tx-booking-confirm"
			>{confirmed ? t('booking.confirmChange') : t('booking.confirm')}</button
		>
	</form>
	{#if !confirmed}
		<p class="text-xs text-faint" data-testid="tx-booking-tax-via">{taxText}</p>
	{/if}
	{#if client}
		<div class="mt-2 text-sm" data-testid="tx-booking-ai">
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-text hover:bg-surface-2 disabled:opacity-50"
				onclick={suggestByAi}
				disabled={aiBusy || busy || !catalogue.length}
				title={t('booking.ai.hint', {
					chart: chart ? t('booking.ai.chart') : t('booking.ai.skr03')
				})}
				data-testid="tx-booking-ai-ask"
				><AiMark />{aiBusy ? t('booking.ai.asking') : t('booking.ai.ask')}</button
			>
			{#if aiResult}
				{#if aiResult.picks.length}
					<ul class="mt-2 flex flex-col gap-1" data-testid="tx-booking-ai-picks">
						{#each aiResult.picks as p (p.account)}
							<li class="flex flex-wrap items-baseline gap-x-2" data-account={p.account}>
								<span class="font-mono text-heading">{accountLabel(p.account, chart)}</span>
								<span class="text-xs text-faint"
									>{t(`booking.ai.confidence.${p.confidence}`)} – {p.reason}</span
								>
								<button
									type="button"
									class="text-xs text-text underline hover:text-heading"
									onclick={() => (accountText = p.account)}
									data-testid="tx-booking-ai-take">{t('booking.ai.take')}</button
								>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-xs text-faint" data-testid="tx-booking-ai-none">
						{t('booking.ai.none')}
					</p>
				{/if}
				{#if aiResult.sent.length}
					<details class="mt-1 text-xs text-faint" data-testid="tx-booking-ai-sent">
						<summary class="cursor-pointer">{t('booking.ai.sent')}</summary>
						{#each aiResult.sent as sent, i (i)}
							<pre
								class="mt-1 max-h-40 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono break-words whitespace-pre-wrap">{sent}</pre>
						{/each}
					</details>
				{/if}
			{/if}
		</div>
	{/if}
	{#if networkFee}
		<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="tx-fee-rule">
			{#if feeRule}
				<span class="text-text"
					>{tx.booking?.via === 'rule'
						? t('booking.feeRule.byRule', { account: accountLabel(feeRule, chart) })
						: t('booking.feeRule.active', { account: accountLabel(feeRule, chart) })}</span
				>
				<button
					type="button"
					class="text-faint underline hover:text-heading"
					onclick={() => setRule(false)}
					disabled={busy}
					data-testid="tx-fee-rule-lift">{t('booking.feeRule.lift')}</button
				>
			{:else}
				<button
					type="button"
					class="rounded-md border border-border px-2 py-1 text-text hover:bg-surface-2 disabled:opacity-50"
					onclick={() => setRule(true)}
					disabled={busy || !valid}
					title={t('booking.feeRule.applyTitle')}
					data-testid="tx-fee-rule-apply">{t('booking.feeRule.apply')}</button
				>
			{/if}
			{#if ruleNote}<span class="text-success" role="status" data-testid="tx-fee-rule-note"
					>{ruleNote}</span
				>{/if}
		</div>
	{/if}
	<p class="mt-1 text-xs text-faint" data-testid="tx-booking-catalogue">
		{chart ? t('booking.chartNote', { count: chart.accounts.length }) : t('booking.catalogueNote')}
	</p>
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="tx-booking-error">{error}</p>
	{/if}
	<TechnicalNote class="mt-2" testid="tx-booking-technical" lines={list('booking.technical')} />
</section>
