<script>
	// Integrationen → Kundenportale: each portal the bridge knows, its session,
	// and "Anmelden" (a window on the bridge's Mac), "Rechnungen holen" (from
	// a month on) and "Abmelden" (ends the session, deletes the profile).
	// "Portal aufzeichnen": the user clicks to the invoices once in the bridge's
	// window and downloads one; the steps are shown for review, then saved as
	// the portal's recipe (replayed by later fetches) or discarded, and the
	// saved recipe can be exported as JSON.
	// "Neues Portal aufzeichnen": a name and a start page make a portal of your
	// own (NewPortal.svelte); its row then shows the recording like any other,
	// and once saved it is listed as „eigenes Rezept, lokal“ with "Portal
	// entfernen". The other hosts a recording passed through are confirmed in
	// the review (RecordingReview.svelte); the invoice downloaded while
	// recording becomes a receipt when the recipe is saved.
	// "Zugangsdaten speichern": a user name here, the password in a window on
	// the bridge's Mac (straight into its keychain, never through this page);
	// "Zugangsdaten löschen" removes both.
	// Fetched invoices become receipts (source 'portal'), are read by the LLM
	// when the bridge has one, and go through the matching like every receipt.
	import TechnicalNote from '../TechnicalNote.svelte';
	import AiMark from '../AiMark.svelte';
	import MonthPicker from '../MonthPicker.svelte';
	import NewPortal from './NewPortal.svelte';
	import RecordingReview from './RecordingReview.svelte';
	import { currentBlobs, currentStore, refreshNow, runMatchingNow } from '../session.svelte.js';
	import { formatDate } from '../bank/format.js';
	import { list, t } from '../i18n/index.js';
	import { createPortalClient } from './client.js';
	import { fetchPortal, importInvoices } from './actions.js';

	/** @type {{ url: string, token: string | null }} */
	let { url, token } = $props();

	/** @type {import('./client.js').PortalInfo[]} */
	let portals = $state([]);
	let loaded = $state(false);
	/** @type {Record<string, string>} what runs per portal: login, fetch, logout */
	let busy = $state({});
	/** @type {Record<string, string>} */
	let results = $state({});
	/** @type {Record<string, string>} */
	let errors = $state({});
	/** @type {Record<string, import('./client.js').RecordingReview>} stopped recordings, per portal */
	let reviews = $state({});
	/** @type {Record<string, string>} the user name typed per portal, for "Zugangsdaten speichern" */
	let usernames = $state({});

	/** Three months back by default. */
	const now = new Date();
	let since = $state(
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 7)
	);

	const client = $derived(createPortalClient({ url, token }));

	$effect(() => {
		if (token) void load(client);
	});

	/** @param {import('./client.js').PortalClient} c */
	async function load(c) {
		try {
			portals = await c.list();
			// A recording stopped before the page was reloaded: fetch its review again.
			for (const p of portals) {
				if (p.review && !reviews[p.id]) {
					const r = await c.recordStop(p.id).catch(() => null);
					if (r) reviews = { ...reviews, [p.id]: r };
				}
			}
		} catch (error) {
			errors = { ...errors, _: message(error) };
		} finally {
			loaded = true;
		}
	}

	/** @template T @param {Record<string, T>} map @param {string} key @returns {Record<string, T>} */
	const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));

	/** @param {unknown} error */
	const message = (error) => (error instanceof Error ? error.message : String(error));

	/**
	 * @param {string} id
	 * @param {string} kind
	 * @param {() => Promise<void>} fn
	 */
	async function run(id, kind, fn) {
		busy = { ...busy, [id]: kind };
		errors = without(errors, id);
		results = without(results, id);
		try {
			await fn();
		} catch (error) {
			errors = { ...errors, [id]: message(error) };
		} finally {
			busy = without(busy, id);
			await load(client);
		}
	}

	/** @param {string} id */
	const login = (id) =>
		run(id, 'login', async () => {
			await client.login(id);
		});

	/** @param {string} id */
	async function cancel(id) {
		await client.cancel(id).catch(() => {});
	}

	/** @param {string} id */
	const logout = (id) =>
		run(id, 'logout', async () => {
			await client.logout(id);
		});

	/** @param {string} id */
	const nameOf = (id) => portals.find((p) => p.id === id)?.name ?? id;

	/** @param {string} id */
	const fetchInvoices = (id) =>
		run(id, 'fetch', async () => {
			const store = currentStore();
			const blobs = currentBlobs();
			if (!store || !blobs) return;
			// Imported, then read through the existing pipeline when the bridge can.
			const { answer, counts, read } = await fetchPortal({
				url,
				token,
				client,
				portal: id,
				name: nameOf(id),
				since,
				store,
				blobs
			});
			await refreshNow();
			results = {
				...results,
				[id]:
					t('portals.result', {
						listed: answer.listed,
						since,
						new: counts.new,
						known: counts.known + answer.skipped,
						duplicate: counts.duplicate
					}) +
					(answer.errors.length ? t('portals.refused', { count: answer.errors.length }) : '') +
					(read ? t('portals.read', { count: read }) : '')
			};
			if (counts.new) await runMatchingNow();
		});

	/** @param {string} id */
	const recordStart = (id) =>
		run(id, 'record', async () => {
			reviews = without(reviews, id);
			await client.recordStart(id);
		});

	/** @param {string} id */
	const recordStop = (id) =>
		run(id, 'record-stop', async () => {
			reviews = { ...reviews, [id]: await client.recordStop(id) };
		});

	/** @param {string} id @param {string[]} hosts the other hosts the user ticked */
	const recordSave = (id, hosts) =>
		run(id, 'record-save', async () => {
			const saved = await client.recordSave(id, hosts);
			reviews = without(reviews, id);
			// The invoice downloaded while recording: a receipt like a fetched one.
			let imported = 0;
			const store = currentStore();
			const blobs = currentBlobs();
			if (store && blobs && saved.invoices?.length) {
				const { counts } = await importInvoices({
					url,
					token,
					client,
					portal: id,
					name: nameOf(id),
					invoices: saved.invoices,
					store,
					blobs
				});
				imported = counts.new;
				await refreshNow();
				if (imported) await runMatchingNow();
			}
			results = {
				...results,
				[id]: t('portals.record.saved') + (imported ? t('portals.record.savedInvoice') : '')
			};
		});

	/** "Portal entfernen", after a yes. @param {string} id */
	const removePortal = (id) => {
		if (!confirm(t('portals.local.removeConfirm', { name: nameOf(id) }))) return;
		return run(id, 'remove', async () => {
			await client.remove(id);
			reviews = without(reviews, id);
		});
	};

	/** @param {string} id */
	const recordDiscard = (id) =>
		run(id, 'record-discard', async () => {
			await client.recordDiscard(id);
			reviews = without(reviews, id);
		});

	/** The saved recipe as a JSON file. @param {string} id */
	const exportRecipe = (id) =>
		run(id, 'export', async () => {
			const recipe = await client.exportRecipe(id);
			const blob = new Blob([`${JSON.stringify(recipe, null, '\t')}\n`], {
				type: 'application/json'
			});
			const href = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href;
			a.download = `portal-recipe-${id}.json`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(href), 1000);
		});

	/** @param {string} id */
	const saveCredentials = (id) =>
		run(id, 'credentials', async () => {
			await client.saveCredentials(id, (usernames[id] ?? '').trim());
			usernames = without(usernames, id);
			results = { ...results, [id]: t('portals.credentials.stored') };
		});

	/** @param {string} id */
	const deleteCredentials = (id) =>
		run(id, 'credentials-delete', async () => {
			await client.deleteCredentials(id);
			results = { ...results, [id]: t('portals.credentials.deleted') };
		});

	/** @param {string | null | undefined} iso */
	const day = (iso) => (iso ? formatDate(iso.slice(0, 10)) : '');

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

{#if token}
	<section
		class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
		aria-labelledby="portals-h"
		data-testid="portals-card"
	>
		<h2 id="portals-h" class="text-lg font-semibold">{t('portals.title')}</h2>
		<p class="mt-1 text-sm text-text">{t('portals.intro')}</p>

		{#if loaded && portals.length === 0 && !errors._}
			<p class="mt-3 text-sm text-text">{t('portals.none')}</p>
		{/if}
		{#if errors._}
			<p class="mt-3 text-sm text-danger" role="alert">{errors._}</p>
		{/if}

		<ul class="mt-3 divide-y divide-border">
			{#each portals as portal (portal.id)}
				<li class="py-3" data-testid="portal" data-portal={portal.id}>
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="font-medium text-heading">{portal.name}</span>
						{#if portal.source === 'local'}
							<span
								class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text"
								data-testid="portal-local"
								title={portal.host}>{t('portals.local.badge')}</span
							>
						{/if}
						<span
							class="rounded border px-1.5 py-0.5 text-xs font-medium {portal.state === 'logged-in'
								? 'border-success/30 bg-success/10 text-success'
								: portal.state === 'needs-login'
									? 'border-danger/40 bg-danger/10 text-danger'
									: 'border-border bg-surface-2 text-text'}"
							data-testid="portal-state"
							data-state={portal.state}>{t(`portals.state.${portal.state}`)}</span
						>
						<span class="text-xs text-faint">
							{[
								portal.lastLoginAt && t('portals.lastLogin', { date: day(portal.lastLoginAt) }),
								portal.lastRun &&
									(portal.lastRun.ok
										? t('portals.lastRun', {
												date: day(portal.lastRun.at),
												count: portal.lastRun.count ?? 0
											}) +
											(portal.lastRun.refused
												? t('portals.lastRunRefused', { count: portal.lastRun.refused })
												: '')
										: t('portals.lastRunFailed', { date: day(portal.lastRun.at) }))
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
					</div>

					<div class="mt-3 flex flex-wrap items-end gap-3">
						{#if portal.running === 'record'}
							<div class="w-full" data-testid="portal-recording">
								<p class="text-sm text-heading" role="status">{t('portals.record.hint')}</p>
								<div class="mt-2 flex flex-wrap gap-3">
									<button
										type="button"
										class={primary}
										disabled={Boolean(busy[portal.id])}
										onclick={() => recordStop(portal.id)}
										data-testid="portal-record-stop">{t('portals.record.stop')}</button
									>
									<button
										type="button"
										class={button}
										disabled={Boolean(busy[portal.id])}
										onclick={() => recordDiscard(portal.id)}
										data-testid="portal-record-discard">{t('portals.record.discard')}</button
									>
								</div>
							</div>
						{:else if portal.pending}
							<p class="text-sm text-text" data-testid="portal-pending">
								{t('portals.local.pending')}
							</p>
						{:else if busy[portal.id] === 'login'}
							<p class="text-sm text-heading" role="status" data-testid="portal-waiting">
								{t('portals.loggingIn')}
							</p>
							<button
								type="button"
								class={button}
								onclick={() => cancel(portal.id)}
								data-testid="portal-cancel">{t('portals.cancel')}</button
							>
						{:else}
							<button
								type="button"
								class={portal.state === 'logged-in' ? button : primary}
								disabled={Boolean(busy[portal.id])}
								onclick={() => login(portal.id)}
								data-testid="portal-login">{t('portals.login')}</button
							>
							{#if portal.state !== 'never'}
								<MonthPicker
									bind:value={since}
									label={t('portals.fromMonth')}
									testid="portal-since"
								/>
								<button
									type="button"
									class="inline-flex items-center gap-1.5 {portal.state === 'logged-in'
										? primary
										: button}"
									disabled={Boolean(busy[portal.id]) || !/^\d{4}-\d{2}$/.test(since)}
									onclick={() => fetchInvoices(portal.id)}
									title={t('ai.portal')}
									data-testid="portal-fetch"
									><AiMark />{busy[portal.id] === 'fetch'
										? t('portals.fetching')
										: t('portals.fetch')}</button
								>
								<button
									type="button"
									class="text-sm text-text underline hover:text-heading disabled:opacity-50"
									disabled={Boolean(busy[portal.id])}
									title={t('portals.logoutHint')}
									onclick={() => logout(portal.id)}
									data-testid="portal-logout">{t('portals.logout')}</button
								>
								{#if portal.recordable && !reviews[portal.id]}
									<button
										type="button"
										class={button}
										disabled={Boolean(busy[portal.id])}
										title={t('portals.record.startHint')}
										onclick={() => recordStart(portal.id)}
										data-testid="portal-record">{t('portals.record.start')}</button
									>
								{/if}
								{#if portal.recorded}
									<button
										type="button"
										class="text-sm text-text underline hover:text-heading disabled:opacity-50"
										disabled={Boolean(busy[portal.id])}
										title={t('portals.record.exportHint')}
										onclick={() => exportRecipe(portal.id)}
										data-testid="portal-recipe-export">{t('portals.record.export')}</button
									>
								{/if}
							{/if}
							{#if portal.source === 'local'}
								<button
									type="button"
									class="text-sm text-danger underline disabled:opacity-50"
									disabled={Boolean(busy[portal.id])}
									title={t('portals.local.removeHint')}
									onclick={() => removePortal(portal.id)}
									data-testid="portal-remove">{t('portals.local.remove')}</button
								>
							{/if}
						{/if}
					</div>
					{#if reviews[portal.id] && portal.running !== 'record'}
						<RecordingReview
							review={reviews[portal.id]}
							busy={Boolean(busy[portal.id])}
							onsave={(hosts) => recordSave(portal.id, hosts)}
							ondiscard={() => recordDiscard(portal.id)}
						/>
					{/if}
					{#if portal.credentials && portal.running !== 'record' && !portal.pending}
						<div class="mt-3 border-t border-border pt-3" data-testid="portal-credentials">
							{#if portal.hasCredentials}
								<div class="flex flex-wrap items-center gap-3">
									<span
										class="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success"
										data-testid="portal-credentials-stored"
										>{t('portals.credentials.storedBadge')}</span
									>
									<button
										type="button"
										class="text-sm text-text underline hover:text-heading disabled:opacity-50"
										disabled={Boolean(busy[portal.id])}
										onclick={() => deleteCredentials(portal.id)}
										data-testid="portal-credentials-delete"
										>{t('portals.credentials.delete')}</button
									>
								</div>
							{:else}
								<form
									class="flex flex-wrap items-end gap-3"
									onsubmit={(e) => {
										e.preventDefault();
										saveCredentials(portal.id);
									}}
								>
									<label class="flex min-w-48 flex-1 flex-col text-sm">
										<span class="text-faint">{t('portals.credentials.username')}</span>
										<input
											class="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading"
											autocomplete="username"
											value={usernames[portal.id] ?? ''}
											oninput={(e) =>
												(usernames = {
													...usernames,
													[portal.id]: /** @type {HTMLInputElement} */ (e.currentTarget).value
												})}
											data-testid="portal-credentials-username"
										/>
									</label>
									<button
										type="submit"
										class={button}
										disabled={Boolean(busy[portal.id]) || !(usernames[portal.id] ?? '').trim()}
										data-testid="portal-credentials-save"
										>{busy[portal.id] === 'credentials'
											? t('portals.credentials.saving')
											: t('portals.credentials.save')}</button
									>
								</form>
								<p class="mt-1 text-xs text-faint">{t('portals.credentials.hint')}</p>
							{/if}
							<TechnicalNote
								class="mt-2"
								testid="portal-credentials-technical"
								lines={list('portals.credentials.technical')}
							/>
						</div>
					{/if}
					{#if !portal.pending && (busy[portal.id] === 'login' || portal.state !== 'logged-in')}
						<p class="mt-2 text-xs text-faint">{t('portals.loginHint')}</p>
					{/if}
					{#if results[portal.id]}
						<p class="mt-2 text-sm text-heading" role="status" data-testid="portal-result">
							{results[portal.id]}
						</p>
					{/if}
					{#if errors[portal.id]}
						<p class="mt-2 text-sm text-danger" role="alert" data-testid="portal-error">
							{errors[portal.id]}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
		{#if portals.some((p) => p.recordable)}
			<div class="mt-2 border-t border-border pt-3" data-testid="portals-new">
				<h3 class="text-sm font-semibold text-heading">{t('portals.new.title')}</h3>
				<p class="mt-1 text-sm text-text">{t('portals.new.intro')}</p>
				<div class="mt-2">
					<NewPortal {url} {token} onstarted={() => load(client)} />
				</div>
			</div>
		{/if}
		<TechnicalNote class="mt-2" lines={list('portals.technical')} />
	</section>
{/if}
