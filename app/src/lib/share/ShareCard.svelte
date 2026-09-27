<script>
	// Integrationen → Einblick für einen Assistenten (issue #124): a scoped,
	// redacted by default, expiring snapshot of the books, served by the bridge
	// on 127.0.0.1 by its id (share/snapshot.js, bridge/src/shares.js).
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { recordEvent } from '$lib/activity/events.js';
	import { t } from '$lib/i18n/index.js';
	import { shownYear } from '$lib/year/year.svelte.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import { COLLECTIONS, buildSnapshot, scopeText } from './snapshot.js';

	/** @type {{ url: string, token: string | null }} */
	let { url, token } = $props();
	const client = $derived(createBridgeClient({ url, token }));

	/** @type {Record<string, boolean>} */
	let chosen = $state({ transactions: true, receipts: true, questions: false });
	let redacted = $state(true);
	let minutes = $state(60);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {import('$lib/bridge/client.js').ShareInfo[]} */
	let shares = $state([]);
	/** @type {string | null} the id just made, whose command is shown */
	let fresh = $state(null);

	const base = $derived(url.replace(/\/$/, ''));
	/** @param {string} id */
	const command = (id) => `curl -s ${base}/share/${id}`;

	async function refresh() {
		if (!token) return;
		try {
			shares = (await client.listShares()).shares;
		} catch {
			shares = [];
		}
	}
	$effect(() => {
		if (token) refresh();
	});

	async function create() {
		const store = currentStore();
		const collections = COLLECTIONS.filter((c) => chosen[c]);
		if (!store || !collections.length || busy) return;
		busy = true;
		error = null;
		try {
			const year = shownYear();
			const data = buildSnapshot({
				books: /** @type {any} */ (app),
				collections,
				year,
				redacted,
				now: new Date().toISOString()
			});
			const scope = scopeText(collections, year, redacted, (k) => t(`share.scope.${k}`));
			const share = await client.createShare({ scope, redacted, minutes, data });
			fresh = share.id;
			await recordEvent(store.events, 'decision', {
				action: 'share-created',
				scope,
				redacted,
				until: share.expiresAt
			});
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** @param {import('$lib/bridge/client.js').ShareInfo} share */
	async function revoke(share) {
		const store = currentStore();
		busy = true;
		try {
			await client.revokeShare(share.id);
			if (store) {
				await recordEvent(store.events, 'decision', {
					action: 'share-revoked',
					scope: share.scope
				});
			}
			if (fresh === share.id) fresh = null;
			await refresh();
		} finally {
			busy = false;
		}
	}

	/** @param {string} iso */
	const time = (iso) =>
		new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(
			new Date(iso)
		);
	const card = 'mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm';
	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
</script>

<section class={card} aria-labelledby="share-h" data-testid="share-card">
	<h2 id="share-h" class="text-lg font-semibold text-heading">{t('share.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('share.what')}</p>
	<p class="mt-1 text-sm text-danger" data-testid="share-note">{t('share.note')}</p>
	{#if !token}
		<p class="mt-2 text-sm text-faint">{t('share.needsBridge')}</p>
	{:else}
		<fieldset class="mt-3 flex flex-wrap gap-4 text-sm text-text">
			<legend class="sr-only">{t('share.collections')}</legend>
			{#each COLLECTIONS as c (c)}
				<label class="flex items-center gap-1.5"
					><input type="checkbox" bind:checked={chosen[c]} data-testid={`share-${c}`} />
					{t(`share.scope.${c}`)}</label
				>
			{/each}
		</fieldset>
		<div class="mt-2 flex flex-wrap items-center gap-4 text-sm text-text">
			<label class="flex items-center gap-1.5"
				><input type="checkbox" bind:checked={redacted} data-testid="share-redacted" />
				{t('share.redacted')}</label
			>
			<label class="flex items-center gap-1.5"
				>{t('share.duration')}
				<select
					class="rounded border border-border bg-surface px-2 py-1"
					bind:value={minutes}
					data-testid="share-minutes"
				>
					<option value={15}>15 min</option>
					<option value={60}>1 h</option>
					<option value={240}>4 h</option>
					<option value={1440}>24 h</option>
				</select></label
			>
			<button
				type="button"
				class={button}
				disabled={busy}
				onclick={create}
				data-testid="share-create">{t('share.create', { year: shownYear() })}</button
			>
		</div>
		{#if !redacted}
			<p class="mt-1 text-xs text-danger">{t('share.unredactedWarning')}</p>
		{/if}
		{#if error}
			<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
		{/if}
		{#if fresh}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
				data-testid="share-fresh"
			>
				<p class="text-heading">{t('share.command')}</p>
				<CopyButton
					text={command(fresh)}
					label={t('share.copyCommand')}
					testid="share-command"
					valueClass="font-mono text-xs break-all">{command(fresh)}</CopyButton
				>
			</div>
		{/if}
		{#if shares.length}
			<ul class="mt-3 divide-y divide-border text-sm" data-testid="share-list">
				{#each shares as s (s.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-2 py-1.5"
						data-testid="share-item"
					>
						<span class="min-w-0 text-text"
							>{s.scope} · {t('share.until', { time: time(s.expiresAt) })} · {t('share.reads', {
								count: s.reads
							})}</span
						>
						<button
							type="button"
							class={button}
							disabled={busy}
							onclick={() => revoke(s)}
							data-testid="share-revoke">{t('share.revoke')}</button
						>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="mt-1 text-xs underline"
				onclick={refresh}
				data-testid="share-refresh">{t('share.refresh')}</button
			>
		{/if}
	{/if}
</section>
