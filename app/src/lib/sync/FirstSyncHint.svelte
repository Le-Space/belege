<script>
	// The books come by sync (a member who just joined, a new own device): until
	// the first entries are in, the lists are empty. OrbitDB shows a database
	// only once it has the whole chain, so this says what is going on instead of
	// "no payments yet".
	import { app } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';

	/** Other devices the books know, and those connected now. */
	const known = $derived((app.sync.state?.devices ?? []).filter((d) => !d.bridge));
	const connected = $derived(known.filter((d) => d.connected).length);
	/** When anything last came in from another device (ms), for "zuletzt". */
	const lastIn = $derived(Math.max(0, ...Object.values(app.sync.lastIn ?? {}).map(Number)));
	const when = (/** @type {number} */ at) =>
		new Intl.DateTimeFormat(intlLocale(), { timeStyle: 'short' }).format(new Date(at));
</script>

{#if app.sync.online && known.length}
	<div
		class="mt-6 rounded-lg border border-cyan-800/40 bg-cyan-800/5 px-5 py-4 text-sm text-text dark:border-cyan/40 dark:bg-cyan/5"
		role="status"
		data-testid="first-sync"
		data-connected={connected}
	>
		<p class="font-medium text-heading">
			{app.member
				? t('messages.sync.first.member', { books: app.member.books })
				: t('messages.sync.first.own')}
		</p>
		<p class="mt-1">
			{connected
				? t('messages.sync.first.connected', { count: connected })
				: t('messages.sync.first.waiting')}
			{#if lastIn}
				{t('messages.sync.first.lastIn', { time: when(lastIn) })}
			{/if}
		</p>
	</div>
{/if}
