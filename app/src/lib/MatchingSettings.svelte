<script>
	// "Eigene Anweisungen": company names, own IBANs, rules. Stored sealed in
	// `settings` under `matching` (matching/classify.js), read by every
	// "Abgleich".
	import { onMount } from 'svelte';
	import { app, currentStore, refreshNow, runMatchingNow } from './session.svelte.js';
	import { setSetting } from './store/settings.js';
	import {
		cleanMatchingSettings,
		DEFAULT_GRACE_DAYS,
		MAX_GRACE_DAYS
	} from './matching/classify.js';
	import { ulid } from './store/ids.js';
	import { t } from './i18n/index.js';

	let companyText = $state('');
	let ibanText = $state('');
	/** @type {import('./matching/classify.js').Rule[]} */
	let rules = $state([]);

	/** @type {'counterparty' | 'purpose' | 'any'} */
	let field = $state('counterparty');
	let contains = $state('');
	/** @type {'ignore' | 'private'} */
	let action = $state('ignore');
	let reason = $state('');
	/** @type {number | string} */
	let graceDays = $state(DEFAULT_GRACE_DAYS);

	let saving = $state(false);
	/** @type {string | null} */
	let saved = $state(null);

	onMount(() => {
		const current = cleanMatchingSettings(app.matchingSettings);
		companyText = current.companyNames.join('\n');
		ibanText = current.ownIbans.join('\n');
		rules = current.rules;
		graceDays = current.graceDays;
	});

	// What people's links taught (matching/partners.js); wrong ones can go.
	let learned = $derived(
		(app.partners ?? []).filter((p) => !p.deleted && (p.aliases ?? []).length)
	);

	/** @param {string} id */
	async function forget(id) {
		const store = currentStore();
		if (!store) return;
		await store.partners.softDelete(id);
		await refreshNow();
	}

	let bookAccounts = $derived(
		app.accounts.map((a) => `${a.name} ···${a.ibanLast4}`).join(', ') ||
			t('anweisungen.ownIbansNone')
	);

	/** @param {string} text */
	const lines = (text) =>
		text
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);

	function addRule() {
		if (contains.trim().length < 2) return;
		rules = [
			...rules,
			{ id: ulid(), field, contains: contains.trim(), action, reason: reason.trim() }
		];
		contains = '';
		reason = '';
	}

	/** @param {string} id */
	function removeRule(id) {
		rules = rules.filter((r) => r.id !== id);
	}

	/** @param {SubmitEvent} event */
	async function save(event) {
		event.preventDefault();
		const store = currentStore();
		if (!store) return;
		saving = true;
		saved = null;
		try {
			const value = cleanMatchingSettings({
				companyNames: lines(companyText),
				ownIbans: lines(ibanText),
				rules: $state.snapshot(rules),
				graceDays: String(graceDays)
			});
			graceDays = value.graceDays;
			await setSetting(store.settings, 'matching', value);
			saved = t('anweisungen.saved');
			await runMatchingNow();
		} finally {
			saving = false;
		}
	}

	/** @param {import('./matching/classify.js').Rule} r */
	const ruleText = (r) =>
		t('anweisungen.ruleText', {
			field: t(
				r.field === 'purpose'
					? 'anweisungen.fieldPurpose'
					: r.field === 'any'
						? 'anweisungen.fieldAny'
						: 'anweisungen.fieldCounterparty'
			),
			contains: r.contains,
			action: t(r.action === 'private' ? 'anweisungen.actionPrivate' : 'anweisungen.actionIgnore')
		}) + (r.reason ? ` (${r.reason})` : '');

	const input = 'mt-1 rounded-md border px-2 py-1.5 text-sm';
</script>

<section
	class="mt-6 rounded-lg border border-border bg-surface px-5 py-4 shadow-sm"
	aria-labelledby="anw-h"
	data-testid="matching-settings"
>
	<h2 id="anw-h" class="text-lg font-semibold">{t('anweisungen.title')}</h2>
	<p class="mt-1 text-sm text-text">{t('anweisungen.intro')}</p>
	<form class="mt-3 flex flex-col gap-4" onsubmit={save}>
		<label class="flex flex-col text-sm">
			<span class="font-medium text-heading">{t('anweisungen.companyNames')}</span>
			<textarea
				class="{input} min-h-16 font-sans"
				bind:value={companyText}
				placeholder="le space UG"
				data-testid="company-names"
			></textarea>
			<span class="mt-1 text-xs text-faint">{t('anweisungen.companyHint')}</span>
		</label>
		<label class="flex flex-col text-sm">
			<span class="font-medium text-heading">{t('anweisungen.ownIbans')}</span>
			<textarea
				class="{input} min-h-16 font-mono"
				bind:value={ibanText}
				placeholder="DE00 0000 0000 0000 0000 00"
				data-testid="own-ibans"
			></textarea>
			<span class="mt-1 text-xs text-faint"
				>{t('anweisungen.ownIbansHint', { list: bookAccounts })}</span
			>
		</label>

		<label class="flex flex-col text-sm">
			<span class="font-medium text-heading">{t('anweisungen.grace')}</span>
			<span class="mt-1 flex items-center gap-2">
				<input
					type="number"
					min="0"
					max={MAX_GRACE_DAYS}
					step="1"
					class="{input} mt-0 w-20 tabular-nums"
					bind:value={graceDays}
					data-testid="grace-days"
				/>
				<span class="text-text">{t('anweisungen.graceUnit')}</span>
			</span>
			<span class="mt-1 text-xs text-faint">{t('anweisungen.graceHint')}</span>
		</label>

		<fieldset class="text-sm">
			<legend class="font-medium text-heading">{t('anweisungen.rules')}</legend>
			<ul class="mt-1 divide-y divide-border" data-testid="rules">
				{#each rules as r (r.id)}
					<li class="flex items-center gap-3 py-1.5" data-testid="rule">
						<span class="flex-1 text-text">{ruleText(r)}</span>
						<button
							type="button"
							class="text-sm text-faint underline hover:text-heading"
							onclick={() => removeRule(r.id)}
							data-testid="rule-remove">{t('anweisungen.remove')}</button
						>
					</li>
				{:else}
					<li class="py-1.5 text-faint">{t('anweisungen.noRules')}</li>
				{/each}
			</ul>
			<div class="mt-2 flex flex-wrap items-end gap-2">
				<label class="flex flex-col">
					<span class="text-faint">{t('anweisungen.field')}</span>
					<select class={input} bind:value={field} data-testid="rule-field">
						<option value="counterparty">{t('anweisungen.fieldCounterparty')}</option>
						<option value="purpose">{t('anweisungen.fieldPurpose')}</option>
						<option value="any">{t('anweisungen.fieldAny')}</option>
					</select>
				</label>
				<label class="flex min-w-32 flex-1 flex-col">
					<span class="text-faint">{t('anweisungen.contains')}</span>
					<input class={input} bind:value={contains} data-testid="rule-contains" />
				</label>
				<label class="flex flex-col">
					<span class="text-faint">{t('anweisungen.action')}</span>
					<select class={input} bind:value={action} data-testid="rule-action">
						<option value="ignore">{t('anweisungen.actionIgnore')}</option>
						<option value="private">{t('anweisungen.actionPrivate')}</option>
					</select>
				</label>
				<label class="flex min-w-32 flex-1 flex-col">
					<span class="text-faint">{t('anweisungen.reason')}</span>
					<input
						class={input}
						bind:value={reason}
						placeholder={t('anweisungen.reasonPlaceholder')}
						data-testid="rule-reason"
					/>
				</label>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:opacity-50"
					onclick={addRule}
					disabled={contains.trim().length < 2}
					data-testid="rule-add">{t('anweisungen.add')}</button
				>
			</div>
		</fieldset>

		<fieldset class="text-sm">
			<legend class="font-medium text-heading">{t('anweisungen.learned')}</legend>
			<p class="mt-1 text-xs text-faint">{t('anweisungen.learnedHint')}</p>
			<ul class="mt-1 divide-y divide-border" data-testid="learned-partners">
				{#each learned as p (p.id)}
					<li class="flex items-center gap-3 py-1.5" data-testid="learned-partner">
						<span class="flex-1 text-text">
							<span class="font-medium text-heading">{p.name}</span>
							← {(p.aliases ?? []).map((/** @type {string} */ a) => `„${a}“`).join(', ')}
							{#if (p.senderDomains ?? []).length}
								<span class="text-faint"
									>· {t('anweisungen.learnedMail', { domains: p.senderDomains.join(', ') })}</span
								>
							{/if}
						</span>
						<button
							type="button"
							class="text-sm text-faint underline hover:text-heading"
							onclick={() => forget(p.id)}
							data-testid="learned-forget">{t('anweisungen.forget')}</button
						>
					</li>
				{:else}
					<li class="py-1.5 text-faint">{t('anweisungen.noLearned')}</li>
				{/each}
			</ul>
		</fieldset>

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="submit"
				class="rounded-md bg-coral-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
				disabled={saving}
				data-testid="matching-save">{t('anweisungen.save')}</button
			>
			{#if saved}
				<p class="text-sm text-heading" role="status" data-testid="matching-saved">{saved}</p>
			{/if}
		</div>
	</form>
</section>
