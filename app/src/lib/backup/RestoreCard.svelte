<script>
	// Integrationen → Backup → "Wiederherstellen" (issue #77): a backup made with
	// this passkey, fetched from Aleph's gateway by its CID and put back into
	// these books (archive.js `restoreBackup`). Restoring merges: what is here
	// stays, what the backup holds is added. The books are closed for it, so the
	// page reloads at the end and the passkey opens them again.
	//
	// Which backups there are: Aleph lists those kept for the paying account
	// (keeper.js; an empty browser has no history of its own), whether the
	// bridge or this browser's key sent the STORE; the history here adds those
	// made from this browser, and a CID can be typed. The account's address
	// comes from the settings, from the paired bridge, or is typed: it is public.
	import { createBridgeClient } from '$lib/bridge/client.js';
	import { app, currentStore, restoreBackup } from '$lib/session.svelte.js';
	import { intlLocale, t } from '$lib/i18n/index.js';
	import { card } from '$lib/ui/styles.js';
	import { loadBackups } from './history.js';
	import { alephEndpoints, findBackups, isAddress, loadOwner, saveOwner } from './keeper.js';

	let { url, token } = $props();
	const client = $derived(createBridgeClient({ url, token }));

	/** @type {{ cid: string, at: string }[]} */
	let found = $state([]);
	/** @type {import('./keeper.js').AlephEndpoints} */
	let endpoints = $state(alephEndpoints());
	/** @type {string | null} the account that pays, whose backups Aleph lists */
	let owner = $state(null);
	let ownerInput = $state('');
	/** Whether Aleph's list could not be read just now. */
	let unlisted = $state(false);
	let typed = $state('');
	/** @type {string | null} the backup asked for, waiting for the yes */
	let chosen = $state(null);

	/**
	 * The confirmation comes into view when it appears: picked from a long list
	 * of backups, it would otherwise open far below the click.
	 *
	 * @param {HTMLElement} node
	 */
	function reveal(node) {
		node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}
	let phase = $state(/** @type {'' | 'fetching' | 'restoring' | 'done'} */ (''));
	let progress = $state(/** @type {import('./archive.js').RestoreProgress | null} */ (null));
	/** @type {string | null} */
	let error = $state(null);
	/** @type {{ collection: string, joined: number }[]} */
	let result = $state([]);

	const isCid = (/** @type {string} */ c) =>
		/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(c) || /^b[a-z2-7]{50,100}$/.test(c);

	$effect(() => {
		load(token);
	});

	/** @param {string | null} withToken */
	async function load(withToken) {
		const store = currentStore();
		owner = store ? await loadOwner(store.settings) : null;
		if (withToken) {
			try {
				const status = (await client.backupStatus()).aleph;
				endpoints = alephEndpoints(status);
				if (!owner && status.configured && isAddress(status.address)) {
					owner = String(status.address);
				}
			} catch {
				// No word from the bridge: Aleph's own hosts, and the address as kept or typed.
			}
		}
		ownerInput = owner ?? '';
		await list();
	}

	async function list() {
		/** @type {Record<string, string>} CID → when, the history's first */
		const byCid = {};
		const store = currentStore();
		if (store) for (const b of await loadBackups(store.settings)) byCid[b.cid] ??= b.at;
		unlisted = false;
		if (owner) {
			try {
				for (const b of await findBackups({ owner, endpoints })) {
					byCid[b.cid] ??= new Date(b.time * 1000).toISOString();
				}
			} catch {
				// No list from Aleph: the history and a typed CID still work.
				unlisted = true;
			}
		}
		found = Object.entries(byCid)
			.map(([cid, at]) => ({ cid, at }))
			.sort((a, b) => (a.at < b.at ? 1 : -1));
	}

	async function setOwner() {
		error = null;
		if (!isAddress(ownerInput)) {
			error = t('restore.ownerInvalid');
			return;
		}
		const store = currentStore();
		owner = store ? await saveOwner(store.settings, ownerInput) : ownerInput.trim();
		ownerInput = owner;
		await list();
	}

	/** @param {string} cid */
	function ask(cid) {
		error = null;
		chosen = cid.trim();
		if (!isCid(chosen)) {
			error = t('restore.notACid');
			chosen = null;
		}
	}

	async function restore() {
		const cid = chosen;
		if (!cid) return;
		chosen = null;
		error = null;
		progress = null;
		try {
			phase = 'fetching';
			const { createAlephBackend } = await import(
				'@le-space/orbitdb-storage-bridge/backends/aleph'
			);
			const sealed = await createAlephBackend({ gateways: endpoints.gateways }).getBlob(cid);
			phase = 'restoring';
			const done = await restoreBackup(sealed, (p) => (progress = p));
			result = done.databases;
			phase = 'done';
			// The books were closed for the restore: open them again, with what came back.
			setTimeout(() => location.reload(), 2500);
		} catch (e) {
			phase = '';
			error =
				e instanceof Error && e.name === 'WrongPasskeyError'
					? t('restore.wrongPasskey')
					: e instanceof Error && e.name === 'BackendError'
						? t('restore.notFetched')
						: e instanceof Error
							? e.message
							: String(e);
		}
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50';
	/** @param {string} iso */
	const when = (iso) =>
		new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		);
	const busy = $derived(Boolean(phase) || app.network.paused);
	const stepText = $derived(
		phase === 'fetching'
			? t('restore.fetching')
			: phase === 'restoring'
				? progress?.stage === 'database'
					? t('restore.database', {
							index: progress.index + 1,
							total: progress.total,
							name: t(`storage.databases.${progress.name}`)
						})
					: t('restore.opening')
				: ''
	);
</script>

<section class={card} aria-labelledby="restore-h" data-testid="restore-card">
	<h2 id="restore-h" class="text-lg font-semibold text-heading">{t('restore.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('restore.what')}</p>
	<p class="mt-1 text-xs text-faint">{t('restore.leaves')}</p>

	<form
		class="mt-3 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			setOwner();
		}}
	>
		<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
			>{t('restore.ownerLabel')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
				bind:value={ownerInput}
				placeholder="0x…"
				autocomplete="off"
				spellcheck="false"
				data-testid="restore-owner"
			/>
		</label>
		<button
			type="submit"
			class={button}
			disabled={busy || !ownerInput.trim() || ownerInput.trim() === owner}
			data-testid="restore-owner-list">{t('restore.ownerList')}</button
		>
	</form>
	{#if unlisted}
		<p class="mt-2 text-sm text-faint" data-testid="restore-unlisted">{t('restore.unlisted')}</p>
	{/if}

	{#if found.length}
		<ul class="mt-3 divide-y divide-border text-sm" data-testid="restore-list">
			{#each found as b (b.cid)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-1.5"
					data-testid="restore-row"
				>
					<span class="min-w-0">
						<span class="text-heading">{when(b.at)}</span>
						<span class="block font-mono text-xs break-all text-faint">{b.cid}</span>
					</span>
					<button
						type="button"
						class={button}
						disabled={busy}
						onclick={() => ask(b.cid)}
						data-testid="restore-pick">{t('restore.pick')}</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-3 text-sm text-faint" data-testid="restore-none">{t('restore.none')}</p>
	{/if}

	<form
		class="mt-3 flex flex-wrap items-end gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			ask(typed);
		}}
	>
		<label class="flex min-w-64 flex-1 flex-col text-sm text-faint"
			>{t('restore.cidLabel')}
			<input
				class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-heading"
				bind:value={typed}
				autocomplete="off"
				spellcheck="false"
				data-testid="restore-cid"
			/>
		</label>
		<button
			type="submit"
			class={button}
			disabled={busy || !typed.trim()}
			data-testid="restore-typed">{t('restore.pick')}</button
		>
	</form>

	{#if chosen}
		<div
			class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
			use:reveal
			data-testid="restore-confirm"
		>
			<p class="text-text">{t('restore.confirm')}</p>
			<p class="mt-1 font-mono text-xs break-all text-faint">{chosen}</p>
			<div class="mt-2 flex gap-2">
				<button type="button" class={button} onclick={restore} data-testid="restore-yes"
					>{t('restore.yes')}</button
				>
				<button
					type="button"
					class={button}
					onclick={() => (chosen = null)}
					data-testid="restore-no">{t('restore.no')}</button
				>
			</div>
		</div>
	{/if}

	{#if stepText}
		<p class="mt-3 text-sm text-faint" role="status" data-testid="restore-step">{stepText}</p>
	{/if}
	{#if phase === 'done'}
		<div class="mt-3 text-sm" role="status" data-testid="restore-done">
			<p class="text-heading">{t('restore.done')}</p>
			<ul class="mt-1 text-xs text-faint">
				{#each result.filter((d) => d.joined > 0) as d (d.collection)}
					<li>{t(`storage.databases.${d.collection}`)}</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert" data-testid="restore-error">{error}</p>
	{/if}
</section>
