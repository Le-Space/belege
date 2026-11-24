<script>
	// Integrationen → Aleph: Le Space Credits (#593). The balance of the books'
	// own account, what the KI service and a hosted bridge drew this month, and
	// "Aufladen": Stripe's embedded Checkout on the service's own page, framed
	// in a dialog here, so Stripe's script never runs beside the books. Nothing
	// is asked of the service until the person switches it on. For the owner of
	// the books also "Vertrag widerrufen" (§ 356a BGB) and "Verträge hier
	// kündigen" (§ 312k BGB): each first says what it concerns, then a button
	// that does it, then what the service received.
	import { onDestroy } from 'svelte';
	import WayOut from '$lib/help/WayOut.svelte';
	import TermsConsent from './TermsConsent.svelte';
	import { PRIVACY_URL, SECURITY_URL, TERMS_URL } from '$lib/legal.js';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { formatDate } from '$lib/bank/format.js';
	import { locale } from '$lib/i18n/locale.svelte.js';
	import {
		CreditsError,
		TOPUPS,
		BRIDGE_PLANS,
		createCreditsClient,
		creditsUrl,
		euro,
		isInvoiceUrl,
		isPaidMessage,
		loadCredits,
		payUrl,
		setCreditsOn,
		termsOf
	} from './credits.js';

	let on = $state(false);
	/** @type {Awaited<ReturnType<typeof createCreditsClient>> | null} */
	let client = $state(null);
	/** @type {import('./credits.js').Balance | null} */
	let balance = $state(null);
	/** @type {import('./credits.js').Purchase[]} */
	let purchases = $state([]);
	/** @type {import('./credits.js').PublishedTerms | null} what the service publishes of its terms */
	let published = $state(null);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let note = $state(null);
	/** @type {string | null} the Checkout being paid */
	let paying = $state(null);
	/** @type {string | null} */
	let frameUrl = $state(null);
	let agreed = $state(false);
	let waiting = $state(false);
	let confirmRefund = $state(false);
	/** @type {import('./credits.js').Withdrawal | null} what can be withdrawn, before the confirmation */
	let withdrawQuote = $state(null);
	/** @type {import('./credits.js').Withdrawal | null} the withdrawal the service received */
	let withdrawn = $state(null);
	let ending = $state(false);
	/** @type {{ received: string, plan: string, endsAt: string | null } | null} */
	let ended = $state(null);

	const paused = $derived(app.network.paused);
	// Withdrawing and cancelling are the owner's; a member's device only reads.
	const owner = $derived(!app.member);
	const plan = $derived(
		/** @type {import('./credits.js').Balance | null} */ (balance)?.package ?? null
	);
	const planName = (/** @type {string} */ id) =>
		BRIDGE_PLANS.some((p) => p.id === id) ? t(`integrationen.hostedBridge.plans.${id}`) : id;
	const day = (/** @type {string | null | undefined} */ iso) =>
		iso ? formatDate(iso.slice(0, 10)) : '—';
	/** What a withdrawable contract is, in the person's words. @param {import('./credits.js').WithdrawalItem} item */
	function withdrawable(item) {
		const topup = TOPUPS.find((p) => p.id === item.what);
		if (item.subject === 'credits' && topup)
			return t('credits.withdraw.credits', { amount: money(topup.cents) });
		if (item.subject === 'subscription') return t('credits.withdraw.subscription');
		if (item.subject === 'backup') return t('credits.withdraw.backup', { what: item.what });
		return item.what;
	}
	const terms = $derived.by(() => (balance ? termsOf(balance.terms) : null));
	// The declaration on withdrawal in the service's own words, which it records
	// by its version; the app's text only while the service sends none.
	const withdrawal = $derived.by(() => published?.withdrawal ?? null);
	const withdrawalText = $derived(
		withdrawal ? (locale.current === 'de' ? withdrawal.de : withdrawal.en) : t('credits.withdrawal')
	);

	$effect(() => {
		load();
	});

	async function load() {
		const store = currentStore();
		if (!store) return;
		const c = await loadCredits(store.settings);
		on = c.on;
		client = c.key ? await createCreditsClient({ key: c.key }) : null;
		if (on && !paused) await refresh();
	}

	async function refresh() {
		if (!client) return;
		error = null;
		try {
			balance = await client.balance();
			purchases = await client.purchases();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
		}
		// Without an answer nothing is assumed: the service refuses a purchase
		// that lacks the consent, and the card then asks again.
		published = await client.terms().catch(() => published);
	}

	/** @param {boolean} value */
	async function switchOn(value) {
		const store = currentStore();
		if (!store) return;
		await setCreditsOn(store.settings, value);
		balance = null;
		await load();
	}

	/** @param {string} packageId */
	function startTopUp(packageId) {
		paying = packageId;
		agreed = false;
		frameUrl = null;
		error = null;
		note = null;
	}

	async function openCheckout() {
		if (!client || !paying) return;
		busy = true;
		try {
			const { client_secret } = await client.checkout(
				paying,
				locale.current,
				withdrawal?.version ?? null
			);
			frameUrl = payUrl(client_secret, location.origin);
		} catch (e) {
			paying = null;
			if (e instanceof CreditsError && e.status === 412 && e.code === 'TERMS') {
				// The terms came into force since the balance was read: ask for them.
				await refresh();
				note = t('credits.terms.needed');
			} else error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function closeCheckout() {
		paying = null;
		frameUrl = null;
	}

	/** After "paid": read the balance until the webhook has booked it. */
	async function waitForBooking() {
		const before = balance?.credits ?? 0;
		waiting = true;
		try {
			for (let i = 0; i < 30; i++) {
				await refresh();
				if ((balance?.credits ?? 0) > before) {
					note = t('credits.booked');
					return;
				}
				await new Promise((r) => setTimeout(r, 2000));
			}
			note = t('credits.notYet');
		} finally {
			waiting = false;
		}
	}

	/** @param {MessageEvent} event */
	function onMessage(event) {
		if (!frameUrl || !isPaidMessage(event)) return;
		closeCheckout();
		waitForBooking();
	}
	if (typeof window !== 'undefined') window.addEventListener('message', onMessage);
	onDestroy(() => {
		if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
	});

	async function askRefund() {
		if (!client) return;
		busy = true;
		error = null;
		try {
			await client.refund();
			confirmRefund = false;
			note = t('credits.refundAsked');
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function quoteWithdrawal() {
		if (!client) return;
		busy = true;
		error = null;
		withdrawn = null;
		try {
			withdrawQuote = await client.withdraw(true);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function confirmWithdrawal() {
		if (!client) return;
		busy = true;
		error = null;
		try {
			withdrawn = await client.withdraw(false);
			withdrawQuote = null;
			await refresh();
		} catch (e) {
			if (e instanceof CreditsError && e.code === 'NOTHING_TO_WITHDRAW')
				withdrawQuote = { quote: true, items: [], receivedAt: null, refund: false };
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function confirmEnd() {
		if (!client || !plan) return;
		busy = true;
		error = null;
		const id = plan.id;
		try {
			const out = await client.endPlan();
			ending = false;
			ended = {
				received: new Date().toISOString(),
				plan: id,
				endsAt: out?.package?.period_end ?? plan.period_end ?? null
			};
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const money = (/** @type {number} */ n) => euro(n, intlLocale());
	/** Date and time of a receipt, in the person's locale. @param {string} iso */
	const when = (iso) =>
		new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		);
</script>

<section class={card} aria-labelledby="credits-h" data-testid="credits-card">
	<h2 id="credits-h" class="text-lg font-semibold text-heading">{t('credits.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('credits.what')}</p>

	{#if !on}
		<p class="mt-2 text-sm text-faint">{t('credits.offNote')}</p>
		<button
			type="button"
			class="mt-3 {button}"
			disabled={paused}
			onclick={() => switchOn(true)}
			data-testid="credits-on">{t('credits.switchOn')}</button
		>
	{:else}
		{#if paused}
			<p class="mt-2 text-sm text-faint">{t('credits.paused')}</p>
		{:else if balance}
			<p class="mt-3 text-2xl font-semibold text-heading" data-testid="credits-balance">
				{money(balance.credits)}
			</p>
			{#if balance.reserved}
				<p class="text-xs text-faint">
					{t('credits.reserved', { amount: money(balance.reserved) })}
				</p>
			{/if}
			<dl
				class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm"
				data-testid="credits-month"
			>
				<dt class="text-faint">{t('credits.lineKi')}</dt>
				<dd class="text-heading">{money(balance.lines_this_month.ki)}</dd>
				<dt class="text-faint">{t('credits.lineVm')}</dt>
				<dd class="text-heading">{money(balance.lines_this_month.vm)}</dd>
			</dl>
			{#if balance.package}
				<p class="mt-2 text-sm text-text" data-testid="credits-package">
					{balance.package.state === 'ending'
						? t('credits.end.ending', {
								plan: planName(balance.package.id),
								date: day(balance.package.period_end)
							})
						: t('credits.package', {
								id: planName(balance.package.id),
								hours: balance.package.hours_left ?? '—'
							})}
				</p>
			{/if}
			{#if balance.refund && balance.refund.state !== 'done'}
				<p class="mt-2 text-sm text-text" data-testid="credits-refund-state">
					{t('credits.refundPending')}
				</p>
			{:else if balance.refund?.state === 'done' && balance.refund.credits}
				<p class="mt-2 text-sm text-text" data-testid="credits-refund-state">
					{t('credits.refundDone', {
						amount: money(balance.refund.credits),
						date: formatDate((balance.refund.done_at ?? balance.refund.created_at).slice(0, 10))
					})}
				</p>
			{/if}
			{#if purchases.length}
				<h3 class="mt-4 text-sm font-semibold text-heading">{t('credits.purchasesTitle')}</h3>
				<ul class="mt-1 divide-y divide-border text-sm" data-testid="credits-purchases">
					{#each purchases as p (p.id)}
						<li class="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
							<span class="text-text">
								{formatDate(p.created_at.slice(0, 10))} · {money(p.amount_cents)}
							</span>
							{#if isInvoiceUrl(p.stripe_invoice_url)}
								<a
									href={p.stripe_invoice_url}
									target="_blank"
									rel="noopener noreferrer"
									class="text-heading underline"
									data-testid="credits-invoice">{t('credits.invoice')}</a
								>
							{:else}
								<span class="text-xs text-faint">{t('credits.invoicePending')}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if balance && balance.mode !== 'live'}
			<!-- The service takes no real money yet (Stripe in test mode, or it does not
			     say): no top-up is offered until it does. -->
			<p class="mt-3 text-sm text-faint" data-testid="credits-test-mode">{t('credits.testMode')}</p>
		{:else if balance}
			{#if client}
				<TermsConsent {client} {terms} {published} onaccepted={refresh} />
			{/if}
			<div class="mt-3 flex flex-wrap gap-2">
				{#each TOPUPS as topup (topup.id)}
					<button
						type="button"
						class={button}
						disabled={paused || busy || !client || terms?.due}
						onclick={() => startTopUp(topup.id)}
						data-testid="credits-topup-{topup.cents / 100}"
						>{t('credits.topUp', { amount: money(topup.cents) })}</button
					>
				{/each}
			</div>
		{/if}

		{#if paying}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3"
				role="dialog"
				aria-label={t('credits.payTitle')}
				data-testid="credits-pay"
			>
				{#if !frameUrl}
					<label class="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							class="mt-0.5"
							bind:checked={agreed}
							data-testid="credits-agree"
						/>
						<span class="text-text" data-testid="credits-withdrawal">{withdrawalText}</span>
					</label>
					<div class="mt-2 flex gap-2">
						<button
							type="button"
							class={primary}
							disabled={!agreed || busy}
							onclick={openCheckout}
							data-testid="credits-checkout">{t('credits.toPayment')}</button
						>
						<button type="button" class={button} onclick={closeCheckout}
							>{t('credits.cancel')}</button
						>
					</div>
				{:else}
					<iframe
						src={frameUrl}
						title={t('credits.payTitle')}
						class="h-[640px] w-full rounded-md border border-border bg-white"
						allow="payment"
						data-testid="credits-frame"
					></iframe>
					<div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
						<a
							href={frameUrl}
							target="_blank"
							rel="noopener"
							class="text-heading underline"
							data-testid="credits-popup">{t('credits.ownWindow')}</a
						>
						<button type="button" class={button} onclick={closeCheckout}
							>{t('credits.cancel')}</button
						>
						<button
							type="button"
							class={button}
							onclick={() => {
								closeCheckout();
								waitForBooking();
							}}>{t('credits.paidElsewhere')}</button
						>
					</div>
				{/if}
			</div>
		{/if}

		{#if waiting}
			<p class="mt-2 text-sm text-faint" role="status">{t('credits.waiting')}</p>
		{/if}
		{#if note}
			<p class="mt-2 text-sm text-heading" role="status" data-testid="credits-note">{note}</p>
		{/if}
		{#if error}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="credits-error">{error}</p>
			<WayOut message={error} />
		{/if}

		{#if withdrawQuote}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
				role="region"
				aria-label={t('credits.withdraw.button')}
				data-testid="credits-withdraw-quote"
			>
				{#if withdrawQuote.items.length}
					<p class="font-medium text-heading">{t('credits.withdraw.quoteTitle')}</p>
					<ul class="mt-1 list-disc pl-5 text-text">
						{#each withdrawQuote.items as item, i (i)}
							<li>
								{t('credits.withdraw.item', {
									what: withdrawable(item),
									date: day(item.concludedAt),
									until: day(item.until)
								})}
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-text">{t('credits.withdraw.effect')}</p>
					<div class="mt-2 flex gap-2">
						<button
							type="button"
							class={primary}
							disabled={busy || paused}
							onclick={confirmWithdrawal}
							data-testid="credits-withdraw-yes">{t('credits.withdraw.yes')}</button
						>
						<button type="button" class={button} onclick={() => (withdrawQuote = null)}
							>{t('credits.cancel')}</button
						>
					</div>
				{:else}
					<p class="text-text" data-testid="credits-withdraw-none">{t('credits.withdraw.none')}</p>
					<button type="button" class="mt-2 {button}" onclick={() => (withdrawQuote = null)}
						>{t('credits.cancel')}</button
					>
				{/if}
			</div>
		{/if}
		{#if withdrawn}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
				role="status"
				data-testid="credits-withdraw-done"
			>
				<p class="font-medium text-heading">
					{t('credits.withdraw.done', {
						date: withdrawn.receivedAt ? when(withdrawn.receivedAt) : '—'
					})}
				</p>
				<ul class="mt-1 list-disc pl-5 text-text">
					{#each withdrawn.items as item, i (i)}
						<li>{withdrawable(item)}</li>
					{/each}
				</ul>
				{#if withdrawn.refund}
					<p class="mt-1 text-text">{t('credits.withdraw.refund')}</p>
				{/if}
				<p class="mt-1 text-faint">{t('credits.withdraw.mail')}</p>
			</div>
		{/if}
		{#if ending}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
				role="region"
				aria-label={t('credits.end.title')}
				data-testid="credits-end-confirm"
			>
				<p class="font-medium text-heading">{t('credits.end.title')}</p>
				{#if !plan}
					<p class="mt-1 text-text" data-testid="credits-end-none">{t('credits.end.none')}</p>
				{:else if plan.billing === 'stripe'}
					<p class="mt-1 text-text">{t('credits.end.subscribed')}</p>
				{:else if plan.state === 'ending'}
					<p class="mt-1 text-text">
						{t('credits.end.ending', { plan: planName(plan.id), date: day(plan.period_end) })}
					</p>
				{:else}
					<p class="mt-1 text-text" data-testid="credits-end-contract">
						{t('credits.end.contract', {
							plan: planName(plan.id),
							id: plan.id,
							date: day(plan.period_end)
						})}
					</p>
					<p class="mt-1 text-text">{t('credits.end.effect')}</p>
					<p class="mt-1 text-xs text-faint">
						{t('credits.account', { host: new URL(creditsUrl()).host })}
						<span class="font-mono break-all">{client?.address}</span>
					</p>
				{/if}
				<div class="mt-2 flex gap-2">
					{#if plan && plan.state !== 'ending' && plan.billing !== 'stripe'}
						<button
							type="button"
							class={primary}
							disabled={busy || paused}
							onclick={confirmEnd}
							data-testid="credits-end-yes">{t('credits.end.yes')}</button
						>
					{/if}
					<button type="button" class={button} onclick={() => (ending = false)}
						>{t('credits.cancel')}</button
					>
				</div>
			</div>
		{/if}
		{#if ended}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
				role="status"
				data-testid="credits-end-done"
			>
				<p class="font-medium text-heading">
					{t('credits.end.done', {
						received: when(ended.received),
						plan: planName(ended.plan),
						date: day(ended.endsAt)
					})}
				</p>
				<p class="mt-1 text-faint">{t('credits.end.mail')}</p>
			</div>
		{/if}

		<div class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
			{#if owner && balance}
				<button
					type="button"
					class={button}
					disabled={busy || paused}
					onclick={() => {
						ended = null;
						withdrawQuote = null;
						ending = true;
					}}
					data-testid="credits-end">{t('credits.end.button')}</button
				>
				<button
					type="button"
					class={button}
					disabled={busy || paused}
					onclick={() => {
						ending = false;
						quoteWithdrawal();
					}}
					data-testid="credits-withdraw">{t('credits.withdraw.button')}</button
				>
			{/if}
			{#if !owner && balance}
				<span class="text-xs text-faint" data-testid="credits-owner-only"
					>{t('credits.withdraw.ownerOnly')}</span
				>
			{/if}
			{#if confirmRefund}
				<span class="text-text">{t('credits.refundConfirm')}</span>
				<button
					type="button"
					class={button}
					disabled={busy || paused}
					onclick={askRefund}
					data-testid="credits-refund-yes">{t('credits.refundYes')}</button
				>
				<button type="button" class={button} onclick={() => (confirmRefund = false)}
					>{t('credits.cancel')}</button
				>
			{:else}
				<button
					type="button"
					class={button}
					disabled={busy || paused || !balance?.credits}
					onclick={() => (confirmRefund = true)}
					data-testid="credits-refund">{t('credits.refund')}</button
				>
			{/if}
			<button type="button" class={button} onclick={() => switchOn(false)} data-testid="credits-off"
				>{t('credits.switchOff')}</button
			>
		</div>
		<p class="mt-2 flex flex-wrap gap-x-3 text-xs text-faint" data-testid="credits-legal">
			{#each [['terms', TERMS_URL], ['privacy', PRIVACY_URL], ['security', SECURITY_URL]] as [name, href] (name)}
				<a
					{href}
					target="_blank"
					rel="noopener noreferrer"
					class="underline hover:text-heading"
					data-testid="credits-legal-{name}">{t(`credits.legal.${name}`)}</a
				>
			{/each}
		</p>
		{#if client}
			<p class="mt-2 text-xs text-faint">
				{t('credits.account', { host: new URL(creditsUrl()).host })}
				<span class="font-mono break-all" data-testid="credits-address">{client.address}</span>
			</p>
		{/if}
	{/if}
</section>
