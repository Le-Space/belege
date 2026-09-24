<script>
	// After Le-Space/simple-todo packages/ui (src/AppFooter.svelte) at f0d3df4.
	// Changed: the commit links to this repository; a "Quellcode" link, to this
	// repository as well (never to a tool the app uses); and the way back to the
	// consent screen.
	//
	// "Gebaut mit [mark] Le Space" is the brand's signature line: the mark's
	// local node drawn as a heart (the credit variant from le-space/landing,
	// `docs/le-space-brand/logo/svg/le-space-mark-heart-*.svg`), in the
	// `--coral`/`--cyan` tokens so it follows the theme. 22 px is the variant's
	// minimum. Mark and name are one link, named by its text. The heart belongs
	// here only; the header keeps the round-node mark.
	//
	// Then what is deployed: the commit and its instant, in the reader's locale,
	// clock and zone, UTC on hover (the Le-Space time and date convention).
	import { builtFrom, SOURCE_URL } from './build-info.js';
	import { consent } from './consent.js';
	import { t } from './i18n/index.js';
	import { describeMoment } from './moment.js';

	const build = builtFrom();
	// Formatted here, in the browser: only the reader's browser knows their
	// locale, clock and zone.
	const moment = build ? describeMoment(build.when) : null;
</script>

<footer class="mt-10 border-t border-border pt-4 pb-2 text-xs text-faint" data-testid="app-footer">
	<p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
		<span>{t('footer.madeWith')}</span>
		<a
			href="https://le-space.de"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1 text-text hover:text-heading"
			data-testid="le-space-credit"
		>
			<svg
				viewBox="0 0 96 96"
				width="22"
				height="22"
				aria-hidden="true"
				class="flex-none"
				data-testid="le-space-credit-mark"
			>
				<line
					x1="42.7"
					y1="49.96"
					x2="58.56"
					y2="34.94"
					stroke="var(--cyan)"
					stroke-width="4"
					stroke-linecap="round"
				/>
				<line
					x1="47.43"
					y1="63.58"
					x2="62.8"
					y2="64.98"
					stroke="var(--cyan)"
					stroke-width="4"
					stroke-linecap="round"
					stroke-dasharray="0.1 8"
				/>
				<line
					x1="69.85"
					y1="38.36"
					x2="72.41"
					y2="55.37"
					stroke="var(--cyan)"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-dasharray="0.1 6"
					opacity="0.65"
				/>
				<path
					d="M 0.5 0.96 C 0.19 0.74 0 0.55 0 0.36 A 0.25 0.25 0 0 1 0.5 0.26 A 0.25 0.25 0 0 1 1 0.36 C 1 0.55 0.81 0.74 0.5 0.96 Z"
					transform="translate(15,47) scale(30)"
					fill="var(--coral)"
				/>
				<circle cx="68" cy="26" r="8" fill="none" stroke="var(--cyan)" stroke-width="5" />
				<circle cx="74" cy="66" r="6.5" fill="none" stroke="var(--cyan)" stroke-width="4.5" />
				<circle cx="17" cy="21" r="2.6" fill="var(--cyan)" opacity="0.55" />
			</svg>
			<span class="underline">Le Space</span>
		</a>
		{#if build && moment}
			<span aria-hidden="true">·</span>
			<span data-testid="build-stamp"
				>{t('footer.build')}
				<time datetime={moment.datetime} title={moment.utc}>{moment.local}</time>
				<a
					href="{SOURCE_URL}/commit/{build.commit}"
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-text underline hover:text-heading">{build.short}</a
				></span
			>
		{/if}
		<span aria-hidden="true">·</span>
		<a
			href={SOURCE_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="text-text underline hover:text-heading"
			data-testid="source-link">{t('footer.source')}</a
		>
		<span aria-hidden="true">·</span>
		<button
			type="button"
			class="text-text underline hover:text-heading"
			onclick={() => consent.reopen()}
			data-testid="consent-reopen">{t('footer.privacy')}</button
		>
	</p>
</footer>
