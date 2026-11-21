<script>
	// "Gehostete Bridge" (#585, #587): start the bridge's confidential VM from
	// this browser (hosted-vm.js), owned by the books' Aleph key and paid by Le
	// Space from the books' plan or by that key itself, attest and unlock it,
	// paired in the same step (hosted-bridge.js), see how long it runs, and
	// stop it. A VM that runs already can be unlocked by its hash, or picked
	// from the books' key's VMs Aleph lists. While a VM boots, the card says
	// which try of the unlock it is and why the last one failed, and the
	// waiting can be cancelled. The passphrase is the image's: typed here for
	// the shared image, kept nowhere; for the books' own image (#777, built
	// here with "Bridge-Image bauen" when the books' key pays) derived in the
	// browser and never typed.
	import { intlLocale, t } from '$lib/i18n/index.js';
	import {
		app,
		buildHostedImage,
		chooseHostedPlan,
		forgetLeftHostedBuilder,
		continueHostedStart,
		hostedBridgeRecord,
		hostedBuildReserve,
		hostedCredits,
		hostedInstances,
		hostedNodeHistory,
		hostedNodes,
		hostedOwnImage,
		hostedVmRecord,
		startHostedBridge,
		stopHostedBridge,
		stopHostedInstance,
		unlockHostedBridge
	} from '$lib/session.svelte.js';
	import HackathonBand from './HackathonBand.svelte';
	import BuildJourney from '@le-space/build-journey/BuildJourney.svelte';
	import { stationOfBuildStep, withFacts } from '@le-space/build-journey';
	import { BRIDGE_BUILDER } from './bridge-builder.js';
	import { ALEPH_API_HOSTS } from './aleph-fetch.js';
	import { keepAwake } from '$lib/wake-lock.js';
	import { holdAlive, keepAliveOffered, keepAliveWanted, setKeepAlive } from '$lib/keep-alive.js';
	import { bridge, checkBridge } from './bridge-state.svelte.js';
	import { noteAleph, noteAlephStart } from './hosted-status.svelte.js';
	import { usage } from './hosted-vm.js';
	import { nodeHistoryOf, preferredNode } from './hosted-nodes.js';
	import { hostedNotUp } from './bridge-status.js';
	import { fetchStartStatus, hostedStartHint } from './hosted-start.js';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import { isCancelled, reasonOf } from './hosted-unlock.js';
	import { BRIDGE_PLANS, euro } from '$lib/credits/credits.js';

	let instance = $state('');
	let passphrase = $state('');
	let startPassphrase = $state('');
	let crn = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** The error as it came, for the technical view, when the card says it in its own words. */
	let errorDetail = $state('');
	/** Which nodes could not be attested, and where the last unlock held (sealed settings). */
	let history = $state(nodeHistoryOf(null));
	/** @type {string} */
	let progress = $state('');
	/** A note that is no error: the waiting was cancelled. @type {string | null} */
	let notice = $state(null);
	/** Cancels the unlock's waiting while it runs. @type {AbortController | null} */
	let controller = $state(null);
	/** @type {Awaited<ReturnType<typeof hostedInstances>> | null} */
	let instances = $state(null);
	let instancesError = $state(false);
	let existingOpen = $state(false);
	/** Which hash was just copied. */
	let copied = $state('');
	/** @type {Awaited<ReturnType<typeof hostedBridgeRecord>>} */
	let kept = $state(null);
	/** @type {any} */
	let vm = $state(null);
	/** @type {Awaited<ReturnType<typeof hostedNodes>> | null} */
	let nodes = $state(null);
	let now = $state(Date.now());
	/** Who pays the VM: Le Space from the books' plan, or the books' key. @type {'lespace' | 'books'} */
	let paidBy = $state(/** @type {'lespace' | 'books'} */ ('lespace'));
	/** @type {Awaited<ReturnType<typeof hostedCredits>> | null} */
	let credits = $state(null);
	/** The books' own image (#777), when built. @type {Awaited<ReturnType<typeof hostedOwnImage>>} */
	let ownImage = $state(null);
	/** A build of the own image runs: it cannot be cancelled half-way, so no "Abbrechen". */
	let building = $state(false);

	/** "Alles pausieren" (network-pause.js): the card asks nothing and offers nothing that dials. */
	const paused = $derived(app.network.paused);
	/** The session's node went online at unlock and the network is not paused. */
	const online = $derived(app.sync.online && !paused);
	// Paused while the card waits for a VM: the waiting ends. A build is not
	// cut off half-way; it ends by itself, and its builder is forgotten with it.
	$effect(() => {
		if (paused && !building) controller?.abort();
	});

	const running = $derived(Boolean(vm && !vm.stoppedAt));
	/** A start Aleph has, not yet unlocked from here. */
	const halfway = $derived(running && /** @type {any} */ (kept)?.instance !== vm?.instance);
	const used = $derived(usage(vm, vm?.stoppedAt ? Date.parse(vm.stoppedAt) : now));
	/** The next start uses the books' own image: they pay themselves and have one. */
	const startsOwn = $derived(!halfway && paidBy === 'books' && Boolean(ownImage) && !app.member);
	/** The image needs no typed passphrase: the own image's is derived (#777). */
	const derivedPassphrase = $derived(halfway ? Boolean(vm?.image) : startsOwn);
	/** The unlocked VM whose node reached this device while the page was open. */
	let reachedFor = $state('');
	$effect(() => {
		const peerId = /** @type {any} */ (kept)?.peerId;
		const devices = app.sync.state?.devices ?? [];
		if (peerId && devices.some((d) => d.peerId === peerId && d.connected)) {
			reachedFor = /** @type {any} */ (kept).instance;
		}
	});
	/** Unlocked, but nothing in the VM started: most often a wrong passphrase. */
	const notUp = $derived(
		hostedNotUp({ kept, vm, reached: reachedFor === /** @type {any} */ (kept)?.instance, now })
	);

	/**
	 * What the unlocked VM says about its own start (hosted-start.js), asked
	 * only while its bridge does not answer this device and the network is on.
	 * @type {import('./hosted-start.js').StartStatus | null}
	 */
	let startStatus = $state(null);
	$effect(() => {
		const id = /** @type {any} */ (kept)?.instance;
		const mine = id && (!vm || (!vm.stoppedAt && vm.instance === id));
		const silent = bridge.state !== 'online' || reachedFor !== id;
		if (!mine || !silent || !online || busy) {
			startStatus = null;
			return;
		}
		let gone = false;
		const ask = async () => {
			const status = await fetchStartStatus(id);
			if (!gone) startStatus = status;
		};
		ask();
		const timer = setInterval(ask, 10_000);
		return () => {
			gone = true;
			clearInterval(timer);
		};
	});
	/** The sentence for a bridge that is still starting, or whose node is not. */
	const startHint = $derived(hostedStartHint(startStatus));
	// The status block above says what this card says (bridge-status.js `bridgeStatusRows`).
	$effect(() => {
		const shown = online && !busy;
		noteAlephStart(
			/** @type {any} */ (kept)?.instance ?? null,
			shown ? startHint : null,
			shown && notUp && !startStatus
		);
	});

	async function reload() {
		[kept, vm, history, ownImage] = await Promise.all([
			hostedBridgeRecord(),
			hostedVmRecord(),
			hostedNodeHistory(),
			hostedOwnImage()
		]);
		noteAleph(kept, vm);
	}

	async function loadInstances() {
		// Paused meanwhile: asked again once the network is resumed.
		if (!online) return void (instances = null);
		instancesError = false;
		try {
			instances = await hostedInstances();
		} catch {
			instancesError = true;
			instances = instances ?? [];
		}
	}

	// What the books keep about the VM is read without the network, paused or not.
	$effect(() => {
		if (app.sync.online) reload();
	});
	// A builder a closed window left on Aleph is forgotten as soon as the card opens (#777).
	let leftChecked = false;
	$effect(() => {
		if (!online || leftChecked) return;
		leftChecked = true;
		forgetLeftHostedBuilder().catch(() => {});
	});
	$effect(() => {
		if (kept && !instance) instance = kept.instance;
	});
	$effect(() => {
		if (online && instances === null) loadInstances();
	});
	$effect(() => {
		if (!online || running || nodes) return;
		Promise.all([hostedNodes(), hostedNodeHistory()])
			.then(([list, remembered]) => {
				nodes = list;
				history = remembered;
				// Where the last unlock held, not a node that could not be attested last time.
				if (!crn) crn = preferredNode(list, remembered);
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)));
	});
	$effect(() => {
		if (!online || running || credits) return;
		hostedCredits()
			.then((c) => {
				credits = c;
				if (!c.on) paidBy = 'books';
			})
			.catch(() => {
				credits = {
					on: false,
					credits: null,
					plan: null,
					hoursLeft: null,
					periodEnd: null,
					termsDue: false
				};
				paidBy = 'books';
			});
	});
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	/** What is downloading from Aleph, and how far (#587). */
	let download = $state('');
	/** Aleph has been slow for a while: say it is Aleph. */
	let slow = $state(false);

	/** @param {number} bytes */
	const mb = (bytes) =>
		(bytes / 1_000_000).toLocaleString(intlLocale(), {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		});

	/** @param {{ phase: string, detail?: string, received?: number, total?: number | null, ms?: number, attempt?: number, tries?: number }} p */
	const onProgress = ({
		phase,
		detail = '',
		received = 0,
		total = null,
		ms = 0,
		attempt,
		tries
	}) => {
		if (phase === 'bytes') {
			// Small answers (messages, the manifest) are not worth a line.
			if (received < 200_000 && !total) return;
			const host = (() => {
				try {
					return new URL(detail).host;
				} catch {
					return detail;
				}
			})();
			download = t(
				total
					? 'integrationen.hostedBridge.download.of'
					: 'integrationen.hostedBridge.download.some',
				{ received: mb(received), total: mb(total ?? 0), seconds: Math.round(ms / 1000), host }
			);
			slow = ms > 20_000;
			return;
		}
		if ((phase === 'ownImage.fetch' || phase === 'ownImage.upload') && total) {
			download = '';
			slow = false;
			progress = t(`integrationen.hostedBridge.phase.${phase}Of`, {
				received: mb(received),
				total: mb(total),
				host: detail
			});
			return;
		}
		download = '';
		slow = false;
		const counted = Number.isInteger(attempt) && Number.isInteger(tries);
		if (phase === 'boot' && counted) {
			progress = t('integrationen.hostedBridge.phase.bootTry', {
				attempt: String(attempt),
				tries: String(tries),
				reason: reasonOf(detail) || '–'
			});
			return;
		}
		if (phase === 'network' && counted) {
			progress = t('integrationen.hostedBridge.phase.networkTry', {
				attempt: String(attempt),
				tries: String(tries)
			});
			return;
		}
		if (phase === 'wait' && detail) {
			progress = t('integrationen.hostedBridge.phase.waitWhy', { reason: reasonOf(detail) });
			return;
		}
		const key = `integrationen.hostedBridge.phase.${phase}`;
		const text = t(key);
		if (text !== key) progress = text;
	};

	/** @param {(signal: AbortSignal) => Promise<any>} run */
	async function step(run) {
		busy = true;
		error = null;
		errorDetail = '';
		notice = null;
		progress = '';
		download = '';
		slow = false;
		const own = new AbortController();
		controller = own;
		try {
			const result = await run(own.signal);
			if (result?.peerId) {
				bridge.peerId = result.peerId;
				await checkBridge();
			}
		} catch (e) {
			if (isCancelled(e) || own.signal.aborted) notice = t('integrationen.hostedBridge.cancelled');
			else {
				error = e instanceof Error ? e.message : String(e);
				errorDetail = String(/** @type {any} */ (e)?.detail ?? '');
			}
		} finally {
			busy = false;
			progress = '';
			download = '';
			slow = false;
			controller = null;
			await reload();
			// The node just found not checkable is not the one to start on next; any other choice stays.
			if (nodes && history.unverifiable[crn]) crn = preferredNode(nodes, history);
			await loadInstances();
		}
	}

	function cancel() {
		controller?.abort();
	}

	/** @param {string} text */
	async function copy(text) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => {
				if (copied === text) copied = '';
			}, 2000);
		} catch {
			copied = '';
		}
	}

	/** "Zum Entsperren wählen": the hash into the form below. @param {string} hash */
	function pick(hash) {
		instance = hash;
		existingOpen = true;
		requestAnimationFrame(() =>
			/** @type {HTMLInputElement | null} */ (
				document.querySelector('[data-testid="hosted-bridge-passphrase"]')
			)?.focus()
		);
	}

	/** @param {string} hash */
	function stopListed(hash) {
		if (!confirm(t('integrationen.hostedBridge.instances.confirmStop', { hash }))) return;
		step(() => stopHostedInstance(hash));
	}

	/**
	 * The build as a journey (@le-space/build-journey): station, facts reported
	 * so far, done or failed. @type {{ station: string, since: number, done: boolean, failed: boolean, minimized: boolean, facts: import('@le-space/build-journey').Facts } | null}
	 */
	let journeyView = $state(null);
	/**
	 * What the books' key holds and Aleph wants before a build; null until
	 * asked or when it cannot be.
	 * @type {{ credits: number, needed: number, address: string } | null}
	 */
	let reserve = $state(null);
	$effect(() => {
		if (!online || paidBy !== 'books' || busy) return;
		hostedBuildReserve().then((r) => (reserve = r));
	});
	/** @param {{ credits: number, needed: number } | null} r */
	const isShort = (r) => Boolean(r && r.credits < r.needed);
	const short = $derived(isShort(reserve));
	/** The soft tone on a phone while the build runs; off per browser (keep-alive.js). */
	let keepAlive = $state(keepAliveWanted(globalThis.localStorage));

	/** The journey's words, from the catalogue. @param {string} key @param {Record<string, string | number>} [v] */
	const journeyText = (key, v = {}) => t(`integrationen.hostedBridge.journey.${key}`, v);
	/** Where the journey's evidence can be checked: Aleph's messages, the plain image's source, the pin. */
	const JOURNEY_LINKS = Object.freeze({
		aleph: `${ALEPH_API_HOSTS[0]}/api/v0/messages`,
		repo: 'https://github.com/Le-Space/belege',
		expected:
			'https://github.com/Le-Space/belege/blob/main/app/src/lib/integrations/bridge-builder.js'
	});
	/** The tries of the upload: @le-space/sealed-image's UPLOAD_HOSTS, not imported here to keep the build's code out of the card. */
	const JOURNEY_UPLOAD_TRIES = 3;
	/** On a phone: stay in Belege, and whether the soft tone holds the tab (keep-alive.js). */
	const journeyHint = $derived(
		keepAliveOffered()
			? [
					t('integrationen.hostedBridge.journey.phone'),
					keepAlive ? t('integrationen.hostedBridge.journey.phoneTone') : ''
				]
					.filter(Boolean)
					.join(' ')
			: null
	);

	/** @param {any} p a build's progress: the card's line, and the journey's station and facts */
	const buildProgress = (p) => {
		onProgress(p);
		if (!journeyView || typeof p.step !== 'string') return;
		const station = stationOfBuildStep(p.step);
		const now = Date.now();
		journeyView.facts = withFacts(journeyView.facts, p.step, p.data ?? {}, now);
		if (station && station !== journeyView.station) {
			journeyView.station = station;
			journeyView.since = now;
		}
	};

	/** "Bridge-Image bauen" (#777). */
	async function build() {
		// From the click, before the first await: the screen stays on, and on a
		// phone a soft tone keeps the tab from sleeping when the person switches
		// apps (#525) – the builder's fetch would break off otherwise.
		const letSleep = keepAwake();
		const letQuiet = holdAlive({ title: t('keepAlive.building') });
		building = true;
		journeyView = {
			station: 'wake',
			since: Date.now(),
			done: false,
			failed: false,
			minimized: false,
			facts: {}
		};
		try {
			await step(() => buildHostedImage({ onProgress: buildProgress }));
		} finally {
			letSleep();
			letQuiet();
			building = false;
			if (journeyView) {
				if (error) journeyView.failed = true;
				else journeyView.done = true;
				journeyView.minimized = false;
			}
		}
	}

	/** @param {SubmitEvent} event */
	function start(event) {
		event.preventDefault();
		const typed = derivedPassphrase ? undefined : startPassphrase;
		startPassphrase = '';
		step((signal) =>
			halfway
				? continueHostedStart({ passphrase: typed, signal, onProgress })
				: startHostedBridge({ crn, passphrase: typed, paidBy, signal, onProgress })
		);
	}

	/** @param {string} planId */
	function choosePlan(planId) {
		step(async () => {
			credits = await chooseHostedPlan(planId);
		});
	}

	function stop() {
		step(() => stopHostedBridge());
	}

	/** @param {SubmitEvent} event */
	function unlock(event) {
		event.preventDefault();
		const typed = passphrase;
		passphrase = '';
		step((signal) => unlockHostedBridge({ instance, passphrase: typed, signal, onProgress }));
	}

	/** @param {string} iso */
	const when = (iso) => new Date(iso).toLocaleString(intlLocale());
	const field = 'mt-1 min-h-11 rounded-md border px-2 font-mono text-sm';
	const primary =
		'min-h-11 rounded-md bg-coral-700 px-4 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<section
	class="mt-4 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	id="hosted-bridge"
	data-testid="hosted-bridge"
>
	<HackathonBand />
	<h2 class="text-lg font-semibold text-heading">{t('integrationen.hostedBridge.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('integrationen.hostedBridge.intro')}</p>

	{#if vm}
		<p class="mt-3 text-sm text-text" data-testid="hosted-bridge-vm">
			{#if running}
				<span
					class="mr-1 rounded-full px-2.5 py-0.5 text-xs font-medium {halfway
						? 'bg-warning/15 text-warning'
						: 'bg-success/15 text-success'}"
					data-testid="hosted-bridge-badge"
					>{halfway
						? t('integrationen.bridgeStatus.state.aleph.locked')
						: t('integrationen.bridgeStatus.state.aleph.unlocked')}</span
				>
				{t('integrationen.hostedBridge.running', { date: when(vm.startedAt) })}
			{:else}
				{t('integrationen.hostedBridge.stopped', { date: when(vm.stoppedAt) })}
			{/if}
			{#if used}
				· <span data-testid="hosted-bridge-usage"
					>{used.credits !== null
						? t('integrationen.hostedBridge.usage', {
								hours: used.hours.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }),
								credits: used.credits.toLocaleString(intlLocale()),
								perHour: Number(vm.creditsPerHour).toLocaleString(intlLocale())
							})
						: t('integrationen.hostedBridge.usageHours', {
								hours: used.hours.toLocaleString(intlLocale(), { maximumFractionDigits: 1 })
							})}</span
				>
			{/if}
		</p>
		<p class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-faint">
			<span>{t('integrationen.hostedBridge.instanceHash')}</span>
			<code class="font-mono break-all text-text" data-testid="hosted-bridge-vm-hash"
				>{vm.instance}</code
			>
			<button
				type="button"
				class="hover:bg-surface-muted min-h-8 rounded border border-border px-2 text-xs text-text"
				onclick={() => copy(vm.instance)}
				data-testid="hosted-bridge-vm-copy"
				>{copied === vm.instance
					? t('integrationen.hostedBridge.copied')
					: t('integrationen.hostedBridge.copy')}</button
			>
		</p>
		{#if vm.nodeUrl}
			<p class="mt-1 text-xs break-all text-faint" data-testid="hosted-bridge-vm-node">
				{t('integrationen.hostedBridge.node')}: <span class="font-mono">{vm.nodeUrl}</span>
			</p>
		{/if}
	{/if}

	{#if kept && (!vm || (running && kept.instance === vm.instance))}
		<p class="mt-3 text-sm text-text" data-testid="hosted-bridge-state">
			<span class="font-medium text-success">{t('integrationen.hostedBridge.attested')}</span>
			· <span class="font-mono">{kept.host}</span>
			· {t('integrationen.hostedBridge.attestedAt', { date: when(kept.attestedAt) })}
		</p>
		<p class="mt-1 font-mono text-xs break-all text-faint" data-testid="hosted-bridge-measurement">
			{t('integrationen.hostedBridge.measurement')}
			{kept.measurement}
		</p>
		{#if startHint && online && !busy}
			<p
				class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
				role="status"
				data-testid="hosted-bridge-start-hint"
				data-hint={startHint}
			>
				{t(`integrationen.hostedBridge.vmStart.${startHint}`)}
			</p>
		{:else if notUp && !startStatus && online && !busy}
			<div
				class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
				role="status"
				data-testid="hosted-bridge-not-up"
			>
				<p>{t('integrationen.hostedBridge.notUp')}</p>
				<button
					type="button"
					class="hover:bg-surface-muted mt-2 min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text"
					onclick={() => pick(/** @type {any} */ (kept).instance)}
					data-testid="hosted-bridge-unlock-again"
					>{t('integrationen.hostedBridge.unlockAgain')}</button
				>
			</div>
		{/if}
	{/if}

	{#if online}
		{#if running && !halfway}
			<button
				type="button"
				class="hover:bg-surface-muted mt-4 min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text disabled:opacity-50"
				disabled={busy}
				onclick={stop}
				data-testid="hosted-bridge-stop">{t('integrationen.hostedBridge.stop')}</button
			>
		{:else}
			{#if !halfway}
				<fieldset class="mt-4 text-sm" data-testid="hosted-bridge-payer">
					<legend class="text-faint">{t('integrationen.hostedBridge.payer.title')}</legend>
					<label class="mt-1 flex items-start gap-2">
						<input
							type="radio"
							name="hosted-payer"
							value="lespace"
							bind:group={paidBy}
							disabled={!credits?.on}
							data-testid="hosted-bridge-pays-lespace"
						/>
						<span>{t('integrationen.hostedBridge.payer.lespace')}</span>
					</label>
					<label class="mt-1 flex items-start gap-2">
						<input
							type="radio"
							name="hosted-payer"
							value="books"
							bind:group={paidBy}
							data-testid="hosted-bridge-pays-books"
						/>
						<span>{t('integrationen.hostedBridge.payer.books')}</span>
					</label>
					{#if credits && !credits.on}
						<p class="mt-1 text-xs text-faint">
							{t('integrationen.hostedBridge.payer.creditsOff')}
						</p>
					{/if}
				</fieldset>
				{#if paidBy === 'lespace' && credits?.on}
					<div class="mt-2 text-sm text-text" data-testid="hosted-bridge-plan">
						{#if credits.plan}
							{t('integrationen.hostedBridge.payer.plan', {
								plan: t(`integrationen.hostedBridge.plans.${credits.plan}`),
								hours: credits.hoursLeft ?? '–'
							})}
						{:else}
							<p>
								{t('integrationen.hostedBridge.payer.noPlan', {
									balance: euro(credits.credits ?? 0, intlLocale())
								})}
							</p>
							{#if credits.termsDue}
								<p class="mt-1 text-faint" data-testid="hosted-bridge-terms-due">
									{t('credits.terms.needed')}
								</p>
							{/if}
							<div class="mt-2 flex flex-wrap gap-2">
								{#each BRIDGE_PLANS as plan (plan.id)}
									<button
										type="button"
										class="hover:bg-surface-muted min-h-11 rounded-md border border-border px-3 text-sm text-text disabled:opacity-50"
										disabled={busy || credits.termsDue || (credits.credits ?? 0) < plan.credits}
										onclick={() => choosePlan(plan.id)}
										data-testid="hosted-bridge-plan-{plan.id}"
										>{t('integrationen.hostedBridge.payer.choose', {
											plan: t(`integrationen.hostedBridge.plans.${plan.id}`),
											hours: plan.hours,
											price: euro(plan.credits, intlLocale())
										})}</button
									>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
			{#if !halfway && !app.member}
				<div class="mt-4 text-sm" data-testid="hosted-bridge-own-image">
					<h3 class="font-medium text-heading">
						{t('integrationen.hostedBridge.ownImage.title')}
					</h3>
					{#if paidBy !== 'books'}
						<p class="mt-1 text-text" data-testid="hosted-bridge-own-image-package">
							{t('integrationen.hostedBridge.ownImage.packageLater')}
						</p>
					{:else}
						{#if ownImage}
							<p class="mt-1 text-text" data-testid="hosted-bridge-own-image-built">
								{t('integrationen.hostedBridge.ownImage.built', {
									date: ownImage.builtAt ? when(ownImage.builtAt) : '–'
								})}
							</p>
							<p class="mt-1 font-mono text-xs break-all text-faint">
								{t('integrationen.hostedBridge.ownImage.store')}
								{ownImage.store}
							</p>
							{#if ownImage.plainSha256 !== BRIDGE_BUILDER.plain.sha256}
								<p
									class="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-text"
									role="status"
									data-testid="hosted-bridge-own-image-older"
								>
									{t('integrationen.hostedBridge.ownImage.older')}
								</p>
							{/if}
						{:else}
							<p class="mt-1 text-text">{t('integrationen.hostedBridge.ownImage.none')}</p>
						{/if}
						<button
							type="button"
							class="hover:bg-surface-muted mt-2 min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text disabled:opacity-50"
							disabled={busy || short}
							onclick={build}
							data-testid="hosted-bridge-build-image"
							>{ownImage
								? t('integrationen.hostedBridge.ownImage.rebuild')
								: t('integrationen.hostedBridge.ownImage.build')}</button
						>
						{#if short && reserve}
							<p
								class="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
								data-testid="hosted-bridge-build-reserve"
							>
								{t('integrationen.hostedBridge.ownImage.reserveShort', {
									credits: Math.floor(reserve.credits).toLocaleString(intlLocale()),
									needed: reserve.needed.toLocaleString(intlLocale())
								})}
								<span class="mt-1 flex flex-wrap items-center gap-2">
									<code
										class="font-mono text-xs break-all"
										data-testid="hosted-bridge-build-address">{reserve.address}</code
									>
									<button
										type="button"
										class="hover:bg-surface-muted min-h-8 rounded border border-border px-2 text-xs"
										onclick={() => reserve && copy(reserve.address)}
										>{copied === reserve.address
											? t('integrationen.hostedBridge.copied')
											: t('integrationen.hostedBridge.copy')}</button
									>
								</span>
								<button
									type="button"
									class="mt-1 underline"
									onclick={() => hostedBuildReserve().then((r) => (reserve = r))}
									data-testid="hosted-bridge-build-reserve-check"
									>{t('integrationen.hostedBridge.ownImage.reserveCheck')}</button
								>
							</p>
						{/if}
						<p class="mt-1 text-xs text-faint">{t('integrationen.hostedBridge.ownImage.hint')}</p>
						{#if keepAliveOffered()}
							<label
								class="mt-2 flex items-start gap-2 text-sm text-text"
								data-testid="hosted-bridge-keep-alive"
							>
								<input
									type="checkbox"
									class="mt-1"
									checked={keepAlive}
									onchange={(e) => {
										keepAlive = e.currentTarget.checked;
										setKeepAlive(globalThis.localStorage, keepAlive);
									}}
								/>
								<span
									>{t('keepAlive.label')}
									<span class="block text-xs text-faint"
										>{keepAlive ? t('keepAlive.on') : t('keepAlive.off')}</span
									></span
								>
							</label>
						{/if}
					{/if}
					{#if journeyView}
						<BuildJourney
							view={journeyView}
							text={journeyText}
							locale={intlLocale()}
							builder={BRIDGE_BUILDER}
							links={JOURNEY_LINKS}
							hint={journeyHint}
							uploadHosts={JOURNEY_UPLOAD_TRIES}
							wakeLock={false}
							reason={error}
							onminimize={() => journeyView && (journeyView.minimized = true)}
							onexpand={() => journeyView && (journeyView.minimized = false)}
							onclose={() => (journeyView = null)}
						/>
					{/if}
				</div>
			{/if}
			{#if halfway}
				<p
					class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
					data-testid="hosted-bridge-locked"
				>
					{t('integrationen.hostedBridge.locked')}
				</p>
			{/if}
			<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={start}>
				{#if !halfway}
					<label class="flex min-w-0 flex-1 flex-col text-sm">
						<span class="text-faint">{t('integrationen.hostedBridge.node')}</span>
						{#if nodes === null}
							<span class="mt-1 text-sm text-faint"
								>{t('integrationen.hostedBridge.nodesLoading')}</span
							>
						{:else if nodes.length === 0}
							<span class="mt-1 text-sm text-text">{t('integrationen.hostedBridge.nodesNone')}</span
							>
						{:else}
							<select class="{field} w-full" bind:value={crn} data-testid="hosted-bridge-node">
								{#each nodes as n (n.hash)}
									<option
										value={n.hash}
										data-unverifiable={history.unverifiable[n.hash] ? 'true' : null}
										>{history.unverifiable[n.hash]
											? t('integrationen.hostedBridge.nodeUnverifiable', { name: n.name })
											: n.fits
												? n.name
												: t('integrationen.hostedBridge.nodeTight', { name: n.name })}</option
									>
								{/each}
							</select>
						{/if}
					</label>
				{/if}
				{#if !derivedPassphrase}
					<label class="flex flex-col text-sm">
						<span class="text-faint">{t('integrationen.hostedBridge.passphrase')}</span>
						<input
							class="{field} w-64 max-w-full"
							type="password"
							bind:value={startPassphrase}
							autocomplete="off"
							data-testid="hosted-bridge-start-passphrase"
						/>
					</label>
				{/if}
				<button
					type="submit"
					class={primary}
					disabled={busy ||
						(!derivedPassphrase && !startPassphrase) ||
						(!halfway && !crn) ||
						(!halfway && paidBy === 'lespace' && !credits?.plan)}
					data-testid="hosted-bridge-start"
					>{halfway
						? t('integrationen.hostedBridge.resume')
						: t('integrationen.hostedBridge.start')}</button
				>
			</form>
			<p class="mt-2 text-xs text-faint">
				{halfway
					? t('integrationen.hostedBridge.resumeHint')
					: startsOwn
						? t('integrationen.hostedBridge.ownImage.startHint')
						: t('integrationen.hostedBridge.startHint')}
			</p>
			{#if halfway}
				<!-- A start Aleph has but that never came up (the node failed it, or the tab closed): stop it here. -->
				<button
					type="button"
					class="hover:bg-surface-muted mt-3 min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text disabled:opacity-50"
					disabled={busy}
					onclick={stop}
					data-testid="hosted-bridge-stop">{t('integrationen.hostedBridge.stop')}</button
				>
			{/if}
		{/if}
		{#if busy && (progress || controller)}
			<div class="mt-2 flex flex-wrap items-center gap-3">
				{#if progress}
					<p
						class="min-w-0 flex-1 text-sm break-words text-text"
						data-testid="hosted-bridge-progress"
					>
						{progress}
					</p>
				{/if}
				{#if controller && !building}
					<button
						type="button"
						class="hover:bg-surface-muted min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text"
						onclick={cancel}
						data-testid="hosted-bridge-cancel">{t('integrationen.hostedBridge.cancel')}</button
					>
				{/if}
			</div>
		{/if}
		{#if busy && download}
			<p class="mt-1 text-xs text-faint" data-testid="hosted-bridge-download">{download}</p>
		{/if}
		{#if busy && slow}
			<p class="mt-1 text-xs text-warning" role="status" data-testid="hosted-bridge-slow">
				{t('integrationen.hostedBridge.download.slow')}
			</p>
		{/if}
		{#if notice}
			<p class="mt-2 text-sm text-text" role="status" data-testid="hosted-bridge-notice">
				{notice}
			</p>
		{/if}

		<section class="mt-4 text-sm" data-testid="hosted-bridge-instances">
			<div class="flex flex-wrap items-center gap-3">
				<h3 class="font-medium text-heading">{t('integrationen.hostedBridge.instances.title')}</h3>
				<button
					type="button"
					class="hover:bg-surface-muted min-h-8 rounded border border-border px-2 text-xs text-text disabled:opacity-50"
					disabled={busy}
					onclick={loadInstances}
					data-testid="hosted-bridge-instances-refresh"
					>{t('integrationen.hostedBridge.instances.refresh')}</button
				>
			</div>
			{#if instances === null}
				<p class="mt-1 text-faint">{t('integrationen.hostedBridge.instances.loading')}</p>
			{:else if instancesError}
				<p class="mt-1 text-danger">{t('integrationen.hostedBridge.instances.error')}</p>
			{:else if instances.length === 0}
				<p class="mt-1 text-faint">{t('integrationen.hostedBridge.instances.none')}</p>
			{:else}
				<ul class="mt-2 space-y-2">
					{#each instances as i (i.hash)}
						<li
							class="rounded-md border border-border px-3 py-2"
							data-testid="hosted-bridge-instance-item"
							data-hash={i.hash}
						>
							<div class="flex flex-wrap items-center gap-x-2">
								<code class="font-mono text-xs break-all text-text">{i.hash}</code>
								{#if i.known}
									<span
										class="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success"
										data-testid="hosted-bridge-instance-known"
										>{t('integrationen.hostedBridge.instances.known')}</span
									>
								{/if}
							</div>
							<p class="mt-1 text-xs text-faint">
								{#if i.createdAt}{t('integrationen.hostedBridge.instances.created', {
										date: when(i.createdAt)
									})}{/if}
								{#if i.nodeName || i.crn}
									· {t('integrationen.hostedBridge.node')}:
									{i.nodeName ?? i.crn?.slice(0, 12)}
								{/if}
								{#if i.nodeUrl}
									· <span class="font-mono break-all">{i.nodeUrl}</span>
								{/if}
							</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<button
									type="button"
									class="hover:bg-surface-muted min-h-9 rounded border border-border px-3 text-xs text-text"
									onclick={() => copy(i.hash)}
									data-testid="hosted-bridge-instance-copy"
									>{copied === i.hash
										? t('integrationen.hostedBridge.copied')
										: t('integrationen.hostedBridge.copy')}</button
								>
								<button
									type="button"
									class="hover:bg-surface-muted min-h-9 rounded border border-border px-3 text-xs text-text disabled:opacity-50"
									disabled={busy}
									onclick={() => pick(i.hash)}
									data-testid="hosted-bridge-instance-pick"
									>{t('integrationen.hostedBridge.instances.pick')}</button
								>
								<button
									type="button"
									class="hover:bg-surface-muted min-h-9 rounded border border-border px-3 text-xs text-text disabled:opacity-50"
									disabled={busy}
									onclick={() => stopListed(i.hash)}
									data-testid="hosted-bridge-instance-stop"
									>{t('integrationen.hostedBridge.stop')}</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<details class="mt-4 text-sm" data-testid="hosted-bridge-existing" bind:open={existingOpen}>
			<summary class="cursor-pointer text-text underline"
				>{t('integrationen.hostedBridge.existing')}</summary
			>
			<form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={unlock}>
				<label class="flex min-w-0 flex-1 flex-col text-sm">
					<span class="text-faint">{t('integrationen.hostedBridge.instance')}</span>
					<input
						class="{field} w-full"
						bind:value={instance}
						autocomplete="off"
						spellcheck="false"
						data-testid="hosted-bridge-instance"
					/>
				</label>
				<label class="flex flex-col text-sm">
					<span class="text-faint">{t('integrationen.hostedBridge.passphrase')}</span>
					<input
						class="{field} w-64 max-w-full"
						type="password"
						bind:value={passphrase}
						autocomplete="off"
						data-testid="hosted-bridge-passphrase"
					/>
				</label>
				<button
					type="submit"
					class={primary}
					disabled={busy || !/^[0-9a-f]{64}$/.test(instance.trim()) || !passphrase}
					data-testid="hosted-bridge-unlock">{t('integrationen.hostedBridge.unlock')}</button
				>
			</form>
			<p class="mt-2 text-xs text-faint">{t('integrationen.hostedBridge.hint')}</p>
		</details>
	{:else if paused}
		<p class="mt-3 text-sm text-text" role="status" data-testid="hosted-bridge-paused">
			{t('integrationen.hostedBridge.paused')}
			{#if running}{t('integrationen.hostedBridge.pausedRunning')}{/if}
		</p>
	{:else}
		<p class="mt-3 text-sm text-text">{t('messages.bridge.needsSync')}</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="hosted-bridge-error">{error}</p>
		{#if errorDetail}
			<TechnicalNote
				class="mt-2"
				testid="hosted-bridge-error-detail"
				lines={[t('integrationen.hostedBridge.errorDetail', { detail: errorDetail })]}
			/>
		{/if}
	{/if}
</section>
