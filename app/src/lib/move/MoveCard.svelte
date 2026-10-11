<script>
	// Integrationen → Backup → "Bücher umziehen" (#328, step 2): books of one
	// passkey into the empty books of another (move/book-move.js).
	//
	// On the target (empty books) "Bücher übernehmen …" makes a one-time key
	// and shows it as a QR code and as text, with a fingerprint. On the source
	// "In andere Bücher umziehen …" takes that key (pasted or scanned), shows
	// the same fingerprint, and saves the sealed file. Back on the target the
	// file is read, its header shown, and only then taken over. Every step is a
	// click; nothing happens on load. The key lives in this page's memory only:
	// reloaded, a new one is needed.
	import { onMount } from 'svelte';
	import { renderSVG } from 'uqr';
	import { currentBlobs, currentStore, refreshNow } from '$lib/session.svelte.js';
	import { releaseName } from '$lib/build-info.js';
	import { formatDate } from '$lib/bank/format.js';
	import { t } from '$lib/i18n/index.js';
	import { card } from '$lib/ui/styles.js';
	import QrScan from '$lib/sync/QrScan.svelte';
	import {
		MoveError,
		createMoveKey,
		isEmptyBooks,
		keyFingerprint,
		openMoveFile,
		packBooks,
		parseMoveKey,
		readMoveHeader,
		takeOverBooks
	} from './book-move.js';

	const button =
		'rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-heading hover:bg-surface-2 disabled:opacity-50';

	/** @type {boolean | null} null until known */
	let empty = $state(null);
	/** @type {'' | 'send' | 'receive'} */
	let mode = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// The source.
	let keyText = $state('');
	let target = $derived(parseMoveKey(keyText));
	/** @type {import('./book-move.js').MoveHeader | null} */
	let packed = $state(null);

	// The target.
	/** @type {ReturnType<typeof createMoveKey> | null} */
	let ownKey = $state(null);
	/** @type {{ file: Uint8Array, header: import('./book-move.js').MoveHeader } | null} */
	let chosen = $state(null);
	/** @type {{ records: number, files: number } | null} */
	let done = $state(null);

	onMount(async () => {
		const store = /** @type {any} */ (currentStore());
		if (store) empty = await isEmptyBooks(store);
	});

	/** @param {unknown} e */
	function explain(e) {
		error =
			e instanceof MoveError
				? t(`move.errors.${e.code}`)
				: String(/** @type {any} */ (e)?.message ?? e);
	}

	async function pack() {
		const store = /** @type {any} */ (currentStore());
		const blobs = currentBlobs();
		if (!store || !blobs || !target) return;
		busy = true;
		error = null;
		try {
			const { file, header } = await packBooks({
				store,
				blobs,
				seal: { to: target },
				appVersion: releaseName() || 'dev'
			});
			const href = URL.createObjectURL(
				new Blob([/** @type {BlobPart} */ (file)], { type: 'application/octet-stream' })
			);
			const a = document.createElement('a');
			a.href = href;
			a.download = `Belege-Umzug_${header.packedAt.slice(0, 10)}.belege`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(href), 1000);
			packed = header;
		} catch (e) {
			explain(e);
		} finally {
			busy = false;
		}
	}

	function receive() {
		mode = 'receive';
		error = null;
		ownKey = createMoveKey();
	}

	/** @param {Event} event */
	async function choose(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const picked = input.files?.[0];
		error = null;
		chosen = null;
		if (!picked) return;
		try {
			const file = new Uint8Array(await picked.arrayBuffer());
			const { header } = readMoveHeader(file);
			if (
				header.seal.kind === 'x25519' &&
				ownKey &&
				header.seal.to !== keyFingerprint(ownKey.publicKey)
			) {
				throw new MoveError('another key', 'key');
			}
			chosen = { file, header };
		} catch (e) {
			explain(e);
		}
	}

	async function takeOver() {
		const store = /** @type {any} */ (currentStore());
		const blobs = currentBlobs();
		if (!store || !blobs || !chosen || !ownKey) return;
		busy = true;
		error = null;
		try {
			const opened = await openMoveFile(chosen.file, ownKey);
			done = await takeOverBooks({ store, blobs, opened });
			// Used: the key is gone, and so are the decrypted books.
			ownKey = null;
			chosen = null;
			empty = false;
			await refreshNow();
		} catch (e) {
			explain(e);
		} finally {
			busy = false;
		}
	}

	/** @param {import('./book-move.js').MoveHeader} header */
	const summary = (header) =>
		t('move.summary', {
			date: formatDate(header.packedAt.slice(0, 10)),
			transactions: header.counts.transactions ?? 0,
			receipts: header.counts.receipts ?? 0,
			files: header.counts.files ?? 0
		});
	/** @param {import('./book-move.js').MoveHeader} header */
	const leftOutText = (header) =>
		header.leftOut
			.map((k) => t(`move.leftOut.${k.startsWith('device:') ? 'devices' : k}`))
			.join(', ');
</script>

<section class={card} aria-labelledby="move-h" data-testid="move-card">
	<h2 id="move-h" class="text-lg font-semibold text-heading">{t('move.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('move.intro')}</p>

	{#if done}
		<div class="mt-3 text-sm" role="status" data-testid="move-done">
			<p class="text-heading">{t('move.done', { records: done.records, files: done.files })}</p>
			<p class="mt-1 text-text">{t('move.doneNext')}</p>
		</div>
	{:else if empty === true}
		{#if mode !== 'receive'}
			<button type="button" class="{button} mt-3" onclick={receive} data-testid="move-receive"
				>{t('move.receive')}</button
			>
		{:else if ownKey}
			<ol class="mt-3 list-decimal space-y-3 pl-5 text-sm text-text">
				<li>
					{t('move.receiveStep1')}
					<div
						class="mt-2 w-48 rounded-lg bg-white p-2 leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
						data-testid="move-key-qr"
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of a key made here -->
						{@html renderSVG(ownKey.text, { border: 2 })}
					</div>
					<input
						class="mt-2 w-full max-w-md rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
						readonly
						value={ownKey.text}
						aria-label={t('move.keyText')}
						data-testid="move-key-text"
					/>
					<p class="mt-1">
						{t('move.fingerprint')}
						<span class="font-mono text-heading" data-testid="move-fingerprint"
							>{keyFingerprint(ownKey.publicKey)}</span
						>
					</p>
				</li>
				<li>
					<label class="flex flex-col gap-1">
						<span>{t('move.receiveStep2')}</span>
						<input type="file" accept=".belege" onchange={choose} data-testid="move-file" />
					</label>
					{#if chosen}
						<p class="mt-2" data-testid="move-file-summary">{summary(chosen.header)}</p>
						{#if chosen.header.leftOut.length}
							<p class="mt-1 text-faint">
								{t('move.leftOutNote', { list: leftOutText(chosen.header) })}
							</p>
						{/if}
						<button
							type="button"
							class="{button} mt-2"
							disabled={busy}
							onclick={takeOver}
							data-testid="move-take-over">{busy ? t('move.busy') : t('move.takeOver')}</button
						>
					{/if}
				</li>
			</ol>
		{/if}
	{:else if empty === false}
		{#if mode !== 'send'}
			<button
				type="button"
				class="{button} mt-3"
				onclick={() => {
					mode = 'send';
					error = null;
				}}
				data-testid="move-send">{t('move.send')}</button
			>
		{:else}
			<div class="mt-3 space-y-2 text-sm text-text">
				<p>{t('move.sendStep1')}</p>
				<div class="flex flex-wrap items-center gap-2">
					<input
						class="w-full max-w-md rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
						bind:value={keyText}
						placeholder="belege-move:…"
						aria-label={t('move.keyText')}
						data-testid="move-key-input"
					/>
					<QrScan onscan={(text) => (keyText = text)} class={button} />
				</div>
				{#if keyText.trim() && !target}
					<p class="text-danger" data-testid="move-key-invalid">{t('move.keyInvalid')}</p>
				{:else if target}
					<p>
						{t('move.fingerprintCheck')}
						<span class="font-mono text-heading" data-testid="move-key-fingerprint"
							>{keyFingerprint(target)}</span
						>
					</p>
					<button
						type="button"
						class={button}
						disabled={busy}
						onclick={pack}
						data-testid="move-pack">{busy ? t('move.busy') : t('move.pack')}</button
					>
				{/if}
				{#if packed}
					<p class="mt-2 text-heading" role="status" data-testid="move-packed">
						{t('move.packed')}
						{summary(packed)}
					</p>
					{#if packed.leftOut.length}
						<p class="text-faint">{t('move.leftOutNote', { list: leftOutText(packed) })}</p>
					{/if}
					<p class="text-faint">{t('move.untouched')}</p>
				{/if}
			</div>
		{/if}
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="move-error">{error}</p>
	{/if}
</section>
