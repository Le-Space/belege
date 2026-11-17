<script>
	// The build of the books' own bridge image (#777) as an event of its own, as
	// Paperless anywhere shows its first start: a full-screen view with five
	// stations, the picture of what flows where, the time left and when it ends.
	// It can shrink to a slim bar. While it runs the screen stays on and, on a
	// phone, a soft tone keeps the tab awake (both held by the card), leaving
	// the page asks first, and the tab's title carries the progress. At the
	// end: "Geschafft". Everything shown is what the build reported
	// (build-journey.js withFacts); nothing is interpreted.
	import { onDestroy } from 'svelte';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { keepAliveOffered, keepAliveWanted } from '$lib/keep-alive.js';
	import {
		STATIONS,
		fetchPercent,
		fetchRate,
		flowNow,
		journey,
		substeps
	} from './build-journey.js';

	/**
	 * @type {{
	 *   view: { station: string, since: number, done: boolean, failed: boolean, minimized: boolean, facts: import('./build-journey.js').Facts },
	 *   reason?: string | null,
	 *   onminimize: () => void,
	 *   onexpand: () => void,
	 *   onclose: () => void
	 * }}
	 */
	let { view, reason = null, onminimize, onexpand, onclose } = $props();

	const k = (/** @type {string} */ key, /** @type {Record<string, string | number>} */ v = {}) =>
		t(`integrationen.hostedBridge.journey.${key}`, v);

	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	const facts = $derived(view.facts ?? {});
	const j = $derived(
		journey({ station: view.station, since: view.since, now, facts, done: view.done })
	);
	const pct = $derived(Math.round(j.share * 100));
	const running = $derived(!view.done && !view.failed);
	const stations = $derived(
		STATIONS.map((s, i) => ({
			key: s.key,
			n: i + 1,
			done: view.done || i < j.index,
			active: !view.done && i === j.index
		}))
	);
	const steps = $derived(substeps(view.station, facts, view.done));
	const flow = $derived(flowNow(view.station, facts));
	const fetched = $derived(view.station === 'fetch' ? fetchPercent(facts) : null);
	const rate = $derived(fetchRate(facts, now));
	const minutes = (/** @type {number} */ s) => Math.max(1, Math.round(s / 60));
	const ends = $derived(
		new Date(j.ends).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
	);
	const mib = (/** @type {number} */ b) => Math.round(b / 1048576);
	/** What a small step adds: connections checked, bytes and speed of the fetch. @param {string} key */
	const extra = (key) => {
		if (key === 'lanes' && facts.attested) return String(facts.attested);
		if (key !== 'bytes' || !facts.size) return '';
		const amount = k('mib', { got: mib(facts.got ?? 0), size: mib(facts.size) });
		return rate
			? `${amount} · ${k('rate', { rate: rate.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) })}`
			: amount;
	};
	const short = (/** @type {string} */ v) =>
		v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v;
	const proofs = $derived(
		/** @type {[string, string | undefined][]} */ ([
			['measurement', facts.measurement],
			['plain', facts.plainSha256],
			['cid', facts.cid],
			['store', facts.storeHash]
		]).filter(([, v]) => Boolean(v))
	);

	// The picture: where each place sits, and the path the data takes now.
	/** @type {Record<string, [number, number]>} */
	const AT = { browser: [100, 120], relay: [360, 44], builder: [620, 120], aleph: [360, 196] };
	const LINKS = [
		['browser', 'relay'],
		['relay', 'builder'],
		['browser', 'aleph'],
		['aleph', 'builder']
	];
	const pathD = $derived(
		flow.path.map((p, i) => `${i ? 'L' : 'M'}${AT[p][0]} ${AT[p][1]}`).join(' ')
	);
	const onPath = (/** @type {string} */ a, /** @type {string} */ b) =>
		flow.path.some(
			(p, i) =>
				i > 0 && ((flow.path[i - 1] === a && p === b) || (flow.path[i - 1] === b && p === a))
		);

	// The screen stays on and, on a phone, a soft tone keeps the tab awake:
	// both held by the card from the click (wake-lock.js, keep-alive.js). Here:
	// on a phone, say to stay; and when the page was away, say for how long.
	const phone = keepAliveOffered();
	const tone = phone && keepAliveWanted(globalThis.localStorage);
	let hiddenAt = 0;
	let away = $state(0);
	$effect(() => {
		if (!running) return;
		const seen = () => {
			if (document.visibilityState === 'hidden') hiddenAt = Date.now();
			else if (hiddenAt) {
				const s = Math.round((Date.now() - hiddenAt) / 1000);
				hiddenAt = 0;
				if (s >= 5) away = s;
			}
		};
		document.addEventListener('visibilitychange', seen);
		return () => document.removeEventListener('visibilitychange', seen);
	});
	// Leaving the page would stop the build: the browser asks first.
	$effect(() => {
		if (!running) return;
		const ask = (/** @type {BeforeUnloadEvent} */ e) => {
			e.preventDefault();
			e.returnValue = '';
			return '';
		};
		window.addEventListener('beforeunload', ask);
		return () => window.removeEventListener('beforeunload', ask);
	});
	// The tab's title carries the progress, and gets its own back afterwards.
	const before = typeof document === 'undefined' ? '' : document.title;
	$effect(() => {
		document.title = running ? k('tab', { pct }) : before;
	});
	onDestroy(() => {
		if (typeof document !== 'undefined') document.title = before;
	});
</script>

{#if view.minimized && running}
	<div class="mini" role="status" data-testid="build-journey-mini">
		<span class="dot pulse" aria-hidden="true"></span>
		<strong>{k(`stations.${view.station}.label`)}</strong>
		<span class="bar"><span class="fill shimmer" style="width: {pct}%"></span></span>
		<span>{pct} % · {k('left', { minutes: minutes(j.left) })}</span>
		<button type="button" onclick={onexpand} data-testid="build-journey-expand"
			>{k('expand')}</button
		>
	</div>
{:else}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="build-journey-title"
		data-testid="build-journey"
		data-station={view.station}
	>
		{#if view.done}
			<div class="finale" data-testid="build-journey-done">
				<div class="big pop" aria-hidden="true">
					<span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"
					></span><span class="spark s4"></span>
					<span class="spin ring"></span>
					<svg
						width="52"
						height="52"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg
					>
				</div>
				<h2 id="build-journey-title">{k('doneTitle')}</h2>
				<p>{k('doneText')}</p>
				{#if proofs.length}
					<ul class="proofs-inline">
						{#each proofs as [key, value] (key)}
							<li>
								<span class="led on" aria-hidden="true"></span>
								{k(`evidence.${key}`)} <code>{short(String(value))}</code>
							</li>
						{/each}
					</ul>
				{/if}
				<button type="button" class="cta" onclick={onclose} data-testid="build-journey-close"
					>{k('close')}</button
				>
			</div>
		{:else}
			<div class="journey">
				<div class="top">
					<div>
						<p class="kicker">{k('kicker')}</p>
						<h2 id="build-journey-title">{k('title')}</h2>
					</div>
					{#if running}
						<button
							type="button"
							class="ghost"
							onclick={onminimize}
							data-testid="build-journey-minimize">{k('minimize')}</button
						>
					{:else}
						<button type="button" class="ghost" onclick={onclose} data-testid="build-journey-close"
							>{k('close')}</button
						>
					{/if}
				</div>
				<ol class="stations">
					{#each stations as s (s.key)}
						<li
							class:done={s.done}
							class:active={s.active}
							aria-current={s.active ? 'step' : undefined}
							data-testid="build-station-{s.key}"
							data-state={s.done ? 'done' : s.active ? 'active' : 'next'}
						>
							<span class="circle" class:pulse={s.active && running}>
								{#if s.done}<svg
										width="26"
										height="26"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.6"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg
									>
								{:else}{s.n}{/if}
								{#if s.active && running}<span class="spin ring" aria-hidden="true"></span>{/if}
							</span>
							<span class="label">{k(`stations.${s.key}.label`)}</span>
							<span class="dur">{k(`stations.${s.key}.duration`)}</span>
						</li>
					{/each}
				</ol>
				<div class="grid">
					<div class="col">
						<div class="now" aria-live="polite">
							<p class="step">
								{#if view.failed}
									{k('stoppedAt', {
										n: j.index + 1,
										station: k(`stations.${view.station}.label`)
									})}
								{:else}
									{k('step', { n: j.index + 1, of: STATIONS.length })} · {k(
										`stations.${view.station}.duration`
									)}
								{/if}
							</p>
							{#if view.failed}
								<h3>{k('failedTitle')}</h3>
								{#if reason}
									<p class="reason" role="alert" data-testid="build-journey-reason">{reason}</p>
								{/if}
								<p>{k('failedText')}</p>
							{:else}
								<h3 data-testid="build-journey-stage">{k(`stations.${view.station}.title`)}</h3>
								<p>{k(`stations.${view.station}.text`)}</p>
								<ul class="subs">
									{#each steps as st (st.key)}
										<li class={st.state}>
											<span
												class="led"
												class:on={st.state === 'done'}
												class:blink={st.state === 'active' && running}
												aria-hidden="true"
											></span>
											<span
												>{k(`sub.${st.key}`)}{#if extra(st.key)}<small class="extra"
														>{extra(st.key)}</small
													>{/if}</span
											>
										</li>
									{/each}
								</ul>
								{#if fetched != null}
									<span class="bar big-bar"
										><span class="fill gold shimmer" style="width: {fetched}%"></span></span
									>
								{/if}
							{/if}
						</div>
						{#if running}
							<figure class="flow" data-testid="build-journey-flow">
								<figcaption>
									{k('flowTitle')}:
									<strong>{k(`flow.${flow.what}`)}</strong>{#if flow.share != null}<span
											class="extra">{Math.round(flow.share * 100)} %</span
										>{/if}
								</figcaption>
								<svg
									viewBox="0 0 720 250"
									role="img"
									aria-label="{k('flowTitle')}: {k(`flow.${flow.what}`)}"
								>
									{#each LINKS as [a, b] (a + b)}
										<line
											x1={AT[a][0]}
											y1={AT[a][1]}
											x2={AT[b][0]}
											y2={AT[b][1]}
											class:hot={onPath(a, b)}
										/>
									{/each}
									{#key pathD}
										{#each [0, 0.6, 1.2] as delay (delay)}
											<circle r="6" class="packet" opacity="0"
												><set attributeName="opacity" to="1" begin="{delay}s" /><animateMotion
													dur="1.8s"
													begin="{delay}s"
													repeatCount="indefinite"
													path={pathD}
												/></circle
											>
										{/each}
									{/key}
									{#each Object.entries(AT) as [p, [cx, cy]] (p)}
										<g class="place" class:hot={flow.path.includes(p)}>
											<rect x={cx - 86} y={cy - 18} width="172" height="36" rx="10" />
											<circle
												cx={cx - 70}
												{cy}
												r="5"
												class="lamp"
												class:blink={flow.path.includes(p)}
											/>
											<text x={cx - 58} y={cy + 5}>{k(`places.${p}`)}</text>
										</g>
									{/each}
								</svg>
							</figure>
						{/if}
					</div>
					<aside class="proofs" data-testid="build-journey-evidence">
						<h4>{k('evidenceTitle')}</h4>
						{#if proofs.length}
							<ul>
								{#each proofs as [key, value] (key)}
									<li class="pop">
										<span class="led on" aria-hidden="true"></span>
										<span class="what">{k(`evidence.${key}`)}</span>
										<code>{short(String(value))}</code>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="small">{running ? k('evidenceNone') : k('evidenceNoneStopped')}</p>
						{/if}
					</aside>
				</div>
				{#if running}<div class="total">
						<p class="row between">
							<strong data-testid="build-journey-share">{k('share', { pct })}</strong>
							<span>{k('left', { minutes: minutes(j.left) })} · {k('endsAt', { time: ends })}</span>
						</p>
						<span class="bar"><span class="fill shimmer" style="width: {pct}%"></span></span>
						{#if away}
							<p class="warn" role="status" data-testid="build-journey-away">
								{k('cameBack', { seconds: away })}
							</p>
						{/if}
						{#if phone}
							<p class="small" data-testid="build-journey-phone">
								{k('phone')}{#if tone}<br />{k('phoneTone')}{/if}
							</p>
						{/if}
						<p class="small">{k('keepOpen')}</p>
					</div>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow-y: auto;
		background: #0f2a2e;
		color: #f6f2ea;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: clamp(1rem, 4vw, 3rem) 1rem;
	}
	.journey,
	.finale {
		width: 100%;
		max-width: 68rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.kicker {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5eead4;
	}
	h2,
	h3 {
		color: #f6f2ea;
	}
	h2 {
		margin: 0.4rem 0 0;
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		line-height: 1.1;
		font-weight: 700;
	}
	h3 {
		margin: 0;
		font-size: clamp(1.4rem, 3vw, 1.9rem);
		font-weight: 600;
	}
	.ghost {
		padding: 0.6rem 1.1rem;
		min-height: 2.75rem;
		border-radius: 999px;
		border: 1px solid rgba(246, 242, 234, 0.35);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.stations {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.75rem;
	}
	@media (max-width: 640px) {
		.stations {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			row-gap: 1.25rem;
		}
	}
	.stations li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}
	.circle {
		position: relative;
		width: 4rem;
		height: 4rem;
		border-radius: 50%;
		border: 2px solid rgba(246, 242, 234, 0.25);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.2rem;
		color: rgba(246, 242, 234, 0.65);
	}
	.active .circle {
		background: #f6f2ea;
		color: #0f2a2e;
		border-color: #f6f2ea;
	}
	.done .circle {
		background: #0f766e;
		border-color: #0f766e;
		color: #f6f2ea;
		animation: pop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.ring {
		position: absolute;
		inset: -7px;
		border-radius: 50%;
		border: 2px dashed #5eead4;
	}
	.label {
		font-weight: 600;
	}
	.dur {
		font-size: 0.8rem;
		color: rgba(246, 242, 234, 0.7);
	}
	.now {
		background: rgba(246, 242, 234, 0.06);
		border: 1px solid rgba(246, 242, 234, 0.14);
		border-radius: 20px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.now p {
		margin: 0;
		line-height: 1.55;
		max-width: 48rem;
		color: rgba(246, 242, 234, 0.9);
	}
	.now .step {
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #f5c76b;
	}
	.total {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.led {
		display: inline-block;
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: rgba(246, 242, 234, 0.2);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
	}
	.led.on {
		background: #34d399;
		box-shadow: 0 0 8px #34d399;
	}
	.led.blink {
		background: #f5c76b;
		box-shadow: 0 0 10px #f5c76b;
		animation: blink 0.9s steps(2, start) infinite;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}
	@media (max-width: 860px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}
	.subs {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.subs li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.6rem;
		align-items: baseline;
		color: rgba(246, 242, 234, 0.9);
	}
	.subs li.next {
		color: rgba(246, 242, 234, 0.5);
	}
	.subs small {
		color: #f5c76b;
	}
	.extra::before {
		content: ' · ';
		color: rgba(246, 242, 234, 0.5);
	}
	.flow {
		margin: 0;
		background: rgba(246, 242, 234, 0.04);
		border: 1px solid rgba(246, 242, 234, 0.12);
		border-radius: 20px;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.flow figcaption {
		font-size: 0.9rem;
		color: rgba(246, 242, 234, 0.85);
	}
	.flow svg {
		width: 100%;
		height: auto;
	}
	.flow line {
		stroke: rgba(246, 242, 234, 0.15);
		stroke-width: 2;
		stroke-dasharray: 4 6;
	}
	.flow line.hot {
		stroke: rgba(94, 234, 212, 0.55);
		stroke-dasharray: none;
	}
	.flow .packet {
		fill: #f5c76b;
		filter: drop-shadow(0 0 4px #f5c76b);
	}
	.place rect {
		fill: #133a3f;
		stroke: rgba(246, 242, 234, 0.2);
	}
	.place.hot rect {
		stroke: #5eead4;
	}
	.place text {
		fill: #f6f2ea;
		font-size: 13px;
		font-weight: 600;
	}
	.lamp {
		fill: rgba(246, 242, 234, 0.25);
	}
	.lamp.blink {
		fill: #34d399;
		animation: blink 0.9s steps(2, start) infinite;
	}
	.proofs {
		background: rgba(246, 242, 234, 0.04);
		border: 1px solid rgba(246, 242, 234, 0.12);
		border-radius: 20px;
		padding: 1.1rem 1.25rem;
		min-width: 0;
	}
	.proofs h4 {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5eead4;
	}
	.proofs ul,
	.proofs-inline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.55rem;
	}
	.proofs li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.55rem;
		align-items: baseline;
		font-size: 0.85rem;
	}
	.proofs li > code {
		grid-column: 2;
	}
	.proofs .what {
		color: rgba(246, 242, 234, 0.8);
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
		color: #5eead4;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
	}
	.between {
		justify-content: space-between;
	}
	.reason {
		padding: 0.75rem 1rem;
		border-radius: 12px;
		background: rgba(248, 113, 113, 0.14);
		border: 1px solid rgba(248, 113, 113, 0.4);
		color: #fecaca !important;
	}
	.warn {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 12px;
		background: rgba(245, 199, 107, 0.15);
		color: #f5c76b;
		font-size: 0.9rem;
	}
	.small {
		margin: 0;
		font-size: 0.85rem;
		color: rgba(246, 242, 234, 0.72);
	}
	.bar {
		display: block;
		height: 10px;
		border-radius: 999px;
		background: rgba(246, 242, 234, 0.15);
		overflow: hidden;
	}
	.big-bar {
		height: 14px;
		max-width: 48rem;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background-color: #5eead4;
		transition: width 1s ease;
	}
	.fill.gold {
		background-color: #f5c76b;
	}
	.finale {
		align-items: center;
		text-align: center;
		max-width: 44rem;
		padding-top: 3rem;
	}
	.finale p {
		margin: 0;
		line-height: 1.55;
		color: rgba(246, 242, 234, 0.9);
	}
	.proofs-inline {
		text-align: left;
		font-size: 0.85rem;
	}
	.big {
		position: relative;
		width: 7rem;
		height: 7rem;
		border-radius: 50%;
		background: #0f766e;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
	}
	.big .ring {
		inset: -10px;
		border: 3px dashed #f5c76b;
	}
	.cta {
		padding: 0.8rem 1.5rem;
		min-height: 2.75rem;
		border-radius: 999px;
		background: #f6f2ea;
		color: #0f2a2e;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}
	.mini {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 40;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		padding: 0.7rem 1.25rem;
		background: #0f3d3a;
		color: #f6f2ea;
	}
	.mini .bar {
		flex: 1 1 10rem;
		height: 6px;
		min-width: 6rem;
	}
	.mini button {
		padding: 0.4rem 0.9rem;
		min-height: 2.75rem;
		border-radius: 999px;
		border: 1px solid #5eead4;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: #5eead4;
	}
	.spark {
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		bottom: 0;
		animation: rise 2.4s ease-out infinite;
	}
	.s1 {
		left: -2.5rem;
		background: #5eead4;
	}
	.s2 {
		left: 1rem;
		background: #f5c76b;
		animation-delay: 0.5s;
	}
	.s3 {
		right: 1rem;
		background: #5eead4;
		animation-delay: 1s;
	}
	.s4 {
		right: -2.5rem;
		background: #f5c76b;
		animation-delay: 1.5s;
	}
	.pulse {
		animation: pulse 1.8s ease-out infinite;
	}
	.spin {
		animation: spin 6s linear infinite;
	}
	.pop {
		animation: pop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.shimmer {
		background-image: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0) 0,
			rgba(255, 255, 255, 0.45) 50%,
			rgba(255, 255, 255, 0) 100%
		);
		background-size: 200px 100%;
		background-repeat: no-repeat;
		animation: shimmer 1.6s linear infinite;
	}
	@keyframes blink {
		to {
			opacity: 0.25;
		}
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.5);
		}
		70% {
			box-shadow: 0 0 0 18px rgba(94, 234, 212, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(94, 234, 212, 0);
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes pop {
		0% {
			transform: scale(0.6);
			opacity: 0;
		}
		60% {
			transform: scale(1.08);
			opacity: 1;
		}
		100% {
			transform: scale(1);
		}
	}
	@keyframes shimmer {
		0% {
			background-position: -200px 0;
		}
		100% {
			background-position: 200px 0;
		}
	}
	@keyframes rise {
		0% {
			transform: translateY(0);
			opacity: 1;
		}
		100% {
			transform: translateY(-140px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse,
		.spin,
		.pop,
		.shimmer,
		.done .circle,
		.led.blink,
		.lamp.blink {
			animation: none;
		}
		.packet,
		.spark {
			display: none;
		}
		.fill {
			transition: none;
		}
	}
</style>
