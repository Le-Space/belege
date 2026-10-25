<script>
	// A backup under way, in the header on every page (run.svelte.js): what it
	// is at and a bar; one click back to the backup card. Waiting for "Hochladen"
	// says so, since nothing moves until it is answered.
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/index.js';
	import BackupProgress from './BackupProgress.svelte';
	import { backupRun, uploadPercent } from './run.svelte.js';

	const label = $derived(
		backupRun.step === 'asking'
			? t('backup.badge.asking')
			: backupRun.step === 'uploading' && backupRun.measured
				? t('backup.badge.uploading', { percent: uploadPercent() })
				: t(`backup.badge.${backupRun.step}`)
	);
</script>

{#if backupRun.step}
	<a
		href={resolve('/integrationen/[id]', { id: 'backup' })}
		class="inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs {backupRun.step ===
		'asking'
			? 'border-warning text-heading'
			: 'border-border text-text'} bg-surface hover:text-heading"
		title={t('backup.badge.title')}
		data-testid="backup-badge"
		data-step={backupRun.step}
	>
		<span class="truncate">{label}</span>
		{#if backupRun.step !== 'asking'}<BackupProgress compact />{/if}
	</a>
{/if}
