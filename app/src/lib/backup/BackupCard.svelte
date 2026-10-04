<script>
	// Integrationen → Backup (issue #77): everything this browser keeps, sealed
	// with a key from the passkey, uploaded from here to Aleph's IPFS host, and
	// kept there by a STORE message for the bridge's Aleph account. Once that
	// account has let this browser's own key do so
	// (`pnpm setup:aleph -- --authorize`), the browser signs the STORE itself and
	// the bridge does not have to run (keeper.js); until then the bridge signs
	// with its own key, as before. The bridge never sees the backup; Aleph never
	// sees what is in it.
	import { createBridgeClient } from '$lib/bridge/client.js';
	import CopyButton from '$lib/CopyButton.svelte';
	import WayOut from '$lib/help/WayOut.svelte';
	import { app, currentStore, makeBackup } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { releaseName } from '$lib/build-info.js';
	import { card } from '$lib/ui/styles.js';
	import { backupName, loadBackups, rememberBackup } from './history.js';
	import {
		BACKUP_CHANNEL,
		BackupRefusedError,
		alephEndpoints,
		backupAddressOf,
		creditsOf,
		ensureBackupKey,
		isAddress,
		isGranted,
		keepWithKey,
		loadOwner,
		saveOwner
	} from './keeper.js';

	let { url, token } = $props();
	const client = $derived(createBridgeClient({ url, token }));

	let status = $state(
		/** @type {{ configured: boolean, address?: string, credits?: number | null, ingestUrl?: string, gateways?: string[], apiHost?: string } | null} */ (
			null
		)
	);
	const endpoints = $derived(alephEndpoints(status));
	/** @type {string | null} the account that pays */
	let owner = $state(null);
	let ownerInput = $state('');
	/** @type {Uint8Array | null} this browser's Aleph key */
	let key = $state(null);
	/** @type {string | null} its address: what the grant names */
	let address = $state(null);
	/** @type {boolean | null} whether the account lets it keep backups; null: not known */
	let granted = $state(null);
	/** @type {number | null} */
	let credits = $state(null);
	let checking = $state(false);
	/** @type {import('./history.js').BackupRecord[]} */
	let backups = $state([]);
	/** @type {'' | 'packing' | 'uploading' | 'keeping'} */
	let step = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {import('./history.js').BackupRecord | null} */
	let made = $state(null);
	/** @type {import('./archive.js').BackupProgress | null} what packing is at */
	let progress = $state(null);

	/** The bridge signs while this key is not granted, if it can. */
	const bridgeSigns = $derived(Boolean(token && status?.configured));
	const canBackUp = $derived(
		Boolean(owner) && (granted === true || bridgeSigns) && !app.network.paused
	);
	const command = $derived(
		address ? `pnpm setup:aleph -- --authorize ${address} --channel ${BACKUP_CHANNEL}` : ''
	);

	$effect(() => {
		load(token);
	});

	/** @param {string | null} withToken */
	async function load(withToken) {
		error = null;
		const store = currentStore();
		if (!store) return;
		backups = await loadBackups(store.settings);
		key = await ensureBackupKey(store.settings);
		address = await backupAddressOf(key);
		owner = await loadOwner(store.settings);
		status = null;
		if (withToken) {
			try {
				status = (await client.backupStatus()).aleph;
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}
		// The bridge's account is the one that pays: kept, so that this browser
		// knows it without the bridge.
		if (!owner && status?.configured && isAddress(status.address)) {
			owner = await saveOwner(store.settings, String(status.address));
		}
		ownerInput = owner ?? '';
		await check();
	}

	async function check() {
		if (!owner || !address) return;
		checking = true;
		try {
			const [g, c] = await Promise.allSettled([
				isGranted({ owner, address, endpoints }),
				owner === status?.address && status?.credits !== undefined
					? Promise.resolve(status.credits ?? null)
					: creditsOf({ owner, endpoints })
			]);
			granted = g.status === 'fulfilled' ? g.value : null;
			credits = c.status === 'fulfilled' ? c.value : null;
		} finally {
			checking = false;
		}
	}

	async function setOwner() {
		const store = currentStore();
		if (!store) return;
		error = null;
		if (!isAddress(ownerInput)) {
			error = t('backup.ownerInvalid');
			return;
		}
		owner = await saveOwner(store.settings, ownerInput);
		ownerInput = owner;
		granted = null;
		credits = null;
		await check();
	}

	async function backUp() {
		const store = currentStore();
		if (!store || !owner || !key) return;
		error = null;
		made = null;
		progress = null;
		try {
			step = 'packing';
			const at = new Date();
			const built = await makeBackup({
				appVersion: releaseName() || 'dev',
				onProgress: (p) => (progress = p)
			});
			step = 'uploading';
			// The storage bridge's Aleph backend, in the browser: no key, no bridge.
			const { createAlephBackend } = await import(
				'@le-space/orbitdb-storage-bridge/backends/aleph'
			);
			const handle = await createAlephBackend({ ingestUrl: endpoints.ingestUrl }).putBlob(
				built.sealed,
				{ name: backupName(at) }
			);
			step = 'keeping';
			const kept =
				granted === true
					? await keepWithKey({ cid: handle.id, owner, key, endpoints })
					: { ...(await client.alephKeep(handle.id)), sender: status?.address };
			/** @type {import('./history.js').BackupRecord} */
			const record = {
				at: at.toISOString(),
				provider: 'aleph',
				cid: handle.id,
				size: built.sealed.length,
				status: kept.status,
				itemHash: kept.itemHash,
				address: kept.address,
				...(kept.sender ? { sender: kept.sender } : {}),
				entries: databasesOf(built.manifest).reduce((n, d) => n + d.entries, 0),
				databases: databasesOf(built.manifest),
				files: built.manifest.files.length,
				blocks: built.blocks,
				missing: built.manifest.missing
			};
			backups = await rememberBackup(store.settings, record);
			made = record;
		} catch (e) {
			error =
				e instanceof BackupRefusedError
					? e.kind === 'credits'
						? t('messages.bridge.alephNotKept', {
								credits: Number(e.reason.credits).toLocaleString(intlLocale()),
								required: Number(e.reason.required).toLocaleString(intlLocale())
							})
						: t('messages.bridge.alephRejected', { error: String(e.reason.errorCode ?? '') })
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			step = '';
			progress = null;
		}
		// What a backup costs shows on the account's credits.
		if (owner) credits = await creditsOf({ owner, endpoints }).catch(() => credits);
	}

	/**
	 * Per database, as the app names them.
	 *
	 * @param {import('./archive.js').BackupManifest} manifest
	 * @returns {{ collection: string, entries: number }[]}
	 */
	const databasesOf = (manifest) =>
		manifest.metadata.databases.map((/** @type {any} */ d) => ({
			collection: String(d.collection ?? d.name),
			entries: Number(d.entryCount ?? 0)
		}));

	/** The packing step, with its counts. @param {import('./archive.js').BackupProgress | null} p */
	const packing = (p) =>
		!p
			? t('backup.step.packing')
			: p.stage === 'database'
				? t('backup.progress.database', {
						index: p.index + 1,
						total: p.total,
						name: t(`storage.databases.${p.name}`),
						entries: p.entries
					})
				: p.stage === 'files'
					? t('backup.progress.files', { done: p.done, total: p.total })
					: t('backup.progress.sealing', { size: size(p.bytes) });

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	/** @param {number} bytes */
	const size = (bytes) =>
		bytes < 1e6
			? `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(bytes / 1e3)} kB`
			: `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: bytes < 1e7 ? 1 : 0 }).format(bytes / 1e6)} MB`;
	/** @param {string} iso */
	const when = (iso) =>
		new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		);
	const creditsText = (/** @type {number} */ n) => Math.round(n).toLocaleString(intlLocale());
	const kept = (/** @type {string} */ s) =>
		s === 'processed' ? t('backup.kept') : t('backup.pending');
</script>

{#snippet contents(/** @type {import('./history.js').BackupRecord} */ r)}
	<table class="mt-2 w-full max-w-md text-sm" data-testid="backup-contents">
		<thead class="text-xs text-faint">
			<tr>
				<th scope="col" class="py-0.5 text-left font-medium">{t('storage.database')}</th>
				<th scope="col" class="py-0.5 text-right font-medium">{t('storage.entries')}</th>
			</tr>
		</thead>
		<tbody>
			{#each r.databases ?? [] as d (d.collection)}
				<tr data-testid="backup-contents-row" data-collection={d.collection}>
					<th scope="row" class="py-0.5 text-left font-normal text-text"
						>{t(`storage.databases.${d.collection}`)}</th
					>
					<td class="py-0.5 text-right font-mono text-heading">{d.entries}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot class="border-t border-border">
			<tr>
				<th scope="row" class="py-0.5 text-left font-normal text-text">{t('backup.files')}</th>
				<td class="py-0.5 text-right font-mono text-heading" data-testid="backup-contents-files"
					>{r.files}</td
				>
			</tr>
			{#if r.blocks}
				<tr>
					<th scope="row" class="py-0.5 text-left font-normal text-faint">{t('backup.blocks')}</th>
					<td class="py-0.5 text-right font-mono text-faint">{r.blocks}</td>
				</tr>
			{/if}
		</tfoot>
	</table>
{/snippet}

<section class={card} aria-labelledby="backup-h" data-testid="backup-card">
	<h2 id="backup-h" class="text-lg font-semibold text-heading">{t('backup.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('backup.what')}</p>
	{#if token && status && !status.configured}
		<p class="mt-2 text-sm text-text" data-testid="backup-not-set-up">
			{t('backup.notSetUp')}
			<code class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-heading"
				>pnpm setup:aleph</code
			>
		</p>
	{/if}

	{#if owner}
		<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
			<dt class="text-faint">{t('backup.account')}</dt>
			<dd class="min-w-0">
				<CopyButton
					text={owner}
					label={t('backup.copyAddress')}
					testid="backup-address"
					valueClass="font-mono text-xs break-all text-heading">{owner}</CopyButton
				>
			</dd>
			<dt class="text-faint">{t('backup.credits')}</dt>
			<dd class="text-heading" data-testid="backup-credits">
				{credits === null ? t('backup.creditsUnknown') : creditsText(credits)}
			</dd>
			<dt class="text-faint">{t('backup.ownKey')}</dt>
			<dd class="min-w-0">
				<CopyButton
					text={address ?? ''}
					label={t('backup.copyAddress')}
					testid="backup-key-address"
					valueClass="font-mono text-xs break-all text-heading">{address}</CopyButton
				>
			</dd>
		</dl>
		{#if credits === 0}
			<p class="text-warn mt-2 text-sm" data-testid="backup-no-credits">{t('backup.noCredits')}</p>
		{/if}
		{#if granted === true}
			<p class="mt-2 text-sm text-text" data-testid="backup-granted">{t('backup.granted')}</p>
		{:else}
			<div class="mt-2 text-sm text-text" data-testid="backup-not-granted">
				<p>
					{granted === false
						? bridgeSigns
							? t('backup.notGrantedBridge')
							: t('backup.notGranted')
						: t('backup.grantUnknown')}
				</p>
				<CopyButton
					text={command}
					label={t('backup.copyCommand')}
					testid="backup-grant-command"
					valueClass="font-mono text-xs break-all text-heading">{command}</CopyButton
				>
			</div>
		{/if}
		<p class="mt-3 text-xs text-faint">{t('backup.leaves')}</p>
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<button
				type="button"
				class={button}
				onclick={backUp}
				disabled={Boolean(step) || !canBackUp}
				data-testid="backup-now">{t('backup.now')}</button
			>
			<button
				type="button"
				class={button}
				onclick={check}
				disabled={Boolean(step) || checking}
				data-testid="backup-check">{t('backup.check')}</button
			>
			{#if step}
				<span class="text-sm text-faint" role="status" data-testid="backup-step"
					>{step === 'packing' ? packing(progress) : t(`backup.step.${step}`)}</span
				>
			{:else if app.network.paused}
				<span class="text-sm text-faint">{t('backup.paused')}</span>
			{/if}
		</div>
	{:else}
		<p class="mt-2 text-sm text-text" data-testid="backup-no-owner">{t('backup.noOwner')}</p>
	{/if}

	<form
		class="mt-3 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			setOwner();
		}}
	>
		<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
			>{t('backup.ownerLabel')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
				bind:value={ownerInput}
				placeholder="0x…"
				autocomplete="off"
				spellcheck="false"
				data-testid="backup-owner"
			/>
		</label>
		<button
			type="submit"
			class={button}
			disabled={Boolean(step) || !ownerInput.trim() || ownerInput.trim() === owner}
			data-testid="backup-owner-save">{t('backup.ownerSave')}</button
		>
	</form>
	<p class="mt-1 text-xs text-faint">{t('backup.ownerHint')}</p>

	{#if made}
		<div class="mt-3 text-sm" role="status" data-testid="backup-made">
			<p class="text-heading">
				{t('backup.made', {
					size: size(made.size),
					entries: made.entries,
					files: made.files,
					kept: kept(made.status)
				})}
			</p>
			<p class="mt-1 text-text">
				{t('backup.cid')}
				<CopyButton
					text={made.cid}
					label={t('backup.copyCid')}
					testid="backup-cid"
					valueClass="font-mono text-xs break-all text-heading">{made.cid}</CopyButton
				>
			</p>
			{@render contents(made)}
			{#if made.missing > 0}
				<p class="text-warn mt-1" data-testid="backup-missing">
					{t('backup.missing', { count: made.missing })}
				</p>
			{/if}
		</div>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="backup-error">{error}</p>
		<WayOut message={error} />
	{/if}
	{#if backups.length}
		<h3 class="mt-4 text-sm font-semibold text-heading">{t('backup.history')}</h3>
		<ul class="mt-1 divide-y divide-border text-sm" data-testid="backup-history">
			{#each backups as b (b.cid + b.at)}
				<li
					class="flex flex-wrap items-baseline justify-between gap-2 py-1.5"
					data-testid="backup-row"
				>
					<span class="text-heading">{when(b.at)}</span>
					<span class="text-faint">{size(b.size)} · {kept(b.status)}</span>
					<span class="w-full font-mono text-xs break-all text-faint">{b.cid}</span>
					{#if b.databases}
						<details class="w-full" data-testid="backup-row-details">
							<summary class="cursor-pointer text-xs text-faint">{t('backup.contents')}</summary>
							{@render contents(b)}
						</details>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
