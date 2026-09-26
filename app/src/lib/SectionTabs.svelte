<script>
	// The tab bar, after Le-Space/simple-todo apps/escrow01 (src/lib/SectionTabs.svelte)
	// at f0d3df4. At the foot of the screen on a phone, where a thumb reaches
	// it, and under the header on anything wider. One element for both places,
	// so a screen reader and a test find one set of tabs, not two.
	//
	// Changed: real routes rather than fragments — belege's pages are routes,
	// and the session lives in a module, so a navigation keeps it — and five
	// tabs.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { t } from './i18n/index.js';
	import SectionIcon from './SectionIcon.svelte';
	import { extractRun } from './receipts/extract-queue.svelte.js';

	const TABS = /** @type {const} */ ([
		{ href: '/', icon: 'home', label: 'nav.home' },
		{ href: '/zahlungen', icon: 'zahlungen', label: 'nav.zahlungen' },
		{ href: '/belege', icon: 'belege', label: 'nav.belege' },
		{ href: '/export', icon: 'export', label: 'nav.export' },
		{ href: '/integrationen', icon: 'integrationen', label: 'nav.integrationen' }
	]);
</script>

<nav
	aria-label={t('nav.label')}
	data-testid="section-tabs"
	class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:mb-6 sm:border-t-0 sm:border-b sm:bg-transparent sm:pb-0"
>
	<ul class="mx-auto grid max-w-5xl grid-cols-5 sm:flex sm:gap-1">
		{#each TABS as tab (tab.href)}
			{@const active = page.url.pathname === tab.href}
			<li class="min-w-0">
				<a
					href={resolve(tab.href)}
					aria-current={active ? 'page' : undefined}
					data-testid={`tab-${tab.icon}`}
					data-active={active}
					class="flex flex-col items-center gap-0.5 rounded-md px-0.5 py-2 text-[11px] font-medium tracking-tight no-underline outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:-mb-px sm:flex-row sm:gap-2 sm:rounded-none sm:border-b-2 sm:px-3 sm:py-2.5 sm:text-sm sm:tracking-normal {active
						? 'text-cyan-800 sm:border-cyan-800 dark:text-cyan dark:sm:border-cyan'
						: 'text-text hover:text-heading sm:border-transparent'}"
				>
					<SectionIcon name={tab.icon} />
					<span class="max-w-full truncate">{t(tab.label)}</span>
					{#if tab.icon === 'belege' && extractRun.progress}
						<span
							class="rounded bg-surface-2 px-1 font-mono text-[10px] text-text tabular-nums sm:text-xs"
							title={t('belege.extracting', {
								done: extractRun.progress.done,
								count: extractRun.progress.count
							})}
							data-testid="tab-extract-progress"
							>{extractRun.progress.done}/{extractRun.progress.count}</span
						>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
