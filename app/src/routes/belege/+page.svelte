<script>
	// Belege: sources on the left, receipts by month in the middle, the chosen
	// one on the right with a preview and what was read from it. Receipts come
	// from the accounting mailbox (through the bridge), from uploads and from a
	// shared folder; every file is sealed before it is stored.
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TechnicalNote from '$lib/TechnicalNote.svelte';
	import {
		app,
		currentBlobs,
		currentStore,
		refreshNow,
		runMatchingNow
	} from '$lib/session.svelte.js';
	import { matchOfReceipt } from '$lib/matching/view.js';
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { getSetting } from '$lib/store/settings.js';
	import { formatDate, formatMoney } from '$lib/bank/format.js';
	import { fetchAccountingMail, importFiles, needsConfirmation } from '$lib/receipts/import.js';
	import { extractReceipt, extractable } from '$lib/receipts/extract.js';
	import { extractionHow } from '$lib/receipts/how.js';
	import { confirmSender as confirmSenderAction } from '$lib/matching/actions.js';
	import {
		defaultMailMonths,
		groupReceiptsByMonth,
		mailWindow,
		matchesReceiptSearch,
		receiptDate,
		receiptVendor,
		sourceCounts,
		statusKey
	} from '$lib/receipts/view.js';
	import {
		ensurePermission,
		folderSupported,
		forgetFolder,
		listFolderFiles,
		pickFolder,
		savedFolder
	} from '$lib/receipts/folder.js';
	import { list, t } from '$lib/i18n/index.js';

	/** @typedef {import('$lib/store/repository.js').StoredRecord} Receipt */

	/** @type {ReturnType<typeof createBridgeClient> | null} */
	let client = $state(null);
	/** @type {{ mail: boolean, llm: boolean, address: string } | null} */
	let bridgeInfo = $state(null);

	/** @type {'all' | 'mail' | 'upload' | 'folder'} */
	let source = $state('all');
	let query = $state('');
	/** @type {string | null} */
	let selectedId = $state(null);

	const months = defaultMailMonths();
	let monthFrom = $state(months.from);
	let monthTo = $state(months.to);
	let fetching = $state(false);
	/** @type {string | null} */
	let fetchResult = $state(null);
	/** @type {string | null} */
	let fetchError = $state(null);

	let importing = $state(false);
	/** @type {string | null} */
	let importResult = $state(null);
	/** @type {string | null} */
	let importError = $state(null);
	let dragging = $state(false);

	const canFolder = folderSupported();
	/** @type {any} */
	let folderHandle = $state(null);

	const busy = new SvelteSet(/** @type {string[]} */ ([]));
	/** @type {{ done: number, count: number } | null} */
	let bulk = $state(null);
	/** @type {Record<string, string>} */
	let extractErrors = $state({});

	let receipts = $derived(/** @type {Receipt[]} */ (app.receipts));
	let counts = $derived(sourceCounts(receipts));
	let filtered = $derived(
		receipts.filter(
			(r) => (source === 'all' || r.source === source) && matchesReceiptSearch(r, query)
		)
	);
	let groups = $derived(groupReceiptsByMonth(filtered));
	let selected = $derived(receipts.find((r) => r.id === selectedId) ?? null);
	let todo = $derived(extractable(receipts));
	let selectedMatch = $derived(selected ? matchOfReceipt(selected.id, app.matches) : null);
	let selectedTx = $derived(
		selectedMatch
			? (app.transactions.find((x) => x.id === selectedMatch.transactionId) ?? null)
			: null
	);

	let how = $derived(selected ? extractionHow(selected) : null);

	onMount(async () => {
		const store = currentStore();
		if (!store) return;
		// From the Verlauf: open this receipt.
		const wanted = page.url.searchParams.get('receipt');
		if (wanted) selectedId = wanted;
		folderHandle = await savedFolder();
		const saved = await getSetting(store.settings, 'bridge');
		if (!saved?.token) return;
		const c = createBridgeClient({ url: saved.url, token: saved.token });
		client = c;
		try {
			const health = await c.health();
			bridgeInfo = {
				mail: health.mail?.configured ?? false,
				llm: health.llm?.configured ?? false,
				address: health.mail?.accountingAddress ?? ''
			};
		} catch {
			bridgeInfo = null;
		}
	});

	/** @type {HTMLElement | undefined} */
	let detailPanel = $state();

	/** On a phone the detail sits under the list: bring it into view. */
	async function select(/** @type {string} */ id) {
		selectedId = id;
		if (!window.matchMedia('(min-width: 1024px)').matches) {
			await tick();
			detailPanel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		}
	}

	/** @param {unknown} error */
	const message = (error) => (error instanceof Error ? error.message : String(error));

	async function fetchMail() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !client) return;
		fetching = true;
		fetchError = null;
		fetchResult = null;
		try {
			const { since, until } = mailWindow(monthFrom, monthTo);
			const { mails, counts: c } = await fetchAccountingMail({
				store,
				blobs,
				client,
				since,
				until
			});
			fetchResult =
				t('belege.mailResult', {
					mails,
					new: c.new,
					known: c.skipped,
					duplicate: c.duplicate
				}) + (c.verdicts ? t('belege.mailVerdicts', { count: c.verdicts }) : '');
			await refreshNow();
		} catch (error) {
			fetchError = message(error);
		} finally {
			fetching = false;
		}
		if (fetchResult) await runMatchingNow();
	}

	/** @param {{ name: string, path?: string, bytes: () => Promise<Uint8Array> }[]} files @param {'upload' | 'folder'} kind */
	async function importSome(files, kind) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || files.length === 0) return;
		importing = true;
		importError = null;
		importResult = null;
		try {
			const c = await importFiles({ receipts: store.receipts, blobs, files, source: kind });
			importResult = t('belege.importResult', {
				new: c.new,
				duplicate: c.duplicate,
				unsupported: c.unsupported
			});
			await refreshNow();
		} catch (error) {
			importError = message(error);
		} finally {
			importing = false;
		}
	}

	/** @param {File[]} files */
	const fromFiles = (files) =>
		files.map((f) => ({
			name: f.name,
			bytes: async () => new Uint8Array(await f.arrayBuffer())
		}));

	/** @param {Event} event */
	async function onUpload(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		await importSome(fromFiles([...(input.files ?? [])]), 'upload');
		input.value = '';
	}

	/** @param {DragEvent} event */
	async function onDrop(event) {
		event.preventDefault();
		dragging = false;
		await importSome(fromFiles([...(event.dataTransfer?.files ?? [])]), 'upload');
	}

	async function chooseFolder() {
		importError = null;
		try {
			folderHandle = await pickFolder();
			await readFolder();
		} catch (error) {
			if (/** @type {any} */ (error)?.name !== 'AbortError') importError = message(error);
		}
	}

	async function readFolder() {
		if (!folderHandle) return;
		importError = null;
		try {
			if (!(await ensurePermission(folderHandle))) {
				importError = t('belege.folderDenied');
				return;
			}
			await importSome(await listFolderFiles(folderHandle), 'folder');
		} catch (error) {
			importError = message(error);
		}
	}

	async function dropFolder() {
		await forgetFolder();
		folderHandle = null;
	}

	/** @param {Receipt} record @param {boolean} [match] run the matching afterwards */
	async function extract(record, match = true) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !client) return;
		busy.add(record.id);
		const rest = { ...extractErrors };
		delete rest[record.id];
		extractErrors = rest;
		try {
			await extractReceipt({
				client,
				receipts: store.receipts,
				blobs,
				record,
				events: store.events
			});
		} catch (error) {
			extractErrors = { ...extractErrors, [record.id]: message(error) };
		} finally {
			busy.delete(record.id);
			await refreshNow();
		}
		if (match) await runMatchingNow();
	}

	async function extractAll() {
		const pending = [...todo];
		bulk = { done: 0, count: pending.length };
		for (const record of pending) {
			await extract(record, false);
			bulk = { done: (bulk?.done ?? 0) + 1, count: pending.length };
		}
		await runMatchingNow();
		bulk = null;
	}

	/** @param {Receipt} record */
	async function confirmSender(record) {
		const store = currentStore();
		if (!store) return;
		await confirmSenderAction(store, record.id);
		await refreshNow();
		await runMatchingNow();
	}

	// The preview: page 1 of a PDF on a canvas, an image as it is, a mail's text.
	// It depends on which file is shown and whether it may be opened, not on
	// every refresh of the list; renders run one after another (pdf.js refuses
	// two renders into one canvas at once).
	/** @type {HTMLCanvasElement | undefined} */
	let canvas = $state();
	/** @type {string | null} */
	let imageUrl = $state(null);
	let previewError = $state(false);
	/** @type {string | null} which receipt's page 1 is on the canvas */
	let renderedFor = $state(null);
	let previewKey = $derived(
		selected?.fileCid && !needsConfirmation(selected)
			? `${selected.id}|${selected.fileCid}|${selected.mime}`
			: null
	);
	/** @type {Promise<unknown>} */
	let renderQueue = Promise.resolve();

	$effect(() => {
		const key = previewKey;
		const target = canvas;
		previewError = false;
		if (!key) return;
		const [id, fileCid, mime] = key.split('|');
		const blobs = currentBlobs();
		if (!blobs) return;
		let cancelled = false;
		/** @type {string | null} */
		let url = null;
		renderQueue = renderQueue.then(async () => {
			if (cancelled) return;
			try {
				const bytes = await blobs.get(fileCid);
				if (cancelled) return;
				if (mime === 'application/pdf') {
					if (!target) return;
					const { renderFirstPage } = await import('$lib/receipts/pdf.js');
					if (cancelled) return;
					await renderFirstPage(bytes, target, 320);
					if (!cancelled) renderedFor = id;
				} else if (mime.startsWith('image/')) {
					url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: mime }));
					imageUrl = url;
				}
			} catch (error) {
				console.error('preview failed:', error);
				if (!cancelled) previewError = true;
			}
		});
		return () => {
			cancelled = true;
			renderedFor = null;
			if (url) URL.revokeObjectURL(url);
			imageUrl = null;
		};
	});

	/** @param {Receipt} r */
	const amount = (r) =>
		typeof r.amountCents === 'number' ? formatMoney(r.amountCents, r.currency ?? 'EUR') : '';

	/** @param {Receipt} r */
	function dateText(r) {
		const d = receiptDate(r);
		return d ? formatDate(d) : '';
	}

	/** @type {Record<string, string>} */
	const badgeClass = {
		new: 'border-border bg-surface-2 text-text',
		unassigned:
			'border-data-400 bg-data-100 text-data-800 dark:border-data/40 dark:bg-data/10 dark:text-data',
		question: 'border-danger/40 bg-danger/10 text-danger',
		assigned: 'border-success/30 bg-success/10 text-success',
		ignored: 'border-border bg-surface-2 text-faint'
	};

	/** @param {Receipt} r */
	function extractionNote(r) {
		if (extractErrors[r.id]) return extractErrors[r.id];
		if (r.extractionError === 'image' || (String(r.mime).startsWith('image/') && !r.extraction)) {
			return t('belege.imageGap');
		}
		if (r.extractionError === 'no-text') return t('belege.noText');
		return r.extractionError ?? null;
	}

	/** @param {Receipt} r */
	const verdictText = (r) =>
		r.outgoing ? t('belege.verdict.outgoing') : t(`belege.verdict.${r.authVerdict ?? 'none'}`);

	const sourceButtons = /** @type {const} */ (['all', 'mail', 'upload', 'folder']);
	/** @param {'all' | 'mail' | 'upload' | 'folder'} s */
	function sourceLabel(s) {
		if (s === 'all') return t('belege.sourceAll');
		if (s === 'mail') {
			return t('belege.sourceMail', { address: bridgeInfo?.address || 'buchhaltung@' });
		}
		if (s === 'upload') return t('belege.sourceUpload');
		return t('belege.sourceFolder');
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const card = 'rounded-lg border border-border bg-surface shadow-sm';
</script>

<div
	class="relative"
	role="region"
	aria-label={t('belege.title')}
	ondragover={(e) => {
		if (e.dataTransfer?.types?.includes('Files')) {
			e.preventDefault();
			dragging = true;
		}
	}}
	ondragleave={(e) => {
		if (e.currentTarget === e.target) dragging = false;
	}}
	ondrop={onDrop}
	data-testid="belege-page"
>
	{#if dragging}
		<div
			class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-cyan-800 bg-surface/90 text-lg font-semibold text-heading dark:border-cyan"
		>
			{t('belege.drop')}
		</div>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-heading">{t('belege.title')}</h1>
		<div class="flex flex-wrap items-center gap-2">
			{#if canFolder}
				{#if folderHandle}
					<button type="button" class={button} onclick={readFolder} disabled={importing}
						>{t('belege.folderAgain', { name: folderHandle.name })}</button
					>
					<button type="button" class="text-sm text-faint underline" onclick={dropFolder}
						>{t('belege.folderForget')}</button
					>
				{:else}
					<button
						type="button"
						class={button}
						onclick={chooseFolder}
						disabled={importing}
						title={t('belege.folderHint')}
						data-testid="folder-share">{t('belege.folder')}</button
					>
				{/if}
			{/if}
			<label class="{primary} cursor-pointer" data-testid="upload-label">
				{t('belege.upload')}
				<input
					type="file"
					class="sr-only"
					multiple
					accept=".pdf,application/pdf,image/png,image/jpeg,image/gif,image/webp"
					disabled={importing}
					onchange={onUpload}
					data-testid="receipt-upload"
				/>
			</label>
		</div>
	</div>
	<p class="mt-1 text-xs text-faint">{t('belege.uploadHint')}</p>
	{#if importResult}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="import-result">
			{importResult}
		</p>
	{/if}
	{#if importError}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="import-error">{importError}</p>
	{/if}

	<section class="mt-4 {card} px-5 py-4" aria-labelledby="mail-h">
		<h2 id="mail-h" class="text-lg font-semibold">{t('belege.mailTitle')}</h2>
		{#if !client}
			<p class="mt-1 text-sm text-text" data-testid="mail-no-bridge">
				{t('belege.mailNoBridge')}<a class="underline" href={resolve('/integrationen')}
					>{t('belege.mailNoBridgeLink')}</a
				>{t('belege.mailNoBridgeAfter')}
			</p>
		{:else}
			<p class="mt-1 text-sm text-text">
				{t('belege.mailIntro', { address: bridgeInfo?.address || 'buchhaltung@' })}
			</p>
			{#if bridgeInfo && !bridgeInfo.mail}
				<p class="mt-2 text-sm text-danger">{t('belege.mailNotSetUp')}</p>
			{/if}
			<div class="mt-3 flex flex-wrap items-end gap-3">
				<label class="flex flex-col text-sm">
					<span class="text-faint">{t('belege.mailFrom')}</span>
					<input
						type="month"
						class="mt-1 rounded-md border px-2 py-1.5 text-sm"
						bind:value={monthFrom}
						data-testid="mail-from"
					/>
				</label>
				<label class="flex flex-col text-sm">
					<span class="text-faint">{t('belege.mailTo')}</span>
					<input
						type="month"
						class="mt-1 rounded-md border px-2 py-1.5 text-sm"
						bind:value={monthTo}
						data-testid="mail-to"
					/>
				</label>
				<button
					type="button"
					class={primary}
					onclick={fetchMail}
					disabled={fetching || !monthFrom || !monthTo}
					data-testid="mail-fetch"
					>{fetching ? t('belege.mailFetching') : t('belege.mailFetch')}</button
				>
			</div>
			{#if fetchResult}
				<p class="mt-2 text-sm text-heading" role="status" data-testid="mail-result">
					{fetchResult}
				</p>
			{/if}
			{#if fetchError}
				<p class="mt-2 text-sm text-danger" role="alert" data-testid="mail-error">{fetchError}</p>
			{/if}
		{/if}
	</section>

	{#if receipts.length === 0}
		<p class="mt-6 {card} px-5 py-4 text-text" data-testid="receipts-empty">
			{t('belege.empty')}
		</p>
	{:else}
		<div
			class="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_minmax(0,20rem)]"
		>
			<nav aria-label={t('belege.sources')}>
				<ul
					class="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
				>
					{#each sourceButtons as s (s)}
						<li class="shrink-0">
							<button
								type="button"
								class="flex w-full items-baseline justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm {source ===
								s
									? 'border-cyan-800 bg-surface shadow-sm dark:border-cyan'
									: 'border-transparent hover:bg-surface/60'}"
								aria-pressed={source === s}
								onclick={() => (source = s)}
								data-testid="receipt-source"
								data-source={s}
							>
								<span class="min-w-0 truncate font-medium text-heading">{sourceLabel(s)}</span>
								<span class="text-faint tabular-nums" data-testid="source-count">{counts[s]}</span>
							</button>
						</li>
					{/each}
				</ul>
				<TechnicalNote class="mt-3 hidden lg:block" lines={list('belege.technical')} />
			</nav>

			<section aria-label={t('belege.list')} class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<label class="sr-only" for="receipt-search">{t('belege.search')}</label>
					<input
						id="receipt-search"
						type="search"
						bind:value={query}
						placeholder={t('belege.searchPlaceholder')}
						class="min-w-40 flex-1 rounded-md border px-3 py-1.5 text-sm"
						data-testid="receipt-search"
					/>
					{#if client && todo.length > 0}
						<button
							type="button"
							class={button}
							onclick={extractAll}
							disabled={bulk !== null}
							data-testid="extract-all"
							>{bulk
								? t('belege.extracting', { done: bulk.done, count: bulk.count })
								: t('belege.extractAll', { count: todo.length })}</button
						>
					{/if}
				</div>

				{#each groups as group (group.month)}
					<div class="mt-4" data-testid="receipt-month" data-month={group.month}>
						<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">{group.label}</h2>
						<ul class="mt-1.5 divide-y divide-border {card}">
							{#each group.items as r (r.id)}
								<li>
									<button
										type="button"
										class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 {selectedId ===
										r.id
											? 'bg-surface-2'
											: ''}"
										aria-current={selectedId === r.id ? 'true' : undefined}
										onclick={() => select(r.id)}
										data-testid="receipt"
										data-source={r.source}
										data-status={r.status}
									>
										<span class="min-w-0 flex-1">
											<span
												class="block truncate font-medium text-heading"
												data-testid="receipt-vendor">{receiptVendor(r)}</span
											>
											<span class="block truncate text-xs text-faint"
												>{r.fileName ?? t('belege.textMail')}</span
											>
											<span class="mt-1 flex flex-wrap gap-1">
												<span
													class="rounded border px-1.5 py-0.5 text-xs font-medium {badgeClass[
														statusKey(r)
													]}"
													data-testid="receipt-status">{t(`belege.status.${statusKey(r)}`)}</span
												>
												{#if needsConfirmation(r)}
													<span
														class="rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger"
														data-testid="receipt-unverified">⚠ {t('belege.unverified')}</span
													>
												{/if}
											</span>
										</span>
										<span class="shrink-0 text-right">
											<span
												class="block font-mono text-sm whitespace-nowrap text-heading tabular-nums"
												data-testid="receipt-amount">{amount(r)}</span
											>
											<span class="block text-xs text-faint tabular-nums" data-testid="receipt-date"
												>{dateText(r)}</span
											>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p class="mt-4 {card} px-5 py-4 text-text">{t('belege.noMatches')}</p>
				{/each}
			</section>

			<aside
				aria-label={t('belege.detail')}
				class="min-w-0 scroll-mt-4"
				bind:this={detailPanel}
				data-testid="receipt-detail"
			>
				{#if !selected}
					<p class="{card} px-5 py-4 text-sm text-faint">{t('belege.chooseOne')}</p>
				{:else}
					<div class="{card} px-4 py-4">
						<h2 class="text-lg font-semibold break-words text-heading" data-testid="detail-vendor">
							{receiptVendor(selected)}
						</h2>
						<p class="mt-0.5 text-xs break-all text-faint">
							{selected.fileName ?? t('belege.textMail')}
						</p>

						{#if needsConfirmation(selected)}
							<div
								class="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-heading"
								role="alert"
								data-testid="sender-warning"
							>
								<p class="font-semibold text-danger">⚠ {t('belege.warningTitle')}</p>
								<p class="mt-1">
									{selected.authVerdict === 'fail'
										? t('belege.warningFail')
										: t('belege.warningNone')}
								</p>
								<p class="mt-1 text-xs">{t('belege.warningAfter')}</p>
								<button
									type="button"
									class="mt-2 {button}"
									onclick={() => selected && confirmSender(selected)}
									data-testid="confirm-sender">{t('belege.confirm')}</button
								>
							</div>
						{:else if selected.fileCid && selected.mime === 'application/pdf'}
							<div class="mt-3 overflow-hidden rounded border border-border bg-white">
								{#key selected.id}
									<canvas
										bind:this={canvas}
										class="block max-w-full"
										aria-label={t('belege.preview')}
										data-testid="preview-pdf"
										data-rendered={renderedFor === selected.id ? 'true' : 'false'}
									></canvas>
								{/key}
							</div>
						{:else if selected.fileCid && imageUrl}
							<img
								src={imageUrl}
								alt={t('belege.preview')}
								class="mt-3 max-h-96 max-w-full rounded border border-border"
								data-testid="preview-image"
							/>
						{:else if !selected.fileCid && selected.excerpt}
							<pre
								class="mt-3 max-h-64 overflow-auto rounded border border-border bg-surface-2 p-2 font-sans text-xs whitespace-pre-wrap text-text"
								data-testid="preview-text">{selected.excerpt}</pre>
						{/if}
						{#if previewError}
							<p class="mt-2 text-sm text-danger">{t('belege.previewFailed')}</p>
						{/if}

						<dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
							{#if selected.extraction}
								<dt class="text-faint">{t('belege.fields.vendor')}</dt>
								<dd class="text-heading" data-testid="field-vendor">{selected.vendor ?? '—'}</dd>
								<dt class="text-faint">{t('belege.fields.amount')}</dt>
								<dd class="font-mono text-heading tabular-nums" data-testid="field-amount">
									{amount(selected) || '—'}
								</dd>
								<dt class="text-faint">{t('belege.fields.date')}</dt>
								<dd class="text-heading" data-testid="field-date">
									{selected.documentDate ? formatDate(selected.documentDate) : '—'}
								</dd>
								<dt class="text-faint">{t('belege.fields.invoiceNumber')}</dt>
								<dd class="break-all text-heading" data-testid="field-invoice">
									{selected.invoiceNumber ?? '—'}
								</dd>
								{#if selected.extraction.summary}
									<dt class="text-faint">{t('belege.fields.summary')}</dt>
									<dd class="text-heading">{selected.extraction.summary}</dd>
								{/if}
								<dt class="text-faint">{t('belege.fields.model')}</dt>
								<dd class="font-mono text-xs text-text" data-testid="field-model">
									{selected.extractionModel}
								</dd>
							{/if}
							<dt class="text-faint">{t('belege.fields.source')}</dt>
							<dd class="text-text">{t(`belege.sourceName.${selected.source}`)}</dd>
							{#if selected.source === 'mail'}
								<dt class="text-faint">{t('belege.fields.from')}</dt>
								<dd class="break-all text-text" data-testid="field-from">{selected.from}</dd>
								<dt class="text-faint">{t('belege.fields.subject')}</dt>
								<dd class="break-words text-text">{selected.subject}</dd>
								{#if selected.receivedAt}
									<dt class="text-faint">{t('belege.fields.received')}</dt>
									<dd class="text-text">
										{formatDate(String(selected.receivedAt).slice(0, 10))}
									</dd>
								{/if}
								<dt class="text-faint">{t('belege.fields.sender')}</dt>
								<dd class="text-text" data-testid="field-verdict">{verdictText(selected)}</dd>
							{/if}
						</dl>

						{#if how}
							<div
								class="mt-3 border-l-2 border-infra pl-3 text-xs text-text"
								data-testid="extract-how"
							>
								<p class="font-medium text-heading" data-testid="extract-how-line">{how.line}</p>
								{#if how.fallback}
									<p data-testid="extract-how-fallback">{how.fallback}</p>
								{/if}
								<p class="mt-1 text-faint">{t('belege.how.notAi')}</p>
								{#if selected.extractionSent}
									<details class="mt-2" data-testid="extract-sent">
										<summary class="cursor-pointer text-sm text-text underline"
											>{t('belege.how.sent')}</summary
										>
										<p class="mt-1 text-faint">{t('belege.how.sentHint')}</p>
										<pre
											class="mt-1 max-h-72 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-[11px] break-words whitespace-pre-wrap text-text"
											data-testid="extract-sent-text">{selected.extractionSent}</pre>
									</details>
								{:else}
									<p class="mt-1 text-faint" data-testid="extract-sent-missing">
										{t('belege.how.sentMissing')}
									</p>
								{/if}
								<TechnicalNote
									class="mt-2"
									testid="extract-how-technical"
									lines={[how.redactions, how.tokens, how.attempts].filter((x) => x !== null)}
								/>
							</div>
						{/if}

						{#if selectedTx}
							<div
								class="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm"
								data-testid="receipt-linked"
							>
								<p class="text-xs font-semibold text-success">{t('belege.linkedTo')}</p>
								<p class="text-heading" data-testid="receipt-linked-tx">
									{selectedTx.counterparty || '—'} · {formatDate(selectedTx.bookedOn)} · {formatMoney(
										selectedTx.amountCents ?? 0,
										selectedTx.currency
									)}
								</p>
								<a
									class="text-sm text-text underline"
									href={`${resolve('/zahlungen')}?tx=${encodeURIComponent(selectedTx.id)}`}
									data-testid="receipt-open-tx">{t('belege.openTx')}</a
								>
							</div>
						{:else if selected.extraction?.document_type === 'payment_reminder'}
							<p class="mt-3 text-xs text-faint" data-testid="receipt-reminder">
								{t('belege.reminderNote')}
							</p>
						{/if}
						{#if extractionNote(selected)}
							<p class="mt-3 text-sm text-danger" role="status" data-testid="extract-note">
								{extractionNote(selected)}
							</p>
						{/if}
						{#if client && !needsConfirmation(selected) && !String(selected.mime).startsWith('image/')}
							<button
								type="button"
								class="mt-3 {primary}"
								onclick={() => selected && extract(selected)}
								disabled={busy.has(selected.id) || bulk !== null}
								data-testid="extract"
								>{busy.has(selected.id)
									? t('belege.extractBusy')
									: selected.extraction
										? t('belege.extractAgain')
										: t('belege.extract')}</button
							>
							{#if bridgeInfo && !bridgeInfo.llm}
								<p class="mt-2 text-xs text-danger">{t('belege.llmNotSetUp')}</p>
							{/if}
						{/if}
					</div>
				{/if}
			</aside>
		</div>
	{/if}
</div>
