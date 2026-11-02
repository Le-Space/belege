<script>
	// On Home: whether the books would survive this browser (storage/safety.js).
	// A warning while the browser may clear them and there is no other copy –
	// not to be put away; a reminder, for a week at a time, when the browser
	// keeps them but no recent backup or own device does.
	import { resolve } from '$app/paths';
	import { app } from '$lib/session.svelte.js';
	import { integrationFacts } from '$lib/integrations/facts.svelte.js';
	import { btn } from '$lib/ui/styles.js';
	import { t } from '$lib/i18n/index.js';
	import { booksSafety, requestPersistence } from './safety.js';

	const SNOOZE_KEY = 'belege.safety-snooze';
	const WEEK = 7 * 24 * 60 * 60 * 1000;

	let safety = $derived(
		booksSafety({
			persisted: app.persisted,
			lastBackup: integrationFacts().lastBackup ?? null,
			devices: (app.sync.state?.devices ?? []).length,
			empty: !app.transactions.length && !app.receipts.length
		})
	);

	/** @type {number} */
	let snoozedUntil = $state(readSnooze());
	function readSnooze() {
		try {
			return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
		} catch {
			return 0;
		}
	}
	function snooze() {
		snoozedUntil = Date.now() + WEEK;
		try {
			localStorage.setItem(SNOOZE_KEY, String(snoozedUntil));
		} catch {
			// Shown again on the next visit.
		}
	}

	let asked = $state(false);
	async function persist() {
		app.persisted = await requestPersistence();
		asked = true;
	}

	let backupLine = $derived(
		safety.backupAgeDays === null
			? t('home.safety.noBackup')
			: safety.backupAgeDays === 0
				? t('home.safety.backupToday')
				: t('home.safety.backupAge', { days: safety.backupAgeDays })
	);
	let shown = $derived(
		safety.level === 'warn' || (safety.level === 'remind' && Date.now() >= snoozedUntil)
	);
</script>

{#if shown}
	<section
		class="mt-4 rounded-lg border px-5 py-4 shadow-sm {safety.level === 'warn'
			? 'border-danger/60 bg-surface'
			: 'border-border bg-surface'}"
		aria-labelledby="safety-h"
		data-testid="home-safety"
		data-level={safety.level}
	>
		<h2
			id="safety-h"
			class="text-lg font-semibold {safety.level === 'warn' ? 'text-danger' : 'text-heading'}"
		>
			{t(`home.safety.${safety.level}.title`)}
		</h2>
		<p class="mt-1 text-sm text-text">{t(`home.safety.${safety.level}.text`)}</p>
		<p class="mt-1 text-sm text-faint" data-testid="home-safety-backup">{backupLine}</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if safety.level === 'warn' && safety.persisted !== true}
				<button
					type="button"
					class={btn.primary}
					onclick={persist}
					data-testid="home-safety-persist">{t('home.safety.persist')}</button
				>
			{/if}
			<a class="inline-flex items-center {btn.secondary}" href={resolve('/integrationen/backup')}
				>{t('home.safety.backup')}</a
			>
			<a class="inline-flex items-center {btn.secondary}" href={resolve('/integrationen/geraete')}
				>{t('home.safety.device')}</a
			>
			{#if safety.level === 'remind'}
				<button type="button" class={btn.link} onclick={snooze} data-testid="home-safety-snooze"
					>{t('home.safety.snooze')}</button
				>
			{/if}
		</div>
		{#if asked && safety.persisted !== true}
			<p class="mt-2 text-xs text-faint" role="status" data-testid="home-safety-refused">
				{t('home.safety.refused')}
			</p>
		{/if}
	</section>
{/if}
