<script>
	// "Neues Portal aufzeichnen": a name and a start page (e.g. Anthropic,
	// https://claude.ai). The bridge opens its window there; the user logs in
	// by hand (codes, "Mit Google anmelden" and bot checks are always theirs),
	// clicks to one invoice and downloads it. The review lists the steps and
	// the other hosts the way passed through (each needs a tick); saved, the
	// portal is one of the user's own under Kundenportale, and the invoice from
	// the recording becomes a receipt right away (read and matched as usual).
	//
	// With `onstarted` (the portal card) this only starts the recording and
	// hands over; without it (payment and receipt details) it runs the whole
	// recording here and calls `onimported` with the new receipts.
	import TechnicalNote from '../TechnicalNote.svelte';
	import RecordingReview from './RecordingReview.svelte';
	import { currentBlobs, currentStore, refreshNow, runMatchingNow } from '../session.svelte.js';
	import { list, t } from '../i18n/index.js';
	import { createPortalClient } from './client.js';
	import { importInvoices } from './actions.js';

	/**
	 * @type {{
	 *   url: string,
	 *   token: string | null,
	 *   name?: string,
	 *   startUrl?: string,
	 *   onstarted?: (id: string) => void,
	 *   onimported?: (receiptIds: string[], portalId: string) => void,
	 *   testid?: string
	 * }}
	 */
	let {
		url,
		token,
		name: initialName = '',
		startUrl: initialStart = '',
		onstarted,
		onimported,
		testid = 'new-portal'
	} = $props();

	// The fields start from what the caller knows and are the user's from then on.
	let name = $state((() => initialName)());
	let startUrl = $state((() => initialStart)());
	/** @type {'form' | 'recording' | 'review' | 'done'} */
	let stage = $state('form');
	/** @type {string | null} */
	let portalId = $state(null);
	/** @type {import('./client.js').RecordingReview | null} */
	let review = $state(null);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {string | null} */
	let result = $state(null);

	const client = $derived(createPortalClient({ url, token }));

	/** @param {unknown} e */
	const message = (e) => (e instanceof Error ? e.message : String(e));

	/** @param {() => Promise<void>} fn */
	async function act(fn) {
		busy = true;
		error = null;
		try {
			await fn();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}

	const start = () =>
		act(async () => {
			result = null;
			const { id } = await client.recordNew({ name: name.trim(), startUrl: startUrl.trim() });
			if (onstarted) {
				onstarted(id);
				name = '';
				startUrl = '';
				return;
			}
			portalId = id;
			stage = 'recording';
		});

	const stop = () =>
		act(async () => {
			if (!portalId) return;
			review = await client.recordStop(portalId);
			stage = 'review';
		});

	const discard = () =>
		act(async () => {
			if (portalId) await client.recordDiscard(portalId);
			portalId = null;
			review = null;
			stage = 'form';
		});

	/** @param {string[]} hosts */
	const save = (hosts) =>
		act(async () => {
			if (!portalId) return;
			const id = portalId;
			const saved = await client.recordSave(id, hosts);
			const store = currentStore();
			const blobs = currentBlobs();
			/** @type {string[]} */
			let ids = [];
			if (store && blobs && saved.invoices?.length) {
				const { created } = await importInvoices({
					url,
					token,
					client,
					portal: id,
					name: name.trim(),
					invoices: saved.invoices,
					store,
					blobs
				});
				ids = created.map((r) => r.id);
				await refreshNow();
				if (ids.length) await runMatchingNow();
			}
			result =
				t('portals.new.saved', { name: name.trim() }) +
				(ids.length ? t('portals.new.imported') : '');
			stage = 'done';
			review = null;
			onimported?.(ids, id);
		});

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const field = 'mt-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-heading';
</script>

<div data-testid={testid}>
	{#if stage === 'form'}
		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				start();
			}}
		>
			<label class="flex min-w-36 flex-1 flex-col text-sm">
				<span class="text-faint">{t('portals.new.name')}</span>
				<input
					class={field}
					bind:value={name}
					placeholder={t('portals.new.namePlaceholder')}
					data-testid="new-portal-name"
				/>
			</label>
			<label class="flex min-w-48 flex-[2] flex-col text-sm">
				<span class="text-faint">{t('portals.new.start')}</span>
				<input
					class={field}
					type="url"
					inputmode="url"
					bind:value={startUrl}
					placeholder="https://"
					data-testid="new-portal-url"
				/>
			</label>
			<button
				type="submit"
				class={button}
				disabled={busy || !name.trim() || !/^https?:\/\/\S+$/.test(startUrl.trim())}
				data-testid="new-portal-start"
				>{busy ? t('portals.new.starting') : t('portals.new.button')}</button
			>
		</form>
		<p class="mt-1 text-xs text-faint">{t('portals.new.hint')}</p>
		<TechnicalNote
			class="mt-2"
			testid="new-portal-technical"
			lines={list('portals.new.technical')}
		/>
	{:else if stage === 'recording'}
		<p class="text-sm text-heading" role="status" data-testid="new-portal-recording">
			{t('portals.new.recording')}
		</p>
		<div class="mt-2 flex flex-wrap gap-3">
			<button
				type="button"
				class={primary}
				disabled={busy}
				onclick={stop}
				data-testid="new-portal-stop">{t('portals.record.stop')}</button
			>
			<button
				type="button"
				class={button}
				disabled={busy}
				onclick={discard}
				data-testid="new-portal-discard">{t('portals.record.discard')}</button
			>
		</div>
	{:else if stage === 'review' && review}
		<RecordingReview {review} {busy} onsave={save} ondiscard={discard} />
	{/if}
	{#if result}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="new-portal-result">
			{result}
		</p>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="new-portal-error">{error}</p>
	{/if}
</div>
