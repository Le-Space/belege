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
	import { untrack } from 'svelte';
	import { app, chainFitsBooks, currentStore } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { card } from '$lib/ui/styles.js';
	import { dropBackup, loadBackups, updateBackup } from './history.js';
	import { loadChain } from './chain.js';
	import {
		askRestore,
		cancelRestore,
		restoreBusy,
		restoreRun,
		restoreStepText,
		runRestore
	} from './restore-flow.svelte.js';
	import BackupProgress from './BackupProgress.svelte';
	import { backupRun, decideBackup, refused, runBackup, sizeText } from './run.svelte.js';
	import { backupDue, setAutoBackup } from './auto.svelte.js';
	import {
		BACKUP_CHANNEL,
		alephEndpoints,
		backupAddressOf,
		creditsOf,
		creditsPerDay,
		createBackupUploader,
		ensureBackupKey,
		findBackups,
		forgetChain,
		isAddress,
		isGranted,
		keepWithKey,
		loadOwner,
		saveOwner,
		storeStatus
	} from './keeper.js';
	// The run itself is the app's (run.svelte.js): it goes on when this card is
	// left, and the header shows it.

	let { url, token } = $props();
	/** Aleph's dashboard: credits bought, transferred and spent; and the keys an account lets act for it. */
	const ALEPH_CREDITS = 'https://app.aleph.cloud/console/credits/';
	const ALEPH_PERMISSIONS = 'https://app.aleph.cloud/console/permissions/';
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
	const step = $derived(backupRun.step);
	/** @type {string | null} what this card did last that failed */
	let error = $state(null);
	/** A failure of this card's, else of the last backup run. */
	const shownError = $derived(error ?? backupRun.error);
	const made = $derived(backupRun.made);
	/** The address field: open while there is no account, or to change it. */
	let editingOwner = $state(false);
	/** The settings and the bridge have been asked once: only then "no account" means it. */
	let loaded = $state(false);
	const asking = $derived(backupRun.asking);
	/** Which history row is being kept again, by CID and time. */
	let rekeeping = $state('');
	/**
	 * "Wer hält es?" for one backup (holders.js): asked on a click only.
	 *
	 * @type {{ cid: string, busy: boolean, error?: string, result?: Awaited<ReturnType<typeof import('./holders.js').whoHolds>> & { networks: string, countries: string } } | null}
	 */
	let holders = $state(null);

	/** @param {string} cid */
	async function askWhoHolds(cid) {
		holders = { cid, busy: true };
		try {
			const { spread, whoHolds } = await import('./holders.js');
			const found = await whoHolds({ cid, apiHost: endpoints.apiHost });
			/** @param {{ name: string, count: number }[]} l */
			const as = (l) => l.map((x) => `${x.name} ${x.count}`).join(' · ');
			const result = {
				...found,
				networks: as(spread(found.holders, 'network')),
				countries: as(spread(found.holders, 'country'))
			};
			if (holders?.cid === cid) holders = { cid, busy: false, result };
		} catch (e) {
			if (holders?.cid === cid) {
				holders = { cid, busy: false, error: e instanceof Error ? e.message : String(e) };
			}
		}
	}
	/** "Helsinki, Finland" – what is known of it. @param {{ city: string, country: string } | null} place */
	const placeText = (place) =>
		place ? [place.city, place.country].filter(Boolean).join(', ') : t('backup.holders.noPlace');
	/** @type {import('./archive.js').BackupChain | null} where the chain of backups stands (#454) */
	let chain = $state(null);
	/** The chain's full backup, as this browser's history has it (another device's: not there). */
	const chainBase = $derived(chain ? backups.find((b) => b.cid === chain?.base) : undefined);
	/**
	 * An increment builds on its full backup only while Aleph may keep that,
	 * and only in the databases the chain began in (#496: books that moved to
	 * their own identity start a new chain).
	 */
	const chainUsable = $derived(
		Boolean(chain) &&
			!['unknown', 'rejected', 'forgotten'].includes(chainBase?.status ?? '') &&
			chainFitsBooks(chain)
	);

	/** The backups Aleph keeps for the account, as its messages API lists them: those made elsewhere among them. */
	let remote = $state(/** @type {Awaited<ReturnType<typeof findBackups>>} */ ([]));
	let remoteFailed = $state(false);
	let showForgotten = $state(false);
	let typedCid = $state('');
	/** Aleph keeps it, or has not decided yet. @param {import('./history.js').BackupRecord} b */
	const held = (b) => b.status === 'processed' || b.status === 'pending';
	/**
	 * @typedef {import('./history.js').BackupRecord & { elsewhere?: boolean }} Row
	 * @typedef {{ base: string, at: string, records: Row[], increments: number, bytes: number, held: boolean, gone: boolean, current: boolean, elsewhere: boolean }} Chain
	 *   `held`: Aleph keeps something of it (it costs); `gone`: Aleph deleted all of it
	 */
	/**
	 * Every backup, by chain – a full backup with the increments that build
	 * on it: the history here, and what Aleph lists for the account (made on
	 * another device, or before this browser forgot). The current chain
	 * first, then by date.
	 * @type {Chain[]}
	 */
	const chains = $derived.by(() => {
		/** @type {Row[]} */
		const rows = [...backups];
		for (const r of remote) {
			if (rows.some((b) => b.cid === r.cid)) continue;
			rows.push({
				at: new Date(r.time * 1000).toISOString(),
				provider: 'aleph',
				cid: r.cid,
				size: 0,
				status: 'processed',
				itemHash: r.itemHash,
				address: r.owner,
				sender: r.sender,
				entries: 0,
				files: 0,
				missing: 0,
				kind: r.ref ? 'increment' : 'full',
				...(r.ref ? { base: r.ref } : {}),
				elsewhere: true
			});
		}
		const isFull = (/** @type {Row} */ b) => b.kind !== 'increment';
		/** @type {Record<string, Row[]>} */
		const byBase = {};
		for (const b of rows) {
			const base = isFull(b) ? b.cid : b.base;
			if (!base) continue;
			(byBase[base] ??= []).push(b);
		}
		return Object.entries(byBase)
			.map(([base, records]) => {
				const full = records.filter(isFull).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
				// A backup kept again has two rows and one file: each CID once.
				const kept = records
					.filter(held)
					.filter((b, i, all) => all.findIndex((o) => o.cid === b.cid) === i)
					.map((b) => b.size);
				return {
					base,
					at: full?.at ?? records[0].at,
					records: [...records].sort((a, b) => (a.at < b.at ? 1 : -1)),
					increments: new Set(records.filter((b) => !isFull(b)).map((b) => b.cid)).size,
					bytes: kept.reduce((n, size) => n + size, 0),
					held: records.some(held),
					gone: records.every((b) => b.status === 'forgotten'),
					current: chainUsable && chain?.base === base,
					elsewhere: records.every((b) => Boolean(b.elsewhere))
				};
			})
			.sort((a, b) => (a.current ? -1 : b.current ? 1 : a.at < b.at ? 1 : -1));
	});
	const liveChains = $derived(chains.filter((c) => !c.gone));
	const goneChains = $derived(chains.filter((c) => c.gone));
	/** The chains backups no longer go on with: they cost credits until forgotten. */
	const older = $derived(liveChains.filter((c) => !c.current));

	/** What Aleph lists for the account: asked when the card opens, and after a change. */
	async function listRemote() {
		if (!owner) {
			remote = [];
			return;
		}
		try {
			remote = await findBackups({ owner, endpoints });
			remoteFailed = false;
		} catch {
			remoteFailed = true;
		}
	}

	/** A row for a backup Aleph has deleted: out of the list here. @param {Row} b */
	async function dropRow(b) {
		const store = currentStore();
		if (!store) return;
		backups = await dropBackup(store.settings, b);
	}

	/** "Wiederherstellen" for the chosen chain: its increments as this card knows them. */
	const doRestore = () =>
		runRestore({
			owner,
			endpoints,
			known:
				chains
					.find((c) => c.base === restoreRun.chosen)
					?.records.filter((b) => b.kind === 'increment')
					.map((b) => b.cid) ?? []
		});
	/** @param {HTMLElement} node */
	function reveal(node) {
		node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}
	/** Which older chain asks "Endgültig löschen?", and which is being forgotten, by base CID. */
	let confirming = $state('');
	let forgetting = $state('');
	/** What the last "Löschen" did. */
	let forgotten = $state(/** @type {{ count: number, left: number } | null} */ (null));
	/** Only this browser's key forgets: the bridge has no way to. */
	const canForget = $derived(
		granted === true && Boolean(owner && key) && !app.network.paused && !step && !forgetting
	);

	/**
	 * "Endgültig löschen": Aleph forgets the chain (keeper.js `forgetChain`);
	 * its rows say so, and stop counting in what the backups cost.
	 *
	 * @param {Chain} c
	 */
	async function forgetOlder(c) {
		const store = currentStore();
		if (!store || !owner || !key || c.base === chain?.base) return;
		error = null;
		forgotten = null;
		confirming = '';
		forgetting = c.base;
		try {
			const result = await forgetChain({ base: c.base, owner, key, endpoints });
			const gone = new Set(result.forgotten);
			for (const b of c.records) {
				if (b.itemHash && gone.has(b.itemHash)) {
					backups = await updateBackup(store.settings, b, { status: 'forgotten' });
				}
			}
			forgotten = {
				count: result.forgotten.length,
				left: result.rejected.length + result.pending.length + result.failed.length
			};
			await settle();
			await listRemote();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			forgetting = '';
		}
		credits = await creditsOf({ owner, endpoints }).catch(() => credits);
	}

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
	const keptBytes = $derived(liveChains.reduce((n, c) => n + c.bytes, 0));
	const keptPerDay = $derived(creditsPerDay(keptBytes));
	/** Below this many days of credits, a new backup asks first. */
	const ASK_BELOW_DAYS = 30;
	/** @param {number} perDay */
	const daysFor = (perDay) => (credits === null || perDay <= 0 ? Infinity : credits / perDay);

	$effect(() => {
		load(token);
	});
	// A run that ended – here or while this card was not open – is in the
	// history now: read it again, and what it cost.
	$effect(() => {
		if (!backupRun.finished) return;
		untrack(async () => {
			const store = currentStore();
			if (!store) return;
			backups = await loadBackups(store.settings);
			chain = await loadChain(store.settings);
			if (owner) credits = await creditsOf({ owner, endpoints }).catch(() => credits);
		});
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
		loaded = true;
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
			await listRemote();
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

	const decide = decideBackup;

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
	 * last backup (#454); the first backup, one whose base Aleph does not keep,
	 * and "Neues Vollbackup" are full ones (run.svelte.js).
	 *
	 * @param {{ full?: boolean }} [options]
	 */
	async function backUp({ full = false } = {}) {
		if (!owner || !key) return;
		error = null;
		const continuing = !full && chainUsable && chain ? $state.snapshot(chain) : null;
		const uploader = await createBackupUploader({
			owner,
			key,
			granted: granted === true,
			endpoints,
			bridge: bridgeSigns
				? { keep: (cid, ref) => client.alephKeep(cid, ref), address: status?.address }
				: null
		});
		return runBackup({
			continuing,
			uploader,
			// A whole copy costs credits every day it is kept: when the credits
			// would not last a month with it, ask before it goes up.
			askFor: (bytes) => {
				const perDay = creditsPerDay(bytes);
				const days = daysFor(keptPerDay + perDay);
				return days < ASK_BELOW_DAYS ? { perDay, days } : null;
			}
		});
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	const size = sizeText;
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
					: s === 'forgotten'
						? t('backup.forgotten')
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

{#snippet backupRow(/** @type {Row} */ b)}
	<li class="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1" data-testid="backup-row">
		<span class="text-heading"
			>{when(b.at)}
			<span class="text-xs text-faint" data-testid="backup-row-kind"
				>· {b.kind === 'increment'
					? t('backup.kindIncrement', { sequence: b.sequence ?? 0 })
					: t('backup.kindFull')}</span
			></span
		>
		<span class="text-faint">{b.size ? `${size(b.size)} · ` : ''}{kept(b.status)}</span>
		{#if held(b)}
			<button
				type="button"
				class="text-xs text-link underline disabled:opacity-50"
				onclick={() => askWhoHolds(b.cid)}
				disabled={holders?.busy || app.network.paused}
				data-testid="backup-holders">{t('backup.holders.ask')}</button
			>
		{:else if !b.elsewhere}
			<button
				type="button"
				class="text-xs text-link underline"
				onclick={() => dropRow(b)}
				data-testid="backup-row-drop">{t('backup.list.drop')}</button
			>
		{/if}
		{#if holders?.cid === b.cid}
			<div class="w-full text-xs" role="status" data-testid="backup-holders-result">
				{#if holders.busy}
					<p class="text-faint">{t('backup.holders.asking')}</p>
				{:else if holders.error}
					<p class="text-danger">{t('backup.holders.failed', { error: holders.error })}</p>
				{:else if holders.result}
					{@const r = holders.result}
					<p class="text-text" data-testid="backup-holders-summary">
						{r.holders.length
							? t('backup.holders.summary', {
									count: r.holders.length,
									aleph: r.holders.filter((h) => h.aleph).length,
									active: r.alephActive ?? '?'
								})
							: t('backup.holders.none')}
					</p>
					{#if r.holders.length}
						<table class="mt-1 w-full text-left">
							<thead class="text-faint">
								<tr>
									<th scope="col" class="py-0.5 pr-2 font-medium">{t('backup.holders.node')}</th>
									<th scope="col" class="py-0.5 pr-2 font-medium">{t('backup.holders.ip')}</th>
									<th scope="col" class="py-0.5 pr-2 font-medium">{t('backup.holders.place')}</th>
									<th scope="col" class="py-0.5 font-medium">{t('backup.holders.network')}</th>
								</tr>
							</thead>
							<tbody>
								{#each r.holders as h (h.peerId)}
									<tr class="align-top" data-testid="backup-holder">
										<td class="py-0.5 pr-2 text-heading" title={h.peerId}
											>{h.aleph ?? t('backup.holders.notAleph')}</td
										>
										<td class="py-0.5 pr-2 font-mono break-all text-text"
											>{h.ips.join(', ') || '–'}</td
										>
										<td class="py-0.5 pr-2 text-text">{placeText(h.place)}</td>
										<td class="py-0.5 text-faint">{h.place?.network || '–'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if r.placed}
							<p class="mt-1 text-faint" data-testid="backup-holders-spread">
								{t('backup.holders.spread', { networks: r.networks, countries: r.countries })}
							</p>
						{/if}
					{/if}
				{/if}
			</div>
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
					>{rekeeping === b.cid + b.at ? t('backup.step.keeping') : t('backup.rekeep')}</button
				>
			</span>
		{/if}
		<details class="w-full" data-testid="backup-row-details">
			<summary class="cursor-pointer text-xs text-faint">{t('backup.list.details')}</summary>
			<p class="mt-1 font-mono text-xs break-all text-faint" data-testid="backup-row-cid">
				{b.cid}
			</p>
			{#if b.itemHash}
				<p class="text-xs text-faint" data-testid="backup-row-order">
					{t('backup.order')}
					<a
						class="font-mono break-all text-link underline"
						href={`${endpoints.apiHost}/api/v0/messages/${b.itemHash}`}
						target="_blank"
						rel="noopener noreferrer">{b.itemHash}</a
					>
				</p>
			{/if}
			{#if b.elsewhere}
				<p class="text-xs text-faint">{t('backup.list.elsewhereRow')}</p>
			{/if}
			{#if b.databases}
				{@render contents(b)}
			{/if}
		</details>
	</li>
{/snippet}

{#snippet chainGroup(/** @type {Chain} */ c)}
	<li class="py-2" data-testid="backup-chain-group" data-base={c.base} data-current={c.current}>
		<div
			data-testid={c.current
				? 'backup-chain-current'
				: c.held
					? 'backup-older-chain'
					: c.gone
						? 'backup-chain-gone'
						: 'backup-chain-unkept'}
		>
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span class="font-medium text-heading"
					>{c.at
						? t('backup.older.chain', { at: when(c.at) })
						: t('backup.older.chainUndated', { cid: `${c.base.slice(0, 12)}…` })}</span
				>
				<span class="text-xs text-faint"
					>· {c.increments === 1
						? t('backup.older.incrementsOne')
						: t('backup.older.increments', { count: c.increments })} · {c.held
						? c.bytes
							? t('backup.older.cost', {
									size: size(c.bytes),
									perDay: perDayText(creditsPerDay(c.bytes))
								})
							: t('backup.list.sizeUnknown')
						: c.gone
							? t('backup.forgotten')
							: t('backup.unknown')}{c.elsewhere ? ` · ${t('backup.list.elsewhere')}` : ''}</span
				>
				{#if c.current}
					<span
						class="rounded-full border border-border px-2 py-0.5 text-xs text-text"
						data-testid="backup-chain-current-badge">{t('backup.list.current')}</span
					>
				{/if}
				{#if c.held}
					<span class="ml-auto flex flex-wrap items-center gap-2">
						<button
							type="button"
							class={button}
							onclick={() => askRestore(c.base)}
							disabled={restoreBusy() || Boolean(step)}
							data-testid="backup-restore">{t('restore.pick')}</button
						>
						{#if !c.current && forgetting !== c.base && confirming !== c.base}
							<button
								type="button"
								class={button}
								onclick={() => (confirming = c.base)}
								disabled={!canForget}
								data-testid="backup-older-forget">{t('backup.older.forget')}</button
							>
						{/if}
					</span>
				{/if}
			</div>
			{#if confirming === c.base}
				<div class="mt-1 flex flex-wrap items-center gap-2" role="alert">
					<span class="text-warn w-full text-xs" data-testid="backup-older-confirm"
						>{t('backup.older.confirm')}</span
					>
					<button
						type="button"
						class="rounded-md border border-danger px-3 py-1.5 text-sm text-danger hover:bg-surface-2 disabled:opacity-50"
						onclick={() => forgetOlder(c)}
						disabled={!canForget}
						data-testid="backup-older-yes">{t('backup.older.confirmYes')}</button
					>
					<button
						type="button"
						class={button}
						onclick={() => (confirming = '')}
						data-testid="backup-older-no">{t('backup.cancel')}</button
					>
				</div>
			{:else if forgetting === c.base}
				<p class="mt-1 text-xs text-faint" role="status">{t('backup.older.forgetting')}</p>
			{/if}
		</div>
		<ul class="mt-1 border-l border-border pl-3">
			{#each c.records as b (b.cid + b.at)}
				{@render backupRow(b)}
			{/each}
		</ul>
	</li>
{/snippet}

<section class={card} aria-labelledby="backup-h" data-testid="backup-card">
	<h2 id="backup-h" class="text-lg font-semibold text-heading">{t('backup.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('backup.what')}</p>
	<!-- Said before anything goes up, not in a footnote: where it lies, what that
	     is good for, what of it is public – and that the choice is the user's. -->
	<div
		class="mt-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-text"
		role="note"
		aria-labelledby="backup-public-h"
		data-testid="backup-public"
	>
		<p id="backup-public-h" class="font-semibold text-heading">{t('backup.public.title')}</p>
		<ul class="mt-1 list-disc space-y-1 pl-5">
			<li>{t('backup.public.spread')}</li>
			<li>{t('backup.public.sealed')}</li>
			<li>{t('backup.public.open')}</li>
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
			<dd class="flex flex-wrap items-baseline gap-x-2 text-heading" data-testid="backup-credits">
				{credits === null ? t('backup.creditsUnknown') : creditsText(credits)}
				<a
					class="text-xs text-link underline"
					href={ALEPH_CREDITS}
					target="_blank"
					rel="noopener noreferrer"
					data-testid="backup-credits-link">{t('backup.creditsLink')}</a
				>
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
				<p class="mt-1 text-xs text-faint" data-testid="backup-grant-dashboard">
					{t('backup.grantDashboard', { channel: BACKUP_CHANNEL })}
					<a
						class="text-link underline"
						href={ALEPH_PERMISSIONS}
						target="_blank"
						rel="noopener noreferrer">{t('backup.grantDashboardLink')}</a
					>
				</p>
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
			{#if step}
				<!-- under way: shown below, with its bar -->
			{:else if app.network.paused}
				<span class="text-sm text-faint">{t('backup.paused')}</span>
			{:else if backupRun.nothingNew}
				<span class="text-sm text-text" role="status" data-testid="backup-nothing-new"
					>{t('backup.nothingNew')}</span
				>
			{/if}
		</div>
		{#if step && step !== 'asking'}
			<div class="mt-3">
				<BackupProgress />
				<p class="mt-1 text-xs text-faint" data-testid="backup-keep-working">
					{t('backup.keepWorking')}
					{t('backup.keepOn')}
				</p>
			</div>
		{/if}
		<p class="mt-2 text-xs text-faint" data-testid="backup-chain">
			{chainUsable && chain
				? t('backup.chainNext', {
						sequence: chain.sequence + 1,
						date: chainBase ? when(chainBase.at) : t('backup.chainElsewhere')
					})
				: t('backup.chainFirst')}
		</p>
		{#if chainUsable}
			<div class="mt-3 text-sm" data-testid="backup-auto">
				<label class="flex items-start gap-2 text-text">
					<input
						type="checkbox"
						class="mt-0.5"
						checked={backupDue.auto}
						onchange={(e) => setAutoBackup(e.currentTarget.checked)}
						data-testid="backup-auto-toggle"
					/>
					<span>
						<span class="text-heading">{t('backup.auto.label')}</span>
						<span class="block text-xs text-faint">{t('backup.auto.hint')}</span>
					</span>
				</label>
				{#if backupDue.collections.length && !step}
					<p class="mt-1 text-xs text-text" data-testid="backup-unsaved">
						{t('backup.auto.unsaved', {
							list: backupDue.collections.map((c) => t(`storage.databases.${c}`)).join(', ')
						})}
						{#if backupDue.auto && backupDue.blocked}
							<span class="text-warning">{t(`backup.badge.blocked.${backupDue.blocked}`)}</span>
						{/if}
					</p>
				{/if}
			</div>
		{/if}
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
	{:else if loaded}
		<p class="mt-2 text-sm text-text" data-testid="backup-no-owner">{t('backup.noOwner')}</p>
	{/if}

	{#if loaded && (!owner || editingOwner)}
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
	{#if shownError}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="backup-error">{shownError}</p>
		<WayOut message={shownError} />
	{/if}
	{#if chains.length || owner}
		<h3 class="mt-4 text-sm font-semibold text-heading">{t('backup.list.title')}</h3>
		<p class="mt-1 text-xs text-faint">{t('backup.list.intro')}</p>
		<p class="mt-1 text-xs text-faint">{t('restore.leaves')} {t('backup.holders.note')}</p>
		{#if remoteFailed}
			<p class="mt-1 text-xs text-faint" data-testid="backup-list-unlisted">
				{t('backup.list.unlisted')}
			</p>
		{/if}
		{#if !chains.length}
			<p class="mt-2 text-sm text-faint" data-testid="backup-no-backups">{t('backup.list.none')}</p>
		{/if}
		<ul class="mt-1 divide-y divide-border text-sm" data-testid="backup-history">
			{#each liveChains as c (c.base)}
				{@render chainGroup(c)}
			{/each}
		</ul>
		{#if older.length && granted !== true}
			<p class="mt-1 text-xs text-faint" data-testid="backup-older-needs-grant">
				{t('backup.older.needsGrant')}
			</p>
		{/if}
		{#if forgotten}
			<p class="mt-1 text-sm text-text" role="status" data-testid="backup-older-done">
				{forgotten.left
					? t('backup.older.incomplete', { count: forgotten.left })
					: t('backup.older.done', { count: forgotten.count })}
			</p>
		{/if}
		{#if goneChains.length}
			<details class="mt-2 text-sm" bind:open={showForgotten} data-testid="backup-forgotten">
				<summary class="cursor-pointer text-xs text-faint"
					>{goneChains.length === 1
						? t('backup.list.showGoneOne')
						: t('backup.list.showGone', { count: goneChains.length })}</summary
				>
				<ul class="divide-y divide-border" data-testid="backup-history-gone">
					{#each goneChains as c (c.base)}
						{@render chainGroup(c)}
					{/each}
				</ul>
			</details>
		{/if}
		<details class="mt-3 text-sm" data-testid="backup-restore-by-cid">
			<summary class="cursor-pointer text-xs text-faint">{t('backup.list.byCid')}</summary>
			<form
				class="mt-2 flex flex-wrap items-end gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					askRestore(typedCid);
				}}
			>
				<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
					>{t('restore.cidLabel')}
					<input
						class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
						bind:value={typedCid}
						autocomplete="off"
						spellcheck="false"
						data-testid="restore-cid"
					/>
				</label>
				<button
					type="submit"
					class={button}
					disabled={restoreBusy() || !typedCid.trim()}
					data-testid="restore-typed">{t('restore.pick')}</button
				>
			</form>
		</details>
		{#if restoreRun.chosen}
			<div
				class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
				use:reveal
				data-testid="restore-confirm"
			>
				<p class="text-text">{t('restore.confirm')}</p>
				<p class="mt-1 font-mono text-xs break-all text-faint">{restoreRun.chosen}</p>
				<div class="mt-2 flex gap-2">
					<button type="button" class={button} onclick={doRestore} data-testid="restore-yes"
						>{t('restore.yes')}</button
					>
					<button type="button" class={button} onclick={cancelRestore} data-testid="restore-no"
						>{t('restore.no')}</button
					>
				</div>
			</div>
		{/if}
		{#if restoreStepText()}
			<p class="mt-3 text-sm text-faint" role="status" data-testid="restore-step">
				{restoreStepText()}
			</p>
			<p class="mt-1 text-xs text-faint" data-testid="restore-keep-on">{t('backup.keepOn')}</p>
		{/if}
		{#if restoreRun.phase === 'done'}
			<div class="mt-3 text-sm" role="status" data-testid="restore-done">
				<p class="text-heading">{t('restore.done')}</p>
				{#if restoreRun.increments}
					<p class="text-xs text-faint" data-testid="restore-done-increments">
						{t('restore.doneIncrements', { count: restoreRun.increments })}
					</p>
				{/if}
				<ul class="mt-1 text-xs text-faint">
					{#each restoreRun.result.filter((d) => d.joined > 0) as d (d.collection)}
						<li>{t(`storage.databases.${d.collection}`)}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if restoreRun.error}
			<p class="mt-2 text-sm text-danger" role="alert" data-testid="restore-error">
				{restoreRun.error}
			</p>
		{/if}
	{/if}
</section>
