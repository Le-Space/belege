<script>
	// The backup in the header, on every page. Under way (run.svelte.js): what
	// it is at and a bar. Waiting for "Hochladen" says so, since nothing moves
	// until it is answered. Otherwise, when the last backup lacks something
	// (auto.svelte.js): "Nicht gesichert", with what changed, and when the
	// automatic increment comes – or why it does not. One click to the card.
	import { onDestroy, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import BackupProgress from './BackupProgress.svelte';
	import { backupRun, uploadPercent } from './run.svelte.js';
	import { afterRun, backupDue, watchBackupDue } from './auto.svelte.js';

	/** @type {() => void} */
	let stop = () => {};
	onMount(() => (stop = watchBackupDue()));
	onDestroy(() => stop());
	$effect(() => {
		if (backupRun.finished) afterRun();
	});

	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 15_000);
	onDestroy(() => clearInterval(tick));

	const label = $derived(
		backupRun.step === 'asking'
			? t('backup.badge.asking')
			: backupRun.step === 'uploading' && backupRun.measured
				? t('backup.badge.uploading', { percent: uploadPercent() })
				: backupRun.step === 'uploading'
					? // The host does not let it be counted (upload.js): no number to show.
						t('backup.badge.uploadingUnmeasured')
					: backupRun.step
						? t(`backup.badge.${backupRun.step}`)
						: t('backup.badge.unsaved', { count: backupDue.collections.length })
	);
	const unsaved = $derived(!backupRun.step && backupDue.known && backupDue.collections.length > 0);
	const minutes = $derived(Math.max(1, Math.ceil((backupDue.at - now) / 60_000)));
	const title = $derived(
		unsaved
			? [
					t('backup.badge.unsavedTitle', {
						list: backupDue.collections.map((c) => t(`storage.databases.${c}`)).join(', ')
					}),
					backupDue.blocked
						? t(`backup.badge.blocked.${backupDue.blocked}`)
						: backupDue.at
							? t('backup.badge.autoIn', { minutes })
							: t('backup.badge.byHand')
				].join('\n')
			: t('backup.badge.title')
	);
</script>

{#if backupRun.step || unsaved}
	<a
		href={resolve('/integrationen/[id]', { id: 'backup' })}
		class="inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs {backupRun.step ===
			'asking' ||
		(unsaved && backupDue.blocked)
			? 'border-warning text-heading'
			: 'border-border text-text'} bg-surface hover:text-heading"
		{title}
		data-testid="backup-badge"
		data-step={backupRun.step || 'unsaved'}
		data-blocked={unsaved ? backupDue.blocked : ''}
	>
		<span class="truncate">{label}</span>
		{#if backupRun.step && backupRun.step !== 'asking'}<BackupProgress compact />{/if}
		{#if unsaved && backupDue.at && !backupDue.blocked}
			<span class="text-faint" data-testid="backup-badge-auto"
				>{t('backup.badge.autoShort', { minutes })}</span
			>
		{/if}
	</a>
{/if}
