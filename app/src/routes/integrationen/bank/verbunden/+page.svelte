<script>
	// Where the bank sends the browser after an Enable Banking consent (issue
	// #224, step 2). The answer left the address already (the layout,
	// enablebanking/return.js); here, after unlocking, it goes to the bridge,
	// which turns the code into a session. Where a browser cannot come back
	// here – a dev server on localhost – the address the bank sent can be
	// pasted instead.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import { btn } from '$lib/ui/styles.js';
	import WayOut from '$lib/help/WayOut.svelte';
	import { formatDate } from '$lib/bank/format.js';
	import { parseReturn, takeReturn, takeStart } from '$lib/enablebanking/return.js';
	import { bridge, bridgeClient, loadBridge } from '$lib/integrations/bridge-state.svelte.js';
	import { rememberConsents } from '$lib/integrations/alerts.js';
	import { currentStore } from '$lib/session.svelte.js';

	/** @typedef {import('$lib/bridge/client.js').EnableBankingLink} Link */

	/** @type {'waiting' | 'none' | 'working' | 'linked' | 'refused' | 'failed'} */
	let phase = $state('waiting');
	/** @type {Link | null} */
	let linked = $state(null);
	/** @type {string | null} */
	let problem = $state(null);
	let pasted = $state('');
	/** @type {{ state: string, bank: string } | null} */
	let started = null;

	onMount(() => {
		started = takeStart(sessionStorage);
		const answer = takeReturn(sessionStorage);
		if (answer) finish(answer);
		else phase = 'none';
	});

	/** @param {import('$lib/enablebanking/return.js').BankReturn} answer */
	async function finish(answer) {
		problem = null;
		if (answer.error) {
			phase = 'refused';
			problem = [answer.error, answer.errorDescription].filter(Boolean).join(': ');
			return;
		}
		if (started && answer.state !== started.state) {
			phase = 'failed';
			problem = t('integrationen.enableBanking.returned.notOurs');
			return;
		}
		phase = 'working';
		try {
			if (!bridge.loaded) await loadBridge();
			if (!bridge.token) throw new Error(t('integrationen.enableBanking.returned.notPaired'));
			linked = await bridgeClient().enableBankingFinish({
				code: /** @type {string} */ (answer.code),
				state: answer.state ?? ''
			});
			// The consents' ends as they are now, before the page says so: a
			// renewal clears "Braucht dich", a short consent shows there.
			const store = currentStore();
			if (store) await rememberConsents(store.settings, await bridgeClient().enableBankingLinks());
			phase = 'linked';
		} catch (e) {
			phase = 'failed';
			problem = e instanceof Error ? e.message : String(e);
		}
	}

	function usePasted() {
		const answer = parseReturn(pasted);
		pasted = '';
		if (!answer) {
			phase = 'none';
			problem = t('integrationen.enableBanking.returned.pasteInvalid');
			return;
		}
		finish(answer);
	}
</script>

<svelte:head
	><title>{t('integrationen.enableBanking.returned.title')} · Le Space Belege</title></svelte:head
>

<nav aria-label={t('integrationen.overview.path')} class="text-sm text-faint">
	<a class="underline" href={resolve('/integrationen/[id]', { id: 'bank' })}
		>← {t('integrationen.overview.name.bank')}</a
	>
</nav>
<h1 class="mt-2 text-2xl font-bold text-heading">
	{t('integrationen.enableBanking.returned.title')}
</h1>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	data-testid="enablebanking-return"
	data-phase={phase}
>
	{#if phase === 'waiting' || phase === 'working'}
		<p class="text-sm text-text" role="status">
			{t('integrationen.enableBanking.returned.working')}
		</p>
	{:else if phase === 'linked' && linked}
		<p class="text-sm text-heading" role="status" data-testid="enablebanking-linked">
			{t('integrationen.enableBanking.returned.linked', {
				bank: linked.bank,
				count: linked.accounts.length
			})}
			{#if linked.validUntil}
				{t('integrationen.enableBanking.validUntil', {
					date: formatDate(linked.validUntil.slice(0, 10))
				})}
			{/if}
		</p>
		<ul class="mt-2 font-mono text-xs text-faint">
			{#each linked.accounts as a (a.uid)}
				<li>
					{[a.name, a.ibanLast4 && `····${a.ibanLast4}`, a.currency].filter(Boolean).join(' · ')}
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-faint">{t('integrationen.enableBanking.afterLink')}</p>
	{:else if phase === 'refused'}
		<p class="text-sm text-heading" role="alert" data-testid="enablebanking-refused">
			{t('integrationen.enableBanking.returned.refused')}
		</p>
		{#if problem}<p class="mt-1 font-mono text-xs text-faint">{problem}</p>{/if}
	{:else if phase === 'failed'}
		<p class="text-sm text-danger" role="alert" data-testid="enablebanking-failed">{problem}</p>
		<WayOut message={problem ?? ''} />
	{:else}
		<p class="text-sm text-text">{t('integrationen.enableBanking.returned.none')}</p>
		<label class="mt-3 block text-sm text-text">
			{t('integrationen.enableBanking.returned.pasteLabel')}
			<input
				class="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-heading"
				bind:value={pasted}
				autocomplete="off"
				data-testid="enablebanking-paste"
			/>
		</label>
		<button
			type="button"
			class="mt-2 {btn.secondary}"
			disabled={!pasted.trim()}
			onclick={usePasted}
			data-testid="enablebanking-paste-use"
			>{t('integrationen.enableBanking.returned.pasteUse')}</button
		>
		{#if problem}<p class="mt-2 text-sm text-danger" role="alert">{problem}</p>{/if}
	{/if}
	<p class="mt-4 text-sm">
		<a
			class="underline"
			href={resolve('/integrationen/[id]', { id: 'bank' })}
			data-testid="enablebanking-back">{t('integrationen.enableBanking.returned.back')}</a
		>
	</p>
</section>
