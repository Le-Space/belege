<script>
	// The clock top right, beside the gear (#967): the Verlauf, one click from
	// every page – what the app did on its own and what the person decided.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { t } from './i18n/index.js';

	const href = resolve('/verlauf');
	let active = $derived(page.url.pathname.startsWith(href));
</script>

<a
	{href}
	class="rounded-full p-2 text-text transition hover:bg-surface hover:text-heading focus:ring-2 focus:ring-cyan focus:outline-none {active
		? 'bg-surface text-heading'
		: ''}"
	aria-label={t('header.verlauf')}
	title={t('header.verlauf')}
	aria-current={active ? 'page' : undefined}
	data-testid="header-verlauf"
>
	<svg
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"
		></path></svg
	>
</a>
