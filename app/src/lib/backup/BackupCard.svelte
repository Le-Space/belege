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
	import { app, currentStore, makeBackup, makeIncrement } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { releaseName } from '$lib/build-info.js';
	import { card } from '$lib/ui/styles.js';
	import { backupName, loadBackups, rememberBackup, updateBackup } from './history.js';
	import { chainAfter, chainFromBase, loadChain, saveChain } from './chain.js';
	import {
		BACKUP_CHANNEL,
		BackupRefusedError,
		alephEndpoints,
		backupAddressOf,
		creditsOf,
		creditsPerDay,
		ensureBackupKey,
		isAddress,
		isGranted,
		keepWithKey,
		loadOwner,
		saveOwner,
		storeStatus
	} from './keeper.js';

	let { url, token } = $props();
	/** The backup without public IPFS, being planned. */
	const FILECOIN_ISSUE = 'https://github.com/Le-Space/belege/issues/459';
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
	/** @type {'' | 'packing' | 'asking' | 'uploading' | 'keeping'} */
	let step = $state('');
	/** @type {string | null} */
	let error = $state(null);
	/** @type {import('./history.js').BackupRecord | null} */
	let made = $state(null);
	/** @type {import('./archive.js').BackupProgress | null} what packing is at */
	let progress = $state(null);
	/** The address field: open while there is no account, or to change it. */
	let editingOwner = $state(false);
	/** A backup packed and waiting for "Hochladen" because of what it costs. */
	let asking = $state(/** @type {{ size: number, perDay: number, days: number } | null} */ (null));
	/** @type {((go: boolean) => void) | null} */
	let answer = null;
	/** Which history row is being kept again, by CID and time. */
	let rekeeping = $state('');
	/** @type {import('./archive.js').BackupChain | null} where the chain of backups stands (#454) */
	let chain = $state(null);
	/** The last "Jetzt sichern" found nothing new. */
	let nothingNew = $state(false);
	/** The chain's full backup, as this browser's history has it (another device's: not there). */
	const chainBase = $derived(chain ? backups.find((b) => b.cid === chain?.base) : undefined);
	/** An increment builds on its full backup only while Aleph may keep that. */
	const chainUsable = $derived(
		Boolean(chain) && !['unknown', 'rejected', 'forgotten'].includes(chainBase?.status ?? '')
	);

	/** The bridge signs while this key is not granted, if it can. */
	const bridgeSigns = $derived(Boolean(token && status?.configured));
	const canBackUp = $derived(
		Boolean(owner) && (granted === true || bridgeSigns) && !app.network.paused
	);
	const command = $derived(
		address ? `pnpm setup:aleph -- --authorize ${address} --channel ${BACKUP_CHANNEL}` : ''
	);
	// What the backups Aleph keeps cost a day, together, and how long the
	// credits last at that rate. Every backup is a whole copy, kept until forgotten.
	const keptBytes = $derived(
		backups.filter((b) => b.status === 'processed').reduce((n, b) => n + b.size, 0)
	);
	const keptPerDay = $derived(creditsPerDay(keptBytes));
	/** Below this many days of credits, a new backup asks first. */
	const ASK_BELOW_DAYS = 30;
	/** @param {number} perDay */
	const daysFor = (perDay) => (credits === null || perDay <= 0 ? Infinity : credits / perDay);

	$effect(() => {
		load(token);
	});

	/** @param {string | null} withToken */
	async function load(withToken) {
		error = null;
		const store = currentStore();
		if (!store) return;
		backups = await loadBackups(store.settings);
		chain = await loadChain(store.settings);
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
				creditsOf({ owner, endpoints })
			]);
			granted = g.status === 'fulfilled' ? g.value : null;
			// Aleph's answer now; the bridge's, read when the card opened, only
			// when Aleph does not answer (it was stale once credits were added).
			credits =
				c.status === 'fulfilled' && c.value !== null
					? c.value
					: owner === status?.address
						? (status?.credits ?? null)
						: null;
			await settle();
		} finally {
			checking = false;
		}
	}

	/**
	 * Ask Aleph again what became of every backup: it answers `pending` first
	 * and decides later, a STORE it never took is `unknown`, and one it kept
	 * can be forgotten since – none of which shows unless someone asks.
	 */
	async function settle() {
		const store = currentStore();
		if (!store) return;
		for (const b of backups) {
			if (!b.itemHash || b.status === 'forgotten') continue;
			const now = await storeStatus({ itemHash: b.itemHash, endpoints }).catch(() => null);
			if (now && now !== b.status) backups = await updateBackup(store.settings, b, { status: now });
		}
	}

	/**
	 * Have Aleph keep what is on its IPFS host: signed by this browser's key
	 * once granted, else by the bridge.
	 *
	 * @param {string} cid
	 * @param {string} [ref] an increment's: its full backup's CID
	 * @returns {Promise<{ status: string, itemHash: string, address?: string, sender?: string, ref?: string }>}
	 */
	async function keep(cid, ref) {
		if (granted === true && owner && key) return keepWithKey({ cid, owner, key, endpoints, ref });
		return { ...(await client.alephKeep(cid, ref)), sender: status?.address };
	}

	/** @param {unknown} e */
	const refused = (e) =>
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

	/**
	 * A backup Aleph does not know, or refused, kept again: the same file on
	 * Aleph's IPFS host, a new STORE for it – nothing uploaded again.
	 *
	 * @param {import('./history.js').BackupRecord} b
	 */
	async function keepAgain(b) {
		const store = currentStore();
		if (!store || !owner) return;
		error = null;
		rekeeping = b.cid + b.at;
		try {
			const kept = await keep(b.cid, b.kind === 'increment' ? b.base : undefined);
			backups = await updateBackup(store.settings, b, {
				status: kept.status,
				itemHash: kept.itemHash,
				...(kept.sender ? { sender: kept.sender } : {})
			});
		} catch (e) {
			error = refused(e);
		} finally {
			rekeeping = '';
		}
		if (owner) credits = await creditsOf({ owner, endpoints }).catch(() => credits);
	}

	/** The answer to "Hochladen?". @param {boolean} go */
	function decide(go) {
		answer?.(go);
		answer = null;
		asking = null;
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
		editingOwner = false;
		granted = null;
		credits = null;
		await check();
	}

	/**
	 * "Jetzt sichern": after a full backup, only what is new since the chain's
	 * last backup (#454) – an increment, kept with its base's CID as `ref`.
	 * The first backup, one whose base Aleph does not keep, and "Neues
	 * Vollbackup" are full ones, and start a new chain.
	 *
	 * @param {{ full?: boolean }} [options]
	 */
	async function backUp({ full = false } = {}) {
		const store = currentStore();
		if (!store || !owner || !key) return;
		error = null;
		made = null;
		nothingNew = false;
		progress = null;
		const continuing = !full && chainUsable && chain ? chain : null;
		try {
			step = 'packing';
			const at = new Date();
			const appVersion = releaseName() || 'dev';
			const onProgress = (/** @type {any} */ p) => (progress = p);
			const built = continuing
				? await makeIncrement({ chain: continuing, appVersion, onProgress })
				: await makeBackup({ appVersion, onProgress });
			if (!built) {
				nothingNew = true;
				return;
			}
			// A whole copy costs credits every day it is kept: when the credits
			// would not last a month with it, ask before it goes up.
			const perDay = creditsPerDay(built.sealed.length);
			const days = daysFor(keptPerDay + perDay);
			if (days < ASK_BELOW_DAYS) {
				step = 'asking';
				asking = { size: built.sealed.length, perDay, days };
				const go = await new Promise((resolve) => (answer = resolve));
				if (!go) return;
			}
			step = 'uploading';
			// The storage bridge's Aleph backend, in the browser: no key, no bridge.
			const { createAlephBackend } = await import(
				'@le-space/orbitdb-storage-bridge/backends/aleph'
			);
			const handle = await createAlephBackend({ ingestUrl: endpoints.ingestUrl }).putBlob(
				built.sealed,
				{ name: backupName(at, continuing ? continuing.sequence + 1 : 0) }
			);
			step = 'keeping';
			const kept = await keep(handle.id, continuing?.base);
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
				...('heads' in built
					? {
							kind: /** @type {const} */ ('increment'),
							base: continuing?.base,
							sequence: (continuing?.sequence ?? 0) + 1,
							entries: built.entries,
							databases: built.databases,
							files: built.files.length,
							blocks: built.blocks,
							missing: built.missing
						}
					: {
							kind: /** @type {const} */ ('full'),
							entries: databasesOf(built.manifest).reduce((n, d) => n + d.entries, 0),
							databases: databasesOf(built.manifest),
							files: built.manifest.files.length,
							blocks: built.blocks,
							missing: built.manifest.missing
						})
			};
			backups = await rememberBackup(store.settings, record);
			made = record;
			// The chain moves once Aleph has taken it. An increment the bridge
			// kept without its `ref` (an older bridge) is not found by its chain:
			// the next one ships everything since again.
			if (kept.status !== 'rejected') {
				if (!('heads' in built)) {
					chain = await saveChain(store.settings, chainFromBase(built.manifest, handle.id));
				} else if (continuing && kept.ref === continuing.base) {
					chain = await saveChain(store.settings, chainAfter(continuing, built, handle.id));
				} else {
					error = t('backup.oldBridge');
				}
			}
		} catch (e) {
			error = refused(e);
		} finally {
			step = '';
			progress = null;
			asking = null;
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
	/** Credits a day: a small backup costs less than one. @param {number} n */
	const perDayText = (n) =>
		n.toLocaleString(intlLocale(), { maximumFractionDigits: n < 10 ? 2 : 0 });
	const kept = (/** @type {string} */ s) =>
		s === 'processed'
			? t('backup.kept')
			: s === 'unknown'
				? t('backup.unknown')
				: s === 'rejected'
					? t('backup.rejected')
					: t('backup.pending');
	/** Days, as "about 8" or "more than a year". @param {number} d */
	const daysText = (d) =>
		d > 365
			? t('backup.days.overYear')
			: t('backup.days.about', { days: Math.max(0, Math.floor(d)) });
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
	<!-- Said before anything goes up, not in a footnote: public, but sealed. -->
	<div
		class="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
		role="note"
		aria-labelledby="backup-public-h"
		data-testid="backup-public"
	>
		<p id="backup-public-h" class="font-semibold">{t('backup.public.title')}</p>
		<ul class="mt-1 list-disc space-y-1 pl-5">
			<li>{t('backup.public.ipfs')}</li>
			<li>{t('backup.public.cids')}</li>
			<li>{t('backup.public.sealed')}</li>
			<li>{t('backup.public.upside')}</li>
		</ul>
		<p class="mt-2">
			{t('backup.public.alternative')}
			<a
				class="underline"
				href={FILECOIN_ISSUE}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="backup-public-alternative">{t('backup.public.alternativeLink')}</a
			>
		</p>
	</div>
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
			<dd class="flex min-w-0 flex-wrap items-center gap-x-2">
				<CopyButton
					text={owner}
					label={t('backup.copyAddress')}
					testid="backup-address"
					valueClass="font-mono text-xs break-all text-heading">{owner}</CopyButton
				>
				{#if !editingOwner}
					<button
						type="button"
						class="text-xs text-link underline"
						onclick={() => (editingOwner = true)}
						disabled={Boolean(step)}
						data-testid="backup-owner-change">{t('backup.ownerChange')}</button
					>
				{/if}
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
				onclick={() => backUp()}
				disabled={Boolean(step) || !canBackUp}
				data-testid="backup-now">{t('backup.now')}</button
			>
			{#if chainUsable}
				<button
					type="button"
					class={button}
					onclick={() => backUp({ full: true })}
					disabled={Boolean(step) || !canBackUp}
					data-testid="backup-full">{t('backup.full')}</button
				>
			{/if}
			<button
				type="button"
				class={button}
				onclick={check}
				disabled={Boolean(step) || checking}
				data-testid="backup-check">{t('backup.check')}</button
			>
			{#if step && step !== 'asking'}
				<span class="text-sm text-faint" role="status" data-testid="backup-step"
					>{step === 'packing' ? packing(progress) : t(`backup.step.${step}`)}</span
				>
			{:else if app.network.paused}
				<span class="text-sm text-faint">{t('backup.paused')}</span>
			{:else if nothingNew}
				<span class="text-sm text-text" role="status" data-testid="backup-nothing-new"
					>{t('backup.nothingNew')}</span
				>
			{/if}
		</div>
		<p class="mt-2 text-xs text-faint" data-testid="backup-chain">
			{chainUsable && chain
				? t('backup.chainNext', {
						sequence: chain.sequence + 1,
						date: chainBase ? when(chainBase.at) : t('backup.chainElsewhere')
					})
				: t('backup.chainFirst')}
		</p>
		{#if asking}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm"
				role="alertdialog"
				aria-labelledby="backup-ask-text"
				data-testid="backup-ask"
			>
				<p id="backup-ask-text" class="text-heading">
					{t('backup.ask', {
						size: size(asking.size),
						perDay: perDayText(asking.perDay),
						days: daysText(asking.days)
					})}
				</p>
				<div class="mt-2 flex flex-wrap gap-2">
					<button
						type="button"
						class={button}
						onclick={() => decide(true)}
						data-testid="backup-upload">{t('backup.upload')}</button
					>
					<button
						type="button"
						class={button}
						onclick={() => decide(false)}
						data-testid="backup-cancel">{t('backup.cancel')}</button
					>
				</div>
			</div>
		{:else if keptBytes > 0}
			<p class="mt-2 text-xs text-faint" data-testid="backup-cost">
				{t('backup.cost', {
					size: size(keptBytes),
					perDay: perDayText(keptPerDay),
					days: daysText(daysFor(keptPerDay))
				})}
			</p>
		{/if}
	{:else}
		<p class="mt-2 text-sm text-text" data-testid="backup-no-owner">{t('backup.noOwner')}</p>
	{/if}

	{#if !owner || editingOwner}
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
			{#if owner}
				<button
					type="button"
					class={button}
					onclick={() => {
						ownerInput = owner ?? '';
						editingOwner = false;
					}}
					data-testid="backup-owner-cancel">{t('backup.cancel')}</button
				>
			{/if}
		</form>
		<p class="mt-1 text-xs text-faint">{t('backup.ownerHint')}</p>
	{/if}

	{#if made}
		<div class="mt-3 text-sm" role="status" data-testid="backup-made">
			<p class="text-heading">
				{t(made.kind === 'increment' ? 'backup.madeIncrement' : 'backup.made', {
					size: size(made.size),
					entries: made.entries,
					files: made.files,
					sequence: made.sequence ?? 0,
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
					<span class="text-heading"
						>{when(b.at)}
						<span class="text-xs text-faint" data-testid="backup-row-kind"
							>· {b.kind === 'increment'
								? t('backup.kindIncrement', { sequence: b.sequence ?? 0 })
								: t('backup.kindFull')}</span
						></span
					>
					<span class="text-faint">{size(b.size)} · {kept(b.status)}</span>
					<span class="w-full font-mono text-xs break-all text-faint">{b.cid}</span>
					{#if b.itemHash}
						<span class="w-full text-xs text-faint" data-testid="backup-row-order"
							>{t('backup.order')}
							<a
								class="font-mono break-all text-link underline"
								href={`${endpoints.apiHost}/api/v0/messages/${b.itemHash}`}
								target="_blank"
								rel="noopener noreferrer">{b.itemHash}</a
							></span
						>
					{/if}
					{#if b.status === 'unknown' || b.status === 'rejected'}
						<span class="flex w-full flex-wrap items-center gap-2 text-xs text-text">
							{b.status === 'unknown' ? t('backup.unknownHint') : t('backup.rejectedHint')}
							<button
								type="button"
								class={button}
								onclick={() => keepAgain(b)}
								disabled={Boolean(step) || Boolean(rekeeping) || !canBackUp}
								data-testid="backup-rekeep"
								>{rekeeping === b.cid + b.at
									? t('backup.step.keeping')
									: t('backup.rekeep')}</button
							>
						</span>
					{/if}
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
