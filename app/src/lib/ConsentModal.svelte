<script>
	// The consent screen: what this app does with your data, before it does
	// anything.
	//
	// The structure is Le-Space/simple-todo apps/escrow01's (src/lib/ConsentModal.svelte
	// at f0d3df4, which wraps `<qr-intro>` from @le-space/libp2p-webrtc-qr): a
	// title with the "Technisch" switch beside it, the app's story, a statement
	// panel beside it on a wide screen and under it on a phone, a foot that
	// stays while the middle scrolls, and one explicit button to go on. Two
	// levels: a plain sentence for everyone, the technical detail only while
	// the switch is on.
	//
	// Changed: a native <dialog> rather than `<qr-intro>`. That element measures
	// the network on its first `open()` (an RTCPeerConnection against STUN
	// servers, escrow01 switches it off from outside), and its statement is one
	// flat list; this app makes no connection at all and its statement has
	// sections, a planned option and per-service detail. The look is the
	// element's, mapped onto the same tokens escrow01 maps it onto.
	import { t, list } from './i18n/index.js';
	import { consent } from './consent.js';
	import TechnicalToggle from './TechnicalToggle.svelte';
	import TechnicalNote from './TechnicalNote.svelte';
	import { technicalView } from './technical-view.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog = $state();
	const { open, accepted } = consent;

	$effect(() => {
		if (!dialog) return;
		if ($open && !dialog.open) dialog.showModal();
		if (!$open && dialog.open) dialog.close();
	});

	/** Escape closes it only once it has been accepted: first it is a decision. */
	function onCancel(/** @type {Event} */ event) {
		event.preventDefault();
		consent.close();
	}

	/**
	 * Chrome lets a page cancel Escape only after a user activation; without
	 * one the dialog closes anyway. It is still undecided, so it comes back.
	 */
	function onClose() {
		if ($open && dialog && !dialog.open) dialog.showModal();
	}

	/**
	 * @typedef {{ id: string, status: 'active' | 'whenPaired' | 'whenSetUp' | 'notYet', planned?: boolean }} Service
	 * @type {Service[]}
	 */
	const SERVICES = [
		{ id: 'bridge', status: 'whenPaired' },
		{ id: 'camt', status: 'active' },
		{ id: 'enableBanking', status: 'notYet', planned: true },
		{ id: 'deepseek', status: 'whenSetUp' }
	];

	const chip = {
		active: 'border-success/30 bg-success/10 text-success',
		planned:
			'border-data-400 bg-data-100 text-data-800 dark:border-data/40 dark:bg-data/10 dark:text-data'
	};
</script>

<dialog
	bind:this={dialog}
	oncancel={onCancel}
	onclose={onClose}
	aria-labelledby="consent-title"
	data-testid="consent-modal"
	data-technical={$technicalView}
	class="consent m-auto w-[calc(100vw-2rem)] max-w-[52rem] rounded-[14px] border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
>
	<div class="flex items-start justify-between gap-4">
		<h2 id="consent-title" class="text-lg font-semibold text-heading">{t('consent.title')}</h2>
		<div class="flex shrink-0 items-center gap-2">
			<TechnicalToggle testid="consent-technical" />
			{#if $accepted}
				<button
					type="button"
					class="rounded-md px-1.5 text-xl leading-none text-faint hover:text-heading"
					aria-label={t('consent.close')}
					onclick={() => consent.close()}
					data-testid="consent-close">×</button
				>
			{/if}
		</div>
	</div>

	<div
		class="consent-body mt-3 grid min-h-0 gap-4 overflow-auto md:grid-cols-[minmax(0,1fr)_19rem]"
	>
		<div class="flex min-w-0 flex-col gap-5">
			<p class="text-sm leading-relaxed">{t('consent.intro')}</p>
			<p class="rounded-md border border-border p-3 text-sm" data-testid="consent-warning">
				<span class="font-medium text-heading">{t('consent.earlyHeading')}</span>
				{t('consent.earlyBody')}
			</p>

			<!-- Identity -->
			<section class="border-l-4 border-l-identity pl-3" data-testid="consent-identity">
				<h3 class="text-base font-semibold">{t('consent.identity.title')}</h3>
				{#each list('consent.identity.simple') as line (line)}
					<p class="mt-1.5 text-sm leading-relaxed">{line}</p>
				{/each}
				<TechnicalNote
					class="mt-3"
					lines={list('consent.identity.technical')}
					testid="consent-technical-identity"
				/>
			</section>

			<!-- Storage -->
			<section class="border-l-4 border-l-data pl-3" data-testid="consent-storage">
				<h3 class="text-base font-semibold">{t('consent.storage.title')}</h3>
				{#each list('consent.storage.simple') as line (line)}
					<p class="mt-1.5 text-sm leading-relaxed">{line}</p>
				{/each}
				<p
					class="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-heading"
					data-testid="consent-loss"
				>
					<strong class="text-danger">{t('consent.storage.lossHeading')}</strong>
					{t('consent.storage.loss')}
				</p>
				<TechnicalNote
					class="mt-3"
					lines={list('consent.storage.technical')}
					testid="consent-technical-storage"
				/>
			</section>

			<!-- Network -->
			<section class="border-l-4 border-l-infra pl-3" data-testid="consent-network">
				<h3 class="flex flex-wrap items-center gap-2 text-base font-semibold">
					{t('consent.network.title')}
				</h3>
				{#each list('consent.network.simple') as line (line)}
					<p class="mt-1.5 text-sm leading-relaxed">{line}</p>
				{/each}
				<!--
					The options the network section will have. One so far, and not
					switchable: collaboration is planned, and when it comes it is
					switched on here, explicitly. A disabled row rather than none, so
					the place is visible and nobody wonders whether it is on.
				-->
				<ul class="mt-3 rounded-md border border-border" aria-label={t('consent.network.options')}>
					<li data-testid="consent-collaboration" data-state="planned">
						<label class="flex cursor-not-allowed items-start gap-3 px-3 py-2.5">
							<!-- A real switch, off and disabled: the place where it will be turned on. -->
							<input
								type="checkbox"
								role="switch"
								disabled
								checked={false}
								aria-describedby="consent-collaboration-text"
								class="sr-only"
								data-testid="consent-collaboration-switch"
							/>
							<span
								class="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-surface-2 p-0.5"
								aria-hidden="true"
							>
								<span class="h-3.5 w-3.5 rounded-full bg-faint/60"></span>
							</span>
							<span class="min-w-0 flex-1">
								<span class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-medium text-heading"
										>{t('consent.network.collaboration')}</span
									>
									<span class="rounded-md border px-1.5 py-0.5 text-xs font-medium {chip.planned}"
										>{t('consent.status.planned')}</span
									>
								</span>
								<span id="consent-collaboration-text" class="mt-0.5 block text-sm"
									>{t('consent.network.collaborationText')}</span
								>
							</span>
						</label>
					</li>
				</ul>
				<TechnicalNote
					class="mt-3"
					lines={list('consent.network.technical')}
					testid="consent-technical-network"
				/>
			</section>

			<!-- External services -->
			<section class="border-l-4 border-l-cyan pl-3" data-testid="consent-services">
				<h3 class="text-base font-semibold">{t('consent.services.title')}</h3>
				{#each list('consent.services.simple') as line (line)}
					<p class="mt-1.5 text-sm leading-relaxed">{line}</p>
				{/each}
				<ul class="mt-3 divide-y divide-border rounded-md border border-border">
					{#each SERVICES as service (service.id)}
						<li
							class="px-3 py-2.5"
							data-testid="consent-service"
							data-service={service.id}
							data-planned={service.planned === true}
						>
							<span class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-medium text-heading"
									>{t(`consent.services.${service.id}.name`)}</span
								>
								<span
									class="rounded-md border px-1.5 py-0.5 text-xs font-medium {service.planned
										? chip.planned
										: chip.active}"
									data-testid="consent-service-status"
									>{service.status === 'whenPaired' || service.status === 'whenSetUp'
										? `${t('consent.status.active')}, ${t(`consent.status.${service.status}`)}`
										: t(`consent.status.${service.status}`)}</span
								>
							</span>
							<span class="mt-0.5 block text-sm">{t(`consent.services.${service.id}.text`)}</span>
							<span class="mt-1 block text-sm">
								<span class="font-medium text-heading">{t('consent.services.leaves')}</span>
								{t(`consent.services.${service.id}.leaves`)}
							</span>
							<TechnicalNote
								class="mt-2"
								lines={[t(`consent.services.${service.id}.technical`)]}
								testid="consent-technical-service"
							/>
						</li>
					{/each}
				</ul>
			</section>
		</div>

		<!-- The statement panel: what is kept where, in one look. -->
		<aside
			class="self-start rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 text-sm"
			data-testid="consent-where"
		>
			<h3 class="text-xs font-semibold tracking-wide text-faint uppercase">
				{t('consent.where.heading')}
			</h3>
			<ul class="mt-2 flex list-disc flex-col gap-1.5 pl-4">
				{#each list('consent.where.items') as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
			<p class="mt-3 border-t border-border pt-2.5 text-heading">{t('consent.where.cookies')}</p>
		</aside>
	</div>

	<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
		<p class="max-w-md text-xs text-faint">{t('consent.reopenHint')}</p>
		<button
			type="button"
			onclick={() => consent.accept()}
			data-testid="consent-proceed"
			class="rounded-md bg-coral-700 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-800"
		>
			{t('consent.proceed')}
		</button>
	</div>
</dialog>

<style>
	/* The head and the foot stay; only the middle scrolls (the same fix as in
	   `<qr-intro>`: a dialog taller than the screen took its way out with it).
	   Scoped to the open state: a closed dialog stays display:none. */
	.consent[open] {
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - 2rem);
	}
</style>
