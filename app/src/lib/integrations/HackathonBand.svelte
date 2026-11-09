<script>
	// The hackathon wristband (as on eigenbeleg.le-space.de, eigenbeleg-agent
	// e27db61): flies in from the right once, swings out, hangs slightly askew
	// at the top right. Closing it is a per-browser convenience, remembered in
	// localStorage (nothing secret). Narrower than 64rem it sits in the flow
	// above the card and does not fly.
	import { t } from '$lib/i18n/index.js';

	const KEY = 'hackathon';
	let closed = $state(true);
	try {
		closed = globalThis.localStorage?.getItem(KEY) === 'closed';
	} catch {
		closed = false;
	}

	function close() {
		closed = true;
		try {
			globalThis.localStorage?.setItem(KEY, 'closed');
		} catch {
			// then it comes back next time
		}
	}
</script>

{#if !closed}
	<aside class="band" data-testid="hackathon-band">
		<div class="t">
			<!-- The N is NEAR's mark (docs.near.org), unchanged, used to name the event; it is NEAR's trademark, not under this repository's licence. -->
			<svg class="n" viewBox="0 0 639 639" aria-hidden="true"
				><path
					d="m457.61,144c-13,0-25.07,6.74-31.88,17.82l-73.37,108.93c-2.39,3.59-1.42,8.43,2.17,10.82,2.91,1.94,6.76,1.7,9.41-.58l72.22-62.64c1.2-1.08,3.05-.97,4.13.23.49.55.75,1.26.75,1.99v196.12c0,1.62-1.31,2.92-2.93,2.92-.87,0-1.69-.38-2.24-1.05L217.56,157.24c-7.11-8.39-17.55-13.23-28.54-13.24h-7.63c-20.65,0-37.39,16.74-37.39,37.39v276.22c0,20.65,16.74,37.39,37.39,37.39,13,0,25.07-6.74,31.88-17.82l73.37-108.93c2.39-3.59,1.42-8.43-2.17-10.82-2.91-1.94-6.76-1.7-9.41.58l-72.22,62.64c-1.2,1.08-3.05.97-4.13-.23-.49-.55-.75-1.26-.74-1.99v-196.17c0-1.62,1.31-2.92,2.93-2.92.86,0,1.69.38,2.24,1.05l218.28,261.37c7.11,8.39,17.55,13.23,28.54,13.24h7.63c20.65.01,37.4-16.72,37.42-37.37V181.39c0-20.65-16.74-37.39-37.39-37.39Z"
				/></svg
			>
			<span>{t('integrationen.hostedBridge.band.title')}</span>
		</div>
		<p>{t('integrationen.hostedBridge.band.text')}</p>
		<small>{t('integrationen.hostedBridge.band.small')}</small>
		<button
			type="button"
			aria-label={t('integrationen.hostedBridge.band.close')}
			onclick={close}
			data-testid="hackathon-close">✕</button
		>
	</aside>
{/if}

<style>
	/* NEAR's colours (black, #00ec97). */
	.band {
		position: fixed;
		right: 0;
		top: 1.5rem;
		z-index: 5;
		width: 19rem;
		max-width: calc(100vw - 2rem);
		color: #fff;
		background: #0b0f0d;
		border-radius: 10px 0 0 10px;
		box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
		padding: 0.85rem 2.4rem 0.85rem 1.3rem;
		font-size: 0.85rem;
		line-height: 1.35;
		transform-origin: 95% 0;
		animation:
			band-in 1.2s cubic-bezier(0.2, 0.9, 0.25, 1.1) both,
			band-swing 1.6s 1.1s ease-in-out both;
	}
	.band::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 7px;
		background: #00ec97;
		border-radius: 10px 0 0 10px;
	}
	.t {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		font-size: 1.05rem;
		letter-spacing: -0.01em;
		margin-bottom: 0.3rem;
	}
	.n {
		width: 1.4rem;
		height: 1.4rem;
		fill: #00ec97;
		flex: none;
	}
	p {
		margin: 0;
	}
	small {
		display: block;
		margin-top: 0.4rem;
		color: #b9c3bd;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.68rem;
		letter-spacing: 0.04em;
	}
	button {
		position: absolute;
		right: 0.5rem;
		top: 0.45rem;
		background: none;
		border: none;
		color: #b9c3bd;
		font-size: 0.9rem;
		line-height: 1;
		padding: 0.3rem 0.45rem;
		border-radius: 6px;
		cursor: pointer;
	}
	button:hover,
	button:focus-visible {
		color: #fff;
		outline: 2px solid #00ec97;
		outline-offset: 1px;
	}
	@keyframes band-in {
		from {
			transform: translateX(120%) rotate(-18deg);
		}
		70% {
			transform: translateX(-6px) rotate(3deg);
		}
		to {
			transform: translateX(0) rotate(-3deg);
		}
	}
	@keyframes band-swing {
		0% {
			transform: rotate(-3deg);
		}
		30% {
			transform: rotate(1.5deg);
		}
		60% {
			transform: rotate(-1deg);
		}
		100% {
			transform: rotate(-2deg);
		}
	}
	/* Where it would cover the text, it sits in the flow above the card instead, and does not fly. */
	@media (max-width: 64rem) {
		.band {
			position: static;
			width: auto;
			max-width: none;
			margin: 0 0 1rem;
			border-radius: 10px;
			animation: none;
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.band {
			animation: none;
			transform: rotate(-2deg);
		}
	}
</style>
