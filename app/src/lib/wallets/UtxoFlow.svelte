<script>
	// A Bitcoin transaction's flow (issue #1037): its inputs → its outputs,
	// each marked by what it is to us – our own wallet, the change back to the
	// sender, our own change, someone else. Ours first; the other recipients
	// collapsed into "n weitere Empfänger". Addresses short, the full one on
	// hover and copy. Everything here is chain data: rendered as text only.
	import CopyButton from '$lib/CopyButton.svelte';
	import { t } from '$lib/i18n/index.js';
	import { formatQuantity } from '$lib/assets/quantity.js';
	import { shortAddress } from '$lib/bank/payee.js';

	/**
	 * @type {{
	 *   flow: NonNullable<ReturnType<typeof import('./payout-wallet.js').utxoFlow>>,
	 *   asset: string,
	 *   decimals: number,
	 *   ownLabel: string,
	 *   fee: string
	 * }}
	 */
	let { flow, asset, decimals, ownLabel, fee } = $props();

	let open = $state(false);
	const amount = (/** @type {string} */ sats) => formatQuantity(sats, decimals);
	const total = (/** @type {string} */ s) => BigInt(/^\d+$/.test(s) ? s : '0');
	/** @param {'inputs' | 'outputs'} key @param {number} count */
	const counted = (key, count) =>
		count === 1
			? t(`zahlungen.detail.utxo.${key}One`)
			: t(`zahlungen.detail.utxo.${key}`, { count });

	// Ours and the change first, the others after – collapsed beyond what is ours.
	let outputs = $derived([...flow.outputs].sort((a, b) => rank(a.role) - rank(b.role)));
	let others = $derived(flow.outputs.filter((o) => o.role === 'other'));
	let collapsed = $derived(!flow.weSent && others.length > 1);
	let shown = $derived(collapsed && !open ? outputs.filter((o) => o.role !== 'other') : outputs);
	let hidden = $derived(
		others.length + (flow.utxo.moreOutputs?.count ?? 0) - (collapsed && !open ? 0 : others.length)
	);
	let hiddenSats = $derived(
		(collapsed && !open ? others.reduce((s, o) => s + total(o.sats), 0n) : 0n) +
			total(flow.utxo.moreOutputs?.sats ?? '0')
	);
	let maxSats = $derived(
		[...flow.inputs, ...flow.outputs].reduce((m, x) => (total(x.sats) > m ? total(x.sats) : m), 1n)
	);
	/** @param {string} role */
	function rank(role) {
		return role === 'ours' ? 0 : role === 'change' ? 1 : role === 'ourChange' ? 2 : 3;
	}
	/** @param {string} sats share of the largest, in percent, at least a sliver */
	const share = (sats) => Math.max(3, Number((total(sats) * 100n) / maxSats));
	/** @param {{ role: string }} x */
	const tag = (x) =>
		x.role === 'ours'
			? t('zahlungen.detail.utxo.ours', { name: ownLabel })
			: x.role === 'ourChange'
				? t('zahlungen.detail.utxo.ourChange')
				: x.role === 'change'
					? t('zahlungen.detail.utxo.change')
					: t(flow.weSent ? 'zahlungen.detail.utxo.recipient' : 'zahlungen.detail.utxo.other');
	const tone = {
		ours: 'border-success/40 bg-success/5',
		ourChange: 'border-dashed border-cyan/40',
		change: 'border-dashed border-border',
		other: 'border-border'
	};
	const tagTone = {
		ours: 'text-success font-semibold',
		ourChange: 'text-cyan font-semibold',
		change: 'text-text font-semibold',
		other: 'text-faint'
	};
</script>

{#snippet side(/** @type {any} */ x, /** @type {string} */ testid)}
	<li
		class="relative min-w-0 overflow-hidden rounded-md border bg-surface-2 px-2.5 py-1.5 {tone[
			/** @type {keyof typeof tone} */ (x.role)
		]}"
		data-testid={testid}
		data-role={x.role}
	>
		<span class="flex items-baseline justify-between gap-2">
			<span class="text-xs {tagTone[/** @type {keyof typeof tagTone} */ (x.role)]}">{tag(x)}</span>
			<span class="font-mono text-sm whitespace-nowrap text-heading tabular-nums"
				>{amount(x.sats)}</span
			>
		</span>
		{#if x.address}
			<span class="block min-w-0 truncate" title={x.address}>
				<CopyButton
					text={x.address}
					label={t('copy.address')}
					testid={`${testid}-address`}
					valueClass="font-mono text-xs text-faint">{shortAddress(x.address)}</CopyButton
				>
			</span>
		{/if}
		{#if x.count > 1}<span class="text-xs text-faint"
				>{t('zahlungen.detail.utxo.inputsFrom', { count: x.count })}</span
			>{/if}
		<span
			class="absolute bottom-0 left-0 h-0.5 {x.role === 'ours' ? 'bg-success' : 'bg-faint/50'}"
			style:width={`${share(x.sats)}%`}
			aria-hidden="true"
		></span>
	</li>
{/snippet}

<section class="@container mt-4" aria-labelledby="tx-utxo-h" data-testid="tx-utxo">
	<h3 id="tx-utxo-h" class="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">
		{t('zahlungen.detail.utxo.title', {
			inputs: counted('inputs', flow.utxo.inputCount),
			outputs: counted('outputs', flow.utxo.outputCount)
		})}
	</h3>
	<div
		class="grid grid-cols-1 gap-2 @lg:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.35fr)] @lg:items-start"
	>
		<div class="min-w-0">
			<p class="mb-1 text-xs text-faint" data-testid="tx-utxo-inputs-count">
				{counted('inputs', flow.utxo.inputCount)}
			</p>
			<ul class="grid gap-1.5">
				{#each flow.inputs as x, i (i)}
					{@render side(x, 'tx-utxo-input')}
				{/each}
				{#if flow.utxo.moreInputs}
					<li class="px-2.5 text-xs text-faint">
						{t('zahlungen.detail.utxo.moreInputs', {
							count: flow.utxo.moreInputs.count,
							amount: amount(flow.utxo.moreInputs.sats)
						})}
					</li>
				{/if}
			</ul>
		</div>
		<span class="grid h-5 place-items-center text-faint @lg:h-auto @lg:pt-6" aria-hidden="true"
			><span class="rotate-90 @lg:rotate-0">→</span></span
		>
		<div class="min-w-0">
			<p class="mb-1 text-xs text-faint" data-testid="tx-utxo-outputs-count">
				{counted('outputs', flow.utxo.outputCount)}
			</p>
			<ul class="grid gap-1.5">
				{#each shown as x, i (i)}
					{@render side(x, 'tx-utxo-output')}
				{/each}
			</ul>
			{#if hidden > 0}
				<p class="mt-1.5 text-sm" data-testid="tx-utxo-more">
					{#if collapsed && !open}
						<button
							type="button"
							class="w-full rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-text hover:bg-surface-2"
							aria-expanded="false"
							onclick={() => (open = true)}
							data-testid="tx-utxo-more-open"
							>{t('zahlungen.detail.utxo.moreRecipients', {
								count: hidden,
								amount: amount(String(hiddenSats))
							})}</button
						>
					{:else}
						<span class="px-2.5 text-xs text-faint"
							>{t('zahlungen.detail.utxo.moreUnlisted', {
								count: hidden,
								amount: amount(String(hiddenSats))
							})}</span
						>
					{/if}
				</p>
			{/if}
			{#if collapsed && open}
				<button
					type="button"
					class="mt-1 text-xs underline"
					aria-expanded="true"
					onclick={() => (open = false)}
					data-testid="tx-utxo-more-close">{t('zahlungen.detail.utxo.collapse')}</button
				>
			{/if}
			<p class="mt-1.5 text-xs text-faint" data-testid="tx-utxo-fee">
				{t(flow.weSent ? 'zahlungen.detail.utxo.feeOurs' : 'zahlungen.detail.utxo.feeSender', {
					fee: `${amount(fee)} ${asset}`
				})}
			</p>
		</div>
	</div>
</section>
